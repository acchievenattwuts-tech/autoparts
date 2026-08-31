import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

/**
 * อัปเดต "ราคา Shopee" + "ราคา Lazada" (ProductPrice ของ PriceList ที่ channel = SHOPEE / LAZADA)
 * จาก "ราคาขายส่ง" (Product.salePrice)
 *
 * สูตรเดียวกับฟอร์มสินค้า (lib/product-pricing.ts):
 *   Shopee = (salePrice + 60 + 1.07) / 0.8288  ปัดขึ้นลงท้ายด้วย 5 หรือ 0 (เพิ่มขึ้นเสมอ)
 *   Lazada = (salePrice + 60)        / 0.7218  ปัดขึ้นลงท้ายด้วย 5 หรือ 0 (เพิ่มขึ้นเสมอ)
 *
 * Scope: สินค้าทุกตัว (active + inactive) ที่มี salePrice > 0 — **เขียนทับราคาเดิมทั้งหมด**
 *   - salePrice <= 0 → คำนวณไม่ได้ ข้ามทั้งแถว
 *
 * Safety:
 * - Dry-run เป็นค่าเริ่มต้น ต้องใส่ --apply ถึงจะเขียน DB
 * - เขียนใน transaction เดียว + บันทึก AuditLog 1 แถวสรุปการรัน
 *
 * Dry-run:  npx tsx --env-file=.env.local scripts/recalc-marketplace-prices-from-wholesale.ts
 * Apply:    npx tsx --env-file=.env.local scripts/recalc-marketplace-prices-from-wholesale.ts --apply
 */
import { db } from "../lib/db";
import { AuditAction, SaleChannel } from "../lib/generated/prisma";
import { deriveMarketplacePricesFromWholesale } from "../lib/product-pricing";

const SAMPLE_SIZE = 20;
const TRANSACTION_TIMEOUT_MS = 180_000;

type ChannelPriceUpdate = {
  productId: string;
  code: string;
  wholesale: number;
  shopeeCurrent: number | null;
  shopeeNext: number;
  lazadaCurrent: number | null;
  lazadaNext: number;
};

const formatPrice = (value: number | null): string =>
  value === null ? "     —" : value.toFixed(2).padStart(9);

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const [shopeeList, lazadaList] = await Promise.all([
    db.priceList.findUnique({ where: { channel: SaleChannel.SHOPEE }, select: { id: true, name: true } }),
    db.priceList.findUnique({ where: { channel: SaleChannel.LAZADA }, select: { id: true, name: true } }),
  ]);

  if (!shopeeList || !lazadaList) {
    throw new Error("ไม่พบ PriceList ของช่องทาง Shopee หรือ Lazada — ตรวจสอบ master data ก่อนรันสคริปต์");
  }

  const products = await db.product.findMany({
    select: {
      id: true,
      code: true,
      salePrice: true,
      prices: {
        where: { priceListId: { in: [shopeeList.id, lazadaList.id] } },
        select: { priceListId: true, amount: true },
      },
    },
    orderBy: { code: "asc" },
  });

  const changes: ChannelPriceUpdate[] = [];
  let skippedNoWholesale = 0;

  for (const product of products) {
    const wholesale = Number(product.salePrice);
    if (wholesale <= 0) {
      skippedNoWholesale += 1;
      continue;
    }

    const shopeeRow = product.prices.find((price) => price.priceListId === shopeeList.id);
    const lazadaRow = product.prices.find((price) => price.priceListId === lazadaList.id);
    const shopeeCurrent = shopeeRow ? Number(shopeeRow.amount) : null;
    const lazadaCurrent = lazadaRow ? Number(lazadaRow.amount) : null;

    const { shopeePrice, lazadaPrice } = deriveMarketplacePricesFromWholesale(wholesale);

    if (shopeeCurrent === shopeePrice && lazadaCurrent === lazadaPrice) continue;

    changes.push({
      productId: product.id,
      code: product.code,
      wholesale,
      shopeeCurrent,
      shopeeNext: shopeePrice,
      lazadaCurrent,
      lazadaNext: lazadaPrice,
    });
  }

  console.log("=".repeat(90));
  console.log(apply ? "APPLY MODE — จะเขียนลง DB จริง" : "DRY RUN — ยังไม่เขียน DB (ใส่ --apply เพื่อรันจริง)");
  console.log("=".repeat(90));
  console.log("สูตร: Shopee = (ขายส่ง + 60 + 1.07) / 0.8288, Lazada = (ขายส่ง + 60) / 0.7218");
  console.log("ปัดขึ้นให้ลงท้ายด้วย 5 หรือ 0 (เพิ่มขึ้นเสมอ) — เขียนทับราคาเดิมทั้งหมด\n");
  console.log(`สินค้าทั้งหมด: ${products.length} รายการ`);
  console.log(`ข้าม (ยังไม่มีราคาขายส่ง): ${skippedNoWholesale} รายการ`);
  console.log(`จะอัปเดต: ${changes.length} รายการ\n`);

  console.log(`ตัวอย่าง ${Math.min(SAMPLE_SIZE, changes.length)} รายการแรก:`);
  for (const change of changes.slice(0, SAMPLE_SIZE)) {
    console.log(
      `  ${change.code.padEnd(14)} ส่ง=${change.wholesale.toFixed(2).padStart(9)}` +
        `  Shopee ${formatPrice(change.shopeeCurrent)} -> ${change.shopeeNext.toFixed(2).padStart(9)}` +
        `  Lazada ${formatPrice(change.lazadaCurrent)} -> ${change.lazadaNext.toFixed(2).padStart(9)}`,
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
          await tx.productPrice.upsert({
            where: { productId_priceListId: { productId: change.productId, priceListId: shopeeList.id } },
            create: { productId: change.productId, priceListId: shopeeList.id, amount: change.shopeeNext },
            update: { amount: change.shopeeNext },
          });
          await tx.productPrice.upsert({
            where: { productId_priceListId: { productId: change.productId, priceListId: lazadaList.id } },
            create: { productId: change.productId, priceListId: lazadaList.id, amount: change.lazadaNext },
            update: { amount: change.lazadaNext },
          });
        }
        await tx.auditLog.create({
          data: {
            userName: "script",
            userRole: "system",
            action: AuditAction.UPDATE,
            entityType: "ProductPrice",
            entityRef: "bulk-recalc-marketplace-price",
            meta: {
              rule: "shopee = (salePrice + 60 + 1.07) / 0.8288, lazada = (salePrice + 60) / 0.7218, round up to next multiple of 5",
              scope: "สินค้าทุกตัว (active + inactive) ที่ salePrice > 0 — เขียนทับราคาเดิมทั้งหมด",
              scannedCount: products.length,
              skippedNoWholesaleCount: skippedNoWholesale,
              updatedCount: changes.length,
              shopeePriceListId: shopeeList.id,
              lazadaPriceListId: lazadaList.id,
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

  console.log(`\n[APPLIED] อัปเดต ${changes.length} รายการ (Shopee + Lazada) + เขียน AuditLog แล้ว`);
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
