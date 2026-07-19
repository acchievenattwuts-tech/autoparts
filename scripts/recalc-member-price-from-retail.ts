import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

/**
 * อัปเดต "ราคาสมาชิก" ใหม่ทั้งหมดจาก "ราคาขายปลีก" (Product.retailPrice)
 *
 * สูตรใหม่ (lib/product-pricing.ts):
 *   memberPrice = ceil(retailPrice * 0.70 / 10) * 10   // ราคาปลีก - 30% ปัดขึ้นลงท้ายด้วย 0
 *
 * Scope: สินค้าทุกตัว (active + inactive) ที่ retailPrice > 0
 *   - **เขียนทับราคาสมาชิกเดิมเสมอ** แม้จะเคยตั้งค่าไว้แล้ว (ยืนยันโดยผู้ใช้)
 *   - retailPrice <= 0 → คำนวณไม่ได้ ข้ามทั้งแถว
 *
 * Safety:
 * - Dry-run เป็นค่าเริ่มต้น (พิมพ์ตัวอย่าง + สรุปจำนวน) ต้องใส่ --apply ถึงจะเขียน DB
 * - เขียนใน transaction เดียว + บันทึก AuditLog 1 แถวสรุปการรัน
 * - **ตรวจลำดับราคา**: ถ้าราคาสมาชิกใหม่ <= ราคาขายส่ง (ขายไม่มีกำไร) จะรายงานทุกแถว
 *   และ **ปฏิเสธการ apply** เว้นแต่ใส่ --allow-below-wholesale เพื่อยืนยันว่ารับได้
 *
 * Dry-run:  npx tsx --env-file=.env.local scripts/recalc-member-price-from-retail.ts
 * Apply:    npx tsx --env-file=.env.local scripts/recalc-member-price-from-retail.ts --apply
 */
import { db } from "../lib/db";
import { AuditAction } from "../lib/generated/prisma";
import { deriveMemberPriceFromRetail } from "../lib/product-pricing";

const SAMPLE_SIZE = 20;
const TRANSACTION_TIMEOUT_MS = 120_000;

type MemberPriceUpdate = {
  id: string;
  code: string;
  wholesale: number;
  retail: number;
  currentMember: number;
  nextMember: number;
};

