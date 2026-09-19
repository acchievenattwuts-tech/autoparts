import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

/**
 * อัปเดต "ราคา Shopee" (ProductPrice ของ PriceList ที่ channel = SHOPEE)
 * จาก "ราคาขายส่ง" (Product.salePrice)
 *
 * สูตรเดียวกับฟอร์มสินค้า (lib/product-pricing.ts):
 *   Shopee = salePrice × 1.35 แล้วปัดขึ้นลงท้ายด้วย 5 หรือ 0 (เพิ่มขึ้นเสมอ)
 *
 * Scope: สินค้าทุกตัว (active + inactive) ที่มี salePrice > 0 — เขียนทับราคาเดิมทั้งหมด
 *   - salePrice <= 0 → คำนวณไม่ได้ ข้ามแถว
 *
 * Safety:
 * - Dry-run เป็นค่าเริ่มต้น ต้องใส่ --apply ถึงจะเขียน DB
 * - เขียนใน transaction เดียว + บันทึก AuditLog 1 แถวสรุปการรัน
 *
 * Dry-run:  npx tsx --env-file=.env.local scripts/recalc-shopee-price-from-wholesale.ts
 * Apply:    npx tsx --env-file=.env.local scripts/recalc-shopee-price-from-wholesale.ts --apply
 */
import { db } from "../lib/db";
import { AuditAction, SaleChannel } from "../lib/generated/prisma";
import { deriveShopeePriceFromWholesale } from "../lib/product-pricing";

const SAMPLE_SIZE = 20;
const TRANSACTION_TIMEOUT_MS = 180_000;

type ShopeePriceUpdate = {
  productId: string;
  code: string;
  wholesale: number;
  current: number | null;
  next: number;
};

const formatPrice = (value: number | null): string =>
  value === null ? "     —" : value.toFixed(2).padStart(9);

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const shopeeList = await db.priceList.findUnique({
    where: { channel: SaleChannel.SHOPEE },
    select: { id: true, name: true },
  });

  if (!shopeeList) {
    throw new Error("ไม่พบระดับราคา Shopee — ตรวจสอบ master data ก่อนรันสคริปต์");
  }

  const products = await db.product.findMany({
    select: {
      id: true,
      code: true,
      salePrice: true,
      prices: {
        where: { priceListId: shopeeList.id },
        select: { amount: true },
      },
    },
    orderBy: { code: "asc" },
  });

  const changes: ShopeePriceUpdate[] = [];
  let skippedNoWholesale = 0;

  for (const product of products) {
    const wholesale = Number(product.salePrice);
    if (wholesale <= 0) {
      skippedNoWholesale += 1;
      continue;
    }

    const current = product.prices[0] ? Number(product.prices[0].amount) : null;
    const next = deriveShopeePriceFromWholesale(wholesale);
    if (current === next) continue;

    changes.push({ productId: product.id, code: product.code, wholesale, current, next });
  }

  console.log("=".repeat(76));
  console.log(apply ? "APPLY MODE — จะเขียนลง DB จริง" : "DRY RUN — ยังไม่เขียน DB (ใส่ --apply เพื่อรันจริง)");
  console.log("=".repeat(76));
  console.log("สูตร: ราคา Shopee = ราคาขายส่ง x 1.35 แล้วปัดขึ้นลงท้าย 5 หรือ 0");
  console.log(`ระดับราคา: ${shopeeList.name}`);
  console.log(`สินค้าทั้งหมด: ${products.length} รายการ`);
  console.log(`ข้าม (ยังไม่มีราคาขายส่ง): ${skippedNoWholesale} รายการ`);
  console.log(`ต้องอัปเดต: ${changes.length} รายการ\n`);

  console.log(`ตัวอย่าง ${Math.min(SAMPLE_SIZE, changes.length)} รายการแรก:`);
  for (const change of changes.slice(0, SAMPLE_SIZE)) {
    console.log(
      `  ${change.code.padEnd(14)} ส่ง=${change.wholesale.toFixed(2).padStart(9)}` +
        `  Shopee ${formatPrice(change.current)} -> ${change.next.toFixed(2).padStart(9)}`,
    );
  }

  if (!apply) {
    console.log("\n(dry-run เท่านั้น — ยังไม่มีการเปลี่ยนแปลง)");
    return;
  }

  if (changes.length === 0) {
    console.log("\nไม่มีรายการที่ต้องอัปเดต");
    return;
  }

  try {
    await db.$transaction(
      async (tx) => {
        for (const change of changes) {
          await tx.productPrice.upsert({
            where: { productId_priceListId: { productId: change.productId, priceListId: shopeeList.id } },
            create: { productId: change.productId, priceListId: shopeeList.id, amount: change.next },
            update: { amount: change.next },
          });
        }

        await tx.auditLog.create({
          data: {
            userName: "script",
            userRole: "system",
            action: AuditAction.UPDATE,
            entityType: "ProductPrice",
            entityRef: "bulk-recalc-shopee-price",
            meta: {
              rule: "shopee = salePrice * 1.35, round up to next multiple of 5",
              scope: "สินค้าทุกตัว (active + inactive) ที่ salePrice > 0 — เขียนทับราคา Shopee เดิมทั้งหมด",
              scannedCount: products.length,
              skippedNoWholesaleCount: skippedNoWholesale,
              updatedCount: changes.length,
              shopeePriceListId: shopeeList.id,
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

  console.log(`\n[APPLIED] อัปเดตราคา Shopee ${changes.length} รายการ + เขียน AuditLog แล้ว`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
