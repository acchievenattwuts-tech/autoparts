import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

/**
 * Phase 2 backfill for the LINE Login → same-provider migration.
 *
 * Problem: `Customer.lineUserId` was populated by the OLD LIFF/Login channel
 * (a different LINE provider than the Messaging API/OA channel). After moving
 * LIFF to a channel under the same provider as the OA channel, the LIFF userId
 * a customer gets on next login will equal their OA userId
 * (`LineConversation.lineUserId`) — NOT the old value stored on Customer.
 *
 * This script rewrites `Customer.lineUserId` to the OA userId of the
 * conversation already linked to that customer (`LineConversation.customerId`),
 * so returning customers are recognized immediately without re-linking via
 * phone in LIFF.
 *
 * Safety:
 * - Dry-run by default. Pass --apply to write changes.
 * - Never touches LineConversation, never deletes anything.
 * - Skips (with a logged reason) anything ambiguous instead of guessing:
 *   customer already correct, customer inactive, or the target OA userId is
 *   already used by a different customer (unique constraint).
 * - Every applied change writes an AuditLog row (append-only, per .rules §8).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-customer-line-userid.ts            (dry-run)
 *   npx tsx --env-file=.env.local scripts/backfill-customer-line-userid.ts --apply     (writes)
 */

const APPLY = process.argv.includes("--apply");

type Plan = {
  customerId: string;
  customerCode: string | null;
  customerName: string;
  oldLineUserId: string | null;
  newLineUserId: string;
  sourceConversationId: string;
};

async function main() {
  const { db } = await import("../lib/db");
  const { writeAuditLog } = await import("../lib/audit-log");
  const { AuditAction } = await import("../lib/generated/prisma");

  try {
    // One row per linked conversation; pick the most recently active
    // conversation per customer when a customer has more than one.
    const conversations = await db.lineConversation.findMany({
      where: { customerId: { not: null } },
      select: {
        id: true,
        lineUserId: true,
        customerId: true,
        lastCustomerMessageAt: true,
        createdAt: true,
      },
      orderBy: [{ lastCustomerMessageAt: "desc" }, { createdAt: "desc" }],
    });

    const latestByCustomerId = new Map<string, (typeof conversations)[number]>();
    for (const conv of conversations) {
      const customerId = conv.customerId;
      if (!customerId) continue;
      if (!latestByCustomerId.has(customerId)) {
        latestByCustomerId.set(customerId, conv);
      }
    }

    const plans: Plan[] = [];
    const skippedAlreadyCorrect: string[] = [];
    const skippedInactive: string[] = [];
    const skippedConflict: string[] = [];

    // Track OA userIds we intend to assign in this run, to catch in-batch
    // collisions before hitting the DB unique constraint.
    const claimedTargets = new Map<string, string>(); // lineUserId -> customerId

    for (const [customerId, conv] of latestByCustomerId) {
      const customer = await db.customer.findUnique({
        where: { id: customerId },
        select: { id: true, code: true, name: true, lineUserId: true, isActive: true },
      });
      if (!customer) continue;

      if (!customer.isActive) {
        skippedInactive.push(`${customer.code ?? customer.id} (${customer.name})`);
        continue;
      }

      if (customer.lineUserId === conv.lineUserId) {
        skippedAlreadyCorrect.push(`${customer.code ?? customer.id} (${customer.name})`);
        continue;
      }

      const conflictOwner = await db.customer.findUnique({
        where: { lineUserId: conv.lineUserId },
        select: { id: true, code: true, name: true },
      });
      const inBatchConflictOwnerId = claimedTargets.get(conv.lineUserId);

      if (
        (conflictOwner && conflictOwner.id !== customerId) ||
        (inBatchConflictOwnerId && inBatchConflictOwnerId !== customerId)
      ) {
        skippedConflict.push(
          `${customer.code ?? customer.id} (${customer.name}) -> target lineUserId already used by ${
            conflictOwner ? `${conflictOwner.code ?? conflictOwner.id} (${conflictOwner.name})` : inBatchConflictOwnerId
          }`,
        );
        continue;
      }

      claimedTargets.set(conv.lineUserId, customerId);
      plans.push({
        customerId: customer.id,
        customerCode: customer.code,
        customerName: customer.name,
        oldLineUserId: customer.lineUserId,
        newLineUserId: conv.lineUserId,
        sourceConversationId: conv.id,
      });
    }

    console.log(`โหมด: ${APPLY ? "APPLY (จะเขียนข้อมูลจริง)" : "DRY-RUN (ยังไม่เขียนข้อมูล)"}`);
    console.log(`ห้องแชทที่ผูกลูกค้าแล้วทั้งหมด: ${conversations.length}`);
    console.log(`ลูกค้าที่จะอัปเดต lineUserId: ${plans.length}`);
    console.log(`ข้าม (lineUserId ถูกต้องอยู่แล้ว): ${skippedAlreadyCorrect.length}`);
    console.log(`ข้าม (ลูกค้า inactive): ${skippedInactive.length}`);
    console.log(`ข้าม (ชนกัน ต้องตรวจมือ): ${skippedConflict.length}`);
    console.log("");

    if (plans.length > 0) {
      console.log("=== แผนการเปลี่ยนแปลง ===");
      for (const plan of plans) {
        console.log(
          `- ${plan.customerCode ?? plan.customerId} (${plan.customerName}): ` +
            `${plan.oldLineUserId ?? "(none)"} -> ${plan.newLineUserId} ` +
            `[conversation ${plan.sourceConversationId}]`,
        );
      }
      console.log("");
    }

    if (skippedConflict.length > 0) {
      console.log("=== ต้องตรวจมือ (ชนกัน) ===");
      for (const line of skippedConflict) console.log(`- ${line}`);
      console.log("");
    }

    if (!APPLY) {
      console.log("Dry-run เท่านั้น — ไม่มีการเขียนข้อมูล ตรวจแผนด้านบนก่อน แล้วรันซ้ำพร้อม --apply");
      return;
    }

    let applied = 0;
    for (const plan of plans) {
      try {
        await db.customer.update({
          where: { id: plan.customerId },
          data: { lineUserId: plan.newLineUserId },
        });

        await writeAuditLog({
          userId: null,
          userName: "LINE Provider Migration Script",
          userRole: "SYSTEM",
          action: AuditAction.LINE_LINK,
          entityType: "Customer",
          entityId: plan.customerId,
          entityRef: plan.customerCode ?? plan.customerName,
          before: { lineUserId: plan.oldLineUserId },
          after: { lineUserId: plan.newLineUserId },
          meta: {
            operation: "PROVIDER_MIGRATION_BACKFILL",
            sourceConversationId: plan.sourceConversationId,
          },
        });

        applied += 1;
        console.log(`+ อัปเดตแล้ว: ${plan.customerCode ?? plan.customerId}`);
      } catch (error) {
        console.error(`! ล้มเหลว: ${plan.customerCode ?? plan.customerId}`, error);
      }
    }

    console.log("");
    console.log(`เสร็จสิ้น — อัปเดตสำเร็จ ${applied}/${plans.length} ราย`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
