import { db } from "@/lib/db";
import { AuditAction } from "@/lib/generated/prisma";
import { normalizePaymentSlipReferenceKey } from "@/lib/line-payment-slip-check-rules";

/**
 * Fills `PaymentSlip.referenceNoKey` (the duplicate-slip lookup key) for slips
 * saved before the 2026-10-23 duplicate check existed. New slips get the key at
 * ingestion, so this only touches rows where the key is still NULL.
 *
 * Safety: dry-run by default; only writes `referenceNoKey`; idempotent (re-running
 * skips filled rows, so it is safe to run again right after deploying); one AuditLog.
 *
 * Run:  npm run backfill:payment-slip-reference-key            (dry-run)
 *       npm run backfill:payment-slip-reference-key -- --apply (execute)
 */

type Mode = "dry-run" | "apply";
const DRY_RUN_PREVIEW_ROWS = 20;

const getMode = (): Mode => (process.argv.includes("--apply") ? "apply" : "dry-run");

async function main(): Promise<void> {
  const mode = getMode();
  console.log(`\nPaymentSlip.referenceNoKey backfill mode: ${mode.toUpperCase()}\n`);

  const slips = await db.paymentSlip.findMany({
    where: { referenceNoKey: null, detectedReferenceNo: { not: null } },
    select: { id: true, detectedReferenceNo: true },
    orderBy: { createdAt: "asc" },
  });
  const planned = slips
    .map((slip) => ({ id: slip.id, key: normalizePaymentSlipReferenceKey(slip.detectedReferenceNo) }))
    .filter((row): row is { id: string; key: string } => row.key !== null);
  const unusable = slips.length - planned.length;

  console.log(`Slips missing a key: ${slips.length}`);
  console.log(`  will be filled: ${planned.length}`);
  console.log(`  reference too short/unreadable (left NULL): ${unusable}`);

  if (mode === "dry-run") {
    for (const row of planned.slice(0, DRY_RUN_PREVIEW_ROWS)) {
      console.log(`  ${row.id} → ${row.key}`);
    }
    if (planned.length > DRY_RUN_PREVIEW_ROWS) {
      console.log(`  …and ${planned.length - DRY_RUN_PREVIEW_ROWS} more`);
    }
    console.log("\nDry-run complete. Re-run with --apply to write the keys.\n");
    return;
  }

  let updated = 0;
  for (const row of planned) {
    // Guarded by referenceNoKey IS NULL so a concurrent ingest is never overwritten.
    const result = await db.paymentSlip.updateMany({
      where: { id: row.id, referenceNoKey: null },
      data: { referenceNoKey: row.key },
    });
    updated += result.count;
  }

  await db.auditLog.create({
    data: {
      userId: null,
      userName: "system-backfill",
      userRole: "SYSTEM",
      action: AuditAction.UPDATE,
      entityType: "PaymentSlip",
      entityRef: "backfill:referenceNoKey",
      meta: { updated, planned: planned.length, unusable },
    },
  });

  console.log(`\nUpdated: ${updated} of ${planned.length}. Left NULL (unusable reference): ${unusable}.\n`);
}

main()
  .catch((error: unknown) => {
    console.error("PaymentSlip.referenceNoKey backfill failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
