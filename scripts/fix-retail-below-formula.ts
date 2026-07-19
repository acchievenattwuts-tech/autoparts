import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

/**
 * แก้สินค้าที่ "ราคาขายปลีก" ถูกตั้งมือไว้ต่ำกว่าสูตร ×1.70 จนราคาสมาชิกใหม่
 * (= ราคาปลีก − 30%) ตกลงมาไม่สูงกว่าราคาขายส่ง — ขายให้สมาชิกแล้วไม่มีกำไร
 *
 * วิธีแก้ (ยืนยันโดยเจ้าของร้าน 2026-07-19): คำนวณราคาปลีกใหม่ตามสูตรมาตรฐาน
 *   retailPrice = ceil(salePrice * 1.70 / 10) * 10
 *
 * Scope: เฉพาะแถวที่ salePrice > 0 และ deriveMemberPriceFromRetail(retailPrice) <= salePrice
 *        สินค้าที่ลำดับราคาถูกต้องอยู่แล้วจะไม่ถูกแตะ
 *
 * สคริปต์นี้ต้องรัน **ก่อน** scripts/recalc-member-price-from-retail.ts
 *
 * Dry-run:  npx tsx --env-file=.env.local scripts/fix-retail-below-formula.ts
 * Apply:    npx tsx --env-file=.env.local scripts/fix-retail-below-formula.ts --apply
 */
import { db } from "../lib/db";
import { AuditAction } from "../lib/generated/prisma";
import { derivePricesFromWholesale, deriveMemberPriceFromRetail } from "../lib/product-pricing";

const TRANSACTION_TIMEOUT_MS = 60_000;

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const products = await db.product.findMany({
    where: { salePrice: { gt: 0 }, retailPrice: { gt: 0 } },
    select: { id: true, code: true, name: true, salePrice: true, retailPrice: true },
    orderBy: { code: "asc" },
  });

  const fixes = products
    .filter((product) => deriveMemberPriceFromRetail(Number(product.retailPrice)) <= Number(product.salePrice))
    .map((product) => {
      const wholesale = Number(product.salePrice);
      const currentRetail = Number(product.retailPrice);
      const nextRetail = derivePricesFromWholesale(wholesale).retailPrice;
      return {
        id: product.id,
        code: product.code,
        name: product.name,
        wholesale,
        currentRetail,
        nextRetail,
        currentMemberWouldBe: deriveMemberPriceFromRetail(currentRetail),
        nextMemberWouldBe: deriveMemberPriceFromRetail(nextRetail),
      };
    })
    // ป้องกันกรณีสูตรให้ราคาต่ำกว่าที่ตั้งไว้ — ไม่ลดราคาปลีกลงโดยไม่ตั้งใจ
    .filter((fix) => fix.nextRetail > fix.currentRetail);

  console.log("=".repeat(78));
  console.log(apply ? "APPLY MODE — จะเขียนลง DB จริง" : "DRY RUN — ยังไม่เขียน DB (ใส่ --apply เพื่อรันจริง)");
  console.log("=".repeat(78));
  console.log("สูตร: ราคาขายปลีก = ราคาขายส่ง x 1.70 (ปัดขึ้นลงท้ายด้วย 0)");
  console.log(`พบสินค้าที่ราคาสมาชิกจะไม่สูงกว่าราคาขายส่ง: ${fixes.length} รายการ\n`);

  for (const fix of fixes) {
    console.log(
      `  ${fix.code.padEnd(10)} ส่ง=${fix.wholesale.toFixed(2).padStart(9)}` +
        `  ปลีก ${fix.currentRetail.toFixed(2).padStart(9)} -> ${fix.nextRetail.toFixed(2).padStart(9)}` +
        `  (สมาชิกจะได้ ${fix.currentMemberWouldBe.toFixed(2)} -> ${fix.nextMemberWouldBe.toFixed(2)})` +
        `  ${fix.name}`,
    );
  }

  if (fixes.length === 0) {
    console.log("ไม่มีรายการที่ต้องแก้");
    await db.$disconnect();
    return;
  }

  if (!apply) {
    console.log("\n(dry-run เท่านั้น — ยังไม่มีการเปลี่ยนแปลง)");
    await db.$disconnect();
    return;
  }

  try {
    await db.$transaction(
      async (tx) => {
        for (const fix of fixes) {
          await tx.product.update({
            where: { id: fix.id },
            data: { retailPrice: fix.nextRetail },
          });
        }
        await tx.auditLog.create({
          data: {
            userName: "script",
            userRole: "system",
            action: AuditAction.UPDATE,
            entityType: "Product",
            entityRef: "fix-retail-below-formula",
            meta: {
              rule: "retailPrice = salePrice * 1.70, ceil to nearest 10",
              scope: "เฉพาะแถวที่ราคาสมาชิกใหม่ (ปลีก - 30%) <= ราคาขายส่ง",
              updatedCount: fixes.length,
              items: fixes.map((fix) => ({
                code: fix.code,
                wholesale: fix.wholesale,
                retailBefore: fix.currentRetail,
                retailAfter: fix.nextRetail,
              })),
            },
          },
        });
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    );
  } catch (error) {
    console.error("อัปเดตไม่สำเร็จ — rollback แล้ว ไม่มีการเปลี่ยนแปลงถูกบันทึก");
    throw error;
  }

  console.log(`\n[APPLIED] แก้ ${fixes.length} รายการ + เขียน AuditLog แล้ว`);
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
