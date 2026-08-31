import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

/**
 * อัปเดต "ราคาขายปลีก" (Product.retailPrice) จาก "ราคาขายส่ง" (Product.salePrice)
 * ด้วยสูตรเดียวกับ Lazada:
 *
 *   retailPrice = (salePrice + 60) / 0.7218  ปัดขึ้นลงท้ายด้วย 5 หรือ 0 (เพิ่มขึ้นเสมอ)
 *
 * สูตรเดียวกับฟอร์มสินค้า (lib/product-pricing.ts → deriveRetailPriceFromWholesale)
 *
 * Scope: สินค้าทุกตัว (active + inactive) ที่มี salePrice > 0 — **เขียนทับราคาปลีกเดิมทั้งหมด**
 *   - salePrice <= 0 → คำนวณไม่ได้ ข้ามทั้งแถว
 *   - ซิงก์ ProductPrice ของระดับราคา RETAIL ให้ตรงกับ Product.retailPrice เสมอ
 *     (เหมือนที่ฟอร์มสินค้าทำใน syncProductPrices)
 *   - ไม่แตะ memberPrice (คงสูตรเดิม) และไม่แตะราคา Shopee / Lazada
 *
 * Safety:
 * - Dry-run เป็นค่าเริ่มต้น ต้องใส่ --apply ถึงจะเขียน DB
 * - เขียนใน transaction เดียว + บันทึก AuditLog 1 แถวสรุปการรัน
 *
 * Dry-run:  npx tsx --env-file=.env.local scripts/recalc-retail-price-lazada-formula.ts
 * Apply:    npx tsx --env-file=.env.local scripts/recalc-retail-price-lazada-formula.ts --apply
 */
import { db } from "../lib/db";
import { AuditAction } from "../lib/generated/prisma";
import { deriveRetailPriceFromWholesale } from "../lib/product-pricing";

const SAMPLE_SIZE = 20;
const TRANSACTION_TIMEOUT_MS = 180_000;

type RetailPriceUpdate = {
  id: string;
  code: string;
  wholesale: number;
  member: number;
  currentRetail: number;
  nextRetail: number;
};

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const retailPriceList = await db.priceList.findUnique({
    where: { code: "RETAIL" },
    select: { id: true },
  });
  if (!retailPriceList) {
    throw new Error("ไม่พบ PriceList รหัส RETAIL — ตรวจสอบ master data ก่อนรันสคริปต์");
  }

  const products = await db.product.findMany({
    select: { id: true, code: true, salePrice: true, retailPrice: true, memberPrice: true },
    orderBy: { code: "asc" },
  });

  const changes: RetailPriceUpdate[] = [];
  let skippedNoWholesale = 0;

  for (const product of products) {
    const wholesale = Number(product.salePrice);
    if (wholesale <= 0) {
      skippedNoWholesale += 1;
      continue;
    }

    const currentRetail = Number(product.retailPrice);
    const nextRetail = deriveRetailPriceFromWholesale(wholesale);
    if (nextRetail === currentRetail) continue;

    changes.push({
      id: product.id,
      code: product.code,
      wholesale,
      member: Number(product.memberPrice),
      currentRetail,
      nextRetail,
    });
  }

  // ราคาสมาชิกต้องไม่สูงกว่าราคาขายปลีกใหม่ — รายงานให้เห็นก่อนตัดสินใจ
  const memberAboveRetail = changes.filter((change) => change.member > change.nextRetail);

  console.log("=".repeat(90));
  console.log(apply ? "APPLY MODE — จะเขียนลง DB จริง" : "DRY RUN — ยังไม่เขียน DB (ใส่ --apply เพื่อรันจริง)");
  console.log("=".repeat(90));
  console.log("สูตร: ราคาขายปลีก = (ขายส่ง + 60) / 0.7218 ปัดขึ้นลงท้ายด้วย 5 หรือ 0 (เพิ่มขึ้นเสมอ)");
  console.log("เขียนทับราคาปลีกเดิมทั้งหมด — ไม่แตะราคาสมาชิก\n");
  console.log(`สินค้าทั้งหมด: ${products.length} รายการ`);
  console.log(`ข้าม (ยังไม่มีราคาขายส่ง): ${skippedNoWholesale} รายการ`);
  console.log(`จะอัปเดต: ${changes.length} รายการ`);
  console.log(`  - ราคาลดลงจากเดิม: ${changes.filter((c) => c.nextRetail < c.currentRetail).length} รายการ`);
  console.log(`  - ราคาสมาชิกสูงกว่าราคาปลีกใหม่: ${memberAboveRetail.length} รายการ\n`);

  console.log(`ตัวอย่าง ${Math.min(SAMPLE_SIZE, changes.length)} รายการแรก:`);
  for (const change of changes.slice(0, SAMPLE_SIZE)) {
    console.log(
      `  ${change.code.padEnd(14)} ส่ง=${change.wholesale.toFixed(2).padStart(9)}` +
        `  สมาชิก=${change.member.toFixed(2).padStart(9)}` +
        `  ปลีก ${change.currentRetail.toFixed(2).padStart(9)} -> ${change.nextRetail.toFixed(2).padStart(9)}`,
    );
  }

  if (memberAboveRetail.length > 0) {
    console.log(`\nเตือน: ${memberAboveRetail.length} รายการที่ราคาสมาชิกสูงกว่าราคาปลีกใหม่ (ตัวอย่าง)`);
    for (const change of memberAboveRetail.slice(0, SAMPLE_SIZE)) {
      console.log(
        `  ${change.code.padEnd(14)} ส่ง=${change.wholesale.toFixed(2).padStart(9)}` +
          `  สมาชิก=${change.member.toFixed(2).padStart(9)}  ปลีกใหม่=${change.nextRetail.toFixed(2).padStart(9)}`,
      );
    }
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
            data: { retailPrice: change.nextRetail },
          });
          await tx.productPrice.upsert({
            where: { productId_priceListId: { productId: change.id, priceListId: retailPriceList.id } },
            create: { productId: change.id, priceListId: retailPriceList.id, amount: change.nextRetail },
            update: { amount: change.nextRetail },
          });
        }
        await tx.auditLog.create({
          data: {
            userName: "script",
            userRole: "system",
            action: AuditAction.UPDATE,
            entityType: "Product",
            entityRef: "bulk-recalc-retail-price-lazada-formula",
            meta: {
              rule: "retailPrice = (salePrice + 60) / 0.7218, round up to next multiple of 5",
              scope: "สินค้าทุกตัว (active + inactive) ที่ salePrice > 0 — เขียนทับราคาปลีกเดิมทั้งหมด",
              scannedCount: products.length,
              skippedNoWholesaleCount: skippedNoWholesale,
              updatedCount: changes.length,
              decreasedCount: changes.filter((c) => c.nextRetail < c.currentRetail).length,
              memberAboveRetailCount: memberAboveRetail.length,
              retailPriceListId: retailPriceList.id,
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

  console.log(`\n[APPLIED] อัปเดตราคาขายปลีก ${changes.length} รายการ + เขียน AuditLog แล้ว`);
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
