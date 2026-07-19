import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

/**
 * เติม "ราคาขายปลีก" + "ราคาสมาชิก" ที่ยังไม่ได้ตั้ง (= 0) จาก "ราคาขายส่ง" (Product.salePrice)
 *
 * ใช้สูตรเดียวกับการคำนวณอัตโนมัติในฟอร์มสินค้า (lib/product-pricing.ts):
 *   retailPrice = ceil(salePrice * 1.70 / 10) * 10
 *   memberPrice = ceil(salePrice * 1.40 / 10) * 10
 *
 * Scope: สินค้าทุกตัว (active + inactive) แต่ **เติมเฉพาะช่องที่ยังเป็น 0 เท่านั้น**
 *   - ราคาที่ตั้งไว้แล้ว (> 0) จะไม่ถูกแตะ — ราคาที่แอดมินตั้งมือไว้ต้องไม่หาย
 *   - salePrice <= 0 → คำนวณไม่ได้ ข้ามทั้งแถว (ระบบแสดง "สอบถามราคา" ตามเดิม)
 *
 * แต่ละช่องคิดแยกกัน เช่น สินค้าที่มีราคาปลีกแล้วแต่ยังไม่มีราคาสมาชิก
 * จะถูกเติมเฉพาะราคาสมาชิก ส่วนราคาปลีกคงเดิม
 *
 * Safety:
 * - Dry-run เป็นค่าเริ่มต้น (พิมพ์ตัวอย่าง + สรุปจำนวน) ต้องใส่ --apply ถึงจะเขียน DB
 * - เขียนใน transaction เดียว + บันทึก AuditLog 1 แถวสรุปการรัน
 *
 * Dry-run:  npx tsx --env-file=.env.local scripts/recalc-prices-from-wholesale.ts
 * Apply:    npx tsx --env-file=.env.local scripts/recalc-prices-from-wholesale.ts --apply
 */
import { db } from "../lib/db";
import { AuditAction } from "../lib/generated/prisma";
import { derivePricesFromWholesale } from "../lib/product-pricing";

const SAMPLE_SIZE = 20;
const TRANSACTION_TIMEOUT_MS = 120_000;

type PriceUpdate = {
  id: string;
  code: string;
  wholesale: number;
  currentRetail: number;
  currentMember: number;
  nextRetail: number;
  nextMember: number;
};

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const products = await db.product.findMany({
    select: { id: true, code: true, salePrice: true, retailPrice: true, memberPrice: true },
    orderBy: { code: "asc" },
  });

  const changes: PriceUpdate[] = [];
  let skippedNoWholesale = 0;
  for (const product of products) {
    const wholesale = Number(product.salePrice);
    const currentRetail = Number(product.retailPrice);
    const currentMember = Number(product.memberPrice);

    // ไม่มีราคาขายส่ง → คำนวณไม่ได้ ปล่อยไว้เหมือนเดิม
    if (wholesale <= 0) {
      skippedNoWholesale += 1;
      continue;
    }

    const { retailPrice, memberPrice } = derivePricesFromWholesale(wholesale);

    // เติมเฉพาะช่องที่ยังไม่ได้ตั้งราคา — ราคาที่ตั้งไว้แล้วคงค่าเดิมเสมอ
    const nextRetail = currentRetail > 0 ? currentRetail : retailPrice;
    const nextMember = currentMember > 0 ? currentMember : memberPrice;

    if (nextRetail === currentRetail && nextMember === currentMember) continue;

    changes.push({
      id: product.id,
      code: product.code,
      wholesale,
      currentRetail,
      currentMember,
      nextRetail,
      nextMember,
    });
  }

  console.log("=".repeat(78));
  console.log(apply ? "APPLY MODE — จะเขียนลง DB จริง" : "DRY RUN — ยังไม่เขียน DB (ใส่ --apply เพื่อรันจริง)");
  console.log("=".repeat(78));
  console.log("สูตร: ปลีก = ขายส่ง x 1.70, สมาชิก = ขายส่ง x 1.40 (ปัดขึ้นลงท้ายด้วย 0)");
  console.log("เติมเฉพาะช่องที่ยังเป็น 0 — ราคาที่ตั้งไว้แล้วไม่ถูกแตะ\n");
  console.log(`สินค้าทั้งหมด: ${products.length} รายการ`);
  console.log(`ข้าม (ยังไม่มีราคาขายส่ง): ${skippedNoWholesale} รายการ`);
  console.log(`จะเติมราคา: ${changes.length} รายการ`);
  console.log(`  - เติมราคาปลีก: ${changes.filter((c) => c.nextRetail !== c.currentRetail).length} รายการ`);
  console.log(`  - เติมราคาสมาชิก: ${changes.filter((c) => c.nextMember !== c.currentMember).length} รายการ\n`);

  console.log(`ตัวอย่าง ${Math.min(SAMPLE_SIZE, changes.length)} รายการแรก:`);
  for (const change of changes.slice(0, SAMPLE_SIZE)) {
    console.log(
      `  ${change.code.padEnd(12)} ส่ง=${change.wholesale.toFixed(2).padStart(9)}` +
        `  สมาชิก ${change.currentMember.toFixed(2).padStart(9)} -> ${change.nextMember.toFixed(2).padStart(9)}` +
        `  ปลีก ${change.currentRetail.toFixed(2).padStart(9)} -> ${change.nextRetail.toFixed(2).padStart(9)}`,
    );
  }

  if (!apply) {
    console.log("\n(dry-run เท่านั้น — ยังไม่มีการเปลี่ยนแปลง)");
    await db.$disconnect();
    return;
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
            data: { retailPrice: change.nextRetail, memberPrice: change.nextMember },
          });
        }
        await tx.auditLog.create({
          data: {
            userName: "script",
            userRole: "system",
            action: AuditAction.UPDATE,
            entityType: "Product",
            entityRef: "bulk-recalc-retail-and-member-price",
            meta: {
              rule: "retailPrice = salePrice * 1.70, memberPrice = salePrice * 1.40, ceil to nearest 10",
              scope:
                "เติมเฉพาะช่องที่เป็น 0 (active + inactive); ราคาที่ตั้งไว้แล้วไม่ถูกแตะ; salePrice <= 0 ข้ามทั้งแถว",
              scannedCount: products.length,
              skippedNoWholesaleCount: skippedNoWholesale,
              updatedCount: changes.length,
              retailFilledCount: changes.filter((c) => c.nextRetail !== c.currentRetail).length,
              memberFilledCount: changes.filter((c) => c.nextMember !== c.currentMember).length,
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
