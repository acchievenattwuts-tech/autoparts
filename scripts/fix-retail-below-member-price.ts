import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

/**
 * แก้สินค้าที่ "ราคาสมาชิก" แพงกว่า "ราคาขายปลีก" (ผิดลำดับ ส่ง < สมาชิก < ปลีก)
 *
 * เกิดกับสินค้าที่เคยตั้งราคาปลีกมือไว้ต่ำกว่าสูตร ×1.70 — พอเติมราคาสมาชิกจาก
 * ขายส่ง ×1.40 ราคาสมาชิกจึงแซงราคาปลีก ทำให้ลูกค้ากลุ่มสมาชิกซื้อแพงกว่าลูกค้าทั่วไป
 *
 * วิธีแก้ (ยืนยันโดยเจ้าของร้าน 2026-07-19): คำนวณราคาปลีกใหม่ตามสูตรมาตรฐาน
 *   retailPrice = ceil(salePrice * 1.70 / 10) * 10
 *
 * Scope: เฉพาะแถวที่ salePrice > 0 และ retailPrice < memberPrice เท่านั้น
 *        สินค้าที่ลำดับราคาถูกต้องอยู่แล้วจะไม่ถูกแตะ
 *
 * Dry-run:  npx tsx --env-file=.env.local scripts/fix-retail-below-member-price.ts
 * Apply:    npx tsx --env-file=.env.local scripts/fix-retail-below-member-price.ts --apply
 */
import { db } from "../lib/db";
import { AuditAction } from "../lib/generated/prisma";
import { derivePricesFromWholesale } from "../lib/product-pricing";

const TRANSACTION_TIMEOUT_MS = 60_000;

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const products = await db.product.findMany({
    where: { salePrice: { gt: 0 } },
    select: { id: true, code: true, name: true, salePrice: true, retailPrice: true, memberPrice: true },
    orderBy: { code: "asc" },
  });

  const fixes = products
    .filter((product) => Number(product.retailPrice) < Number(product.memberPrice))
    .map((product) => {
      const wholesale = Number(product.salePrice);
      return {
        id: product.id,
        code: product.code,
        name: product.name,
        wholesale,
        member: Number(product.memberPrice),
        currentRetail: Number(product.retailPrice),
        nextRetail: derivePricesFromWholesale(wholesale).retailPrice,
      };
    });

  console.log("=".repeat(78));
  console.log(apply ? "APPLY MODE — จะเขียนลง DB จริง" : "DRY RUN — ยังไม่เขียน DB (ใส่ --apply เพื่อรันจริง)");
  console.log("=".repeat(78));
  console.log(`พบสินค้าที่ราคาสมาชิกแพงกว่าราคาปลีก: ${fixes.length} รายการ\n`);

  for (const fix of fixes) {
    console.log(
      `  ${fix.code.padEnd(10)} ส่ง=${fix.wholesale.toFixed(2).padStart(9)}` +
        ` สมาชิก=${fix.member.toFixed(2).padStart(9)}` +
        `  ปลีก ${fix.currentRetail.toFixed(2).padStart(9)} -> ${fix.nextRetail.toFixed(2).padStart(9)}` +
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
            entityRef: "fix-retail-below-member-price",
            meta: {
              rule: "retailPrice = salePrice * 1.70, ceil to nearest 10",
              scope: "เฉพาะแถวที่ retailPrice < memberPrice (ลำดับราคาผิด)",
              updatedCount: fixes.length,
              items: fixes.map((fix) => ({
                code: fix.code,
                wholesale: fix.wholesale,
                member: fix.member,
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