/** ราคาสมาชิกต้องสูงกว่าราคาขายส่งเสมอ — ไม่งั้นขายแล้วไม่มีกำไร */
function isBelowWholesale(change: MemberPriceUpdate): boolean {
  return change.wholesale > 0 && change.nextMember <= change.wholesale;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const allowBelowWholesale = process.argv.includes("--allow-below-wholesale");

  const products = await db.product.findMany({
    select: { id: true, code: true, salePrice: true, retailPrice: true, memberPrice: true },
    orderBy: { code: "asc" },
  });

  const changes: MemberPriceUpdate[] = [];
  let skippedNoRetail = 0;
  let alreadyCorrect = 0;

  for (const product of products) {
    const retail = Number(product.retailPrice);
    const currentMember = Number(product.memberPrice);

    // ไม่มีราคาขายปลีก → คำนวณไม่ได้ ปล่อยไว้เหมือนเดิม
    if (retail <= 0) {
      skippedNoRetail += 1;
      continue;
    }

    const nextMember = deriveMemberPriceFromRetail(retail);

    if (nextMember === currentMember) {
      alreadyCorrect += 1;
      continue;
    }

    changes.push({
      id: product.id,
      code: product.code,
      wholesale: Number(product.salePrice),
      retail,
      currentMember,
      nextMember,
    });
  }

  console.log("=".repeat(78));
  console.log(apply ? "APPLY MODE — จะเขียนลง DB จริง" : "DRY RUN — ยังไม่เขียน DB (ใส่ --apply เพื่อรันจริง)");
  console.log("=".repeat(78));
  console.log("สูตร: ราคาสมาชิก = ราคาขายปลีก - 30% (ปัดขึ้นลงท้ายด้วย 0)");
  console.log("เขียนทับราคาสมาชิกเดิมทุกรายการที่ราคาขายปลีก > 0\n");
  console.log(`สินค้าทั้งหมด: ${products.length} รายการ`);
  console.log(`ข้าม (ยังไม่มีราคาขายปลีก): ${skippedNoRetail} รายการ`);
  console.log(`ตรงสูตรอยู่แล้ว: ${alreadyCorrect} รายการ`);
  console.log(`จะอัปเดต: ${changes.length} รายการ\n`);

  console.log(`ตัวอย่าง ${Math.min(SAMPLE_SIZE, changes.length)} รายการแรก:`);
  for (const change of changes.slice(0, SAMPLE_SIZE)) {
    console.log(
      `  ${change.code.padEnd(12)} ปลีก=${change.retail.toFixed(2).padStart(9)}` +
        `  สมาชิก ${change.currentMember.toFixed(2).padStart(9)} -> ${change.nextMember.toFixed(2).padStart(9)}`,
    );
  }

  const belowWholesale = changes.filter(isBelowWholesale);
  console.log(`\nตรวจลำดับราคา: ราคาสมาชิกใหม่ <= ราคาขายส่ง = ${belowWholesale.length} รายการ`);
  for (const change of belowWholesale) {
    console.log(
      `  [!] ${change.code.padEnd(12)} ส่ง=${change.wholesale.toFixed(2).padStart(9)}` +
        `  ปลีก=${change.retail.toFixed(2).padStart(9)}` +
        `  สมาชิกใหม่=${change.nextMember.toFixed(2).padStart(9)}`,
    );
  }

  if (!apply) {
    console.log("\n(dry-run เท่านั้น — ยังไม่มีการเปลี่ยนแปลง)");
    await db.$disconnect();
    return;
  }

  if (belowWholesale.length > 0 && !allowBelowWholesale) {
    console.error(
      `\nยกเลิก: มี ${belowWholesale.length} รายการที่ราคาสมาชิกใหม่ไม่สูงกว่าราคาขายส่ง (ขายแล้วไม่มีกำไร)` +
        "\nแก้ราคาขายปลีกของรายการเหล่านี้ก่อน หรือใส่ --allow-below-wholesale เพื่อยืนยันว่ารับได้",
    );
    await db.$disconnect();
    process.exit(1);
  }

  if (changes.length === 0) {
    console.log("\nไม่มีรายการที่ต้องอัปเดต");
    await db.$disconnect();
    return;
  }

  try {
    await db.$transaction(
      async (tx) => {
        for (const change of changes) {
          await tx.product.update({
            where: { id: change.id },
            data: { memberPrice: change.nextMember },
          });
        }
        await tx.auditLog.create({
          data: {
            userName: "script",
            userRole: "system",
            action: AuditAction.UPDATE,
            entityType: "Product",
            entityRef: "bulk-recalc-member-price-from-retail",
            meta: {
              rule: "memberPrice = retailPrice * 0.70, ceil to nearest 10",
              scope:
                "สินค้าทุกตัว (active + inactive) ที่ retailPrice > 0; เขียนทับราคาสมาชิกเดิมเสมอ; retailPrice <= 0 ข้ามทั้งแถว",
              scannedCount: products.length,
              skippedNoRetailCount: skippedNoRetail,
              alreadyCorrectCount: alreadyCorrect,
              updatedCount: changes.length,
              belowWholesaleCount: belowWholesale.length,
              belowWholesaleCodes: belowWholesale.map((c) => c.code),
            },
          },
        });
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    );
  } catch (error) {
    console.error("อัปเดตไม่สำเร็จ — ไม่มีการเปลี่ยนแปลงใด ๆ ถูกบันทึก (rollback แล้ว)");
    throw error;
  }

  console.log(`\n[APPLIED] อัปเดต ${changes.length} รายการ + เขียน AuditLog แล้ว`);
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
