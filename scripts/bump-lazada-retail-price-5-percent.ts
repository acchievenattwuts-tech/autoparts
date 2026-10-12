import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

/**
 * ปรับ "ราคา Lazada" (ProductPrice ของ PriceList channel = LAZADA) และ "ราคาขายปลีก"
 * (Product.retailPrice + ProductPrice ระดับ RETAIL) ขึ้น 5% จากราคาที่บันทึกอยู่ตอนนี้
 *
 *   ราคาใหม่ = ราคาเดิม × 1.05  ปัดขึ้นลงท้ายด้วย 5 หรือ 0 (เพิ่มขึ้นเสมอ)
 *
 * ใช้คู่กับสูตรใหม่ในฟอร์มสินค้า (lib/product-pricing.ts → LAZADA_PRICE_UPLIFT_MULTIPLIER)
 * ราคาที่เคยแก้เองรายตัวจะขึ้น 5% จากค่านั้น ไม่ถูกเขียนทับด้วยสูตร
 *
 * Scope: สินค้าทุกตัว (active + inactive) ที่มีราคา Lazada > 0
 *   - ราคาขายปลีกขึ้นตามเฉพาะสินค้าในชุดเดียวกันที่ราคาปลีก > 0
 *   - ไม่แตะราคาขายส่ง ราคาสมาชิก และราคา Shopee
 *
 * Safety:
 * - Dry-run เป็นค่าเริ่มต้น ต้องใส่ --apply ถึงจะเขียน DB
 * - เขียนใน transaction เดียว + บันทึก AuditLog 1 แถวสรุปการรัน
 * - รันซ้ำไม่ได้: ถ้าพบ AuditLog ของการรันนี้แล้ว จะหยุดก่อนเขียน (กันราคาขึ้นซ้อนเป็น 10%)
 *
 * Dry-run:  npx tsx --env-file=.env.local scripts/bump-lazada-retail-price-5-percent.ts
 * Apply:    npx tsx --env-file=.env.local scripts/bump-lazada-retail-price-5-percent.ts --apply
 */
import { db } from "../lib/db";
import { AuditAction, Prisma, SaleChannel } from "../lib/generated/prisma";
import { applyLazadaPriceUplift, LAZADA_PRICE_UPLIFT_MULTIPLIER } from "../lib/product-pricing";

const SAMPLE_SIZE = 20;
const TRANSACTION_TIMEOUT_MS = 120_000;
const RUN_ENTITY_REF = "bulk-uplift-lazada-retail-5pct-20261012";

type PriceUplift = {
  productId: string;
  code: string;
  lazadaCurrent: number;
  lazadaNext: number;
  retailCurrent: number;
  retailNext: number | null;
};

const formatPrice = (value: number): string => value.toFixed(2).padStart(9);

async function hasAlreadyRun(): Promise<boolean> {
  const existing = await db.auditLog.findFirst({
    where: { entityRef: RUN_ENTITY_REF },
    select: { id: true },
  });
  return existing !== null;
}

async function loadUplifts(lazadaListId: string): Promise<{ scannedCount: number; uplifts: PriceUplift[] }> {
  const rows = await db.productPrice.findMany({
    where: { priceListId: lazadaListId, amount: { gt: 0 } },
    select: {
      productId: true,
      amount: true,
      product: { select: { code: true, retailPrice: true } },
    },
    orderBy: { product: { code: "asc" } },
  });

  const uplifts = rows.map((row): PriceUplift => {
    const lazadaCurrent = Number(row.amount);
    const retailCurrent = Number(row.product.retailPrice);
    return {
      productId: row.productId,
      code: row.product.code,
      lazadaCurrent,
      lazadaNext: applyLazadaPriceUplift(lazadaCurrent),
      retailCurrent,
      retailNext: retailCurrent > 0 ? applyLazadaPriceUplift(retailCurrent) : null,
    };
  });
  return { scannedCount: rows.length, uplifts };
}

async function applyUplifts(
  uplifts: PriceUplift[],
  lazadaListId: string,
  retailListId: string,
  scannedCount: number,
): Promise<void> {
  const lazadaIds = uplifts.map((uplift) => uplift.productId);
  const lazadaAmounts = uplifts.map((uplift) => uplift.lazadaNext);
  const retailUplifts = uplifts.filter((uplift) => uplift.retailNext !== null);
  const retailIds = retailUplifts.map((uplift) => uplift.productId);
  const retailAmounts = retailUplifts.map((uplift) => uplift.retailNext);

  await db.$transaction(
    async (tx) => {
      const lazadaUpdated = await tx.$executeRaw(Prisma.sql`
        UPDATE "ProductPrice" AS pp
        SET "amount" = v.amount, "updatedAt" = now()
        FROM unnest(${lazadaIds}::text[], ${lazadaAmounts}::numeric[]) AS v(product_id, amount)
        WHERE pp."productId" = v.product_id AND pp."priceListId" = ${lazadaListId}
      `);
      const productUpdated = await tx.$executeRaw(Prisma.sql`
        UPDATE "Product" AS p
        SET "retailPrice" = v.amount, "updatedAt" = now()
        FROM unnest(${retailIds}::text[], ${retailAmounts}::numeric[]) AS v(product_id, amount)
        WHERE p."id" = v.product_id
      `);
      const retailRowsUpserted = await tx.$executeRaw(Prisma.sql`
        INSERT INTO "ProductPrice" ("productId", "priceListId", "amount", "createdAt", "updatedAt")
        SELECT v.product_id, ${retailListId}, v.amount, now(), now()
        FROM unnest(${retailIds}::text[], ${retailAmounts}::numeric[]) AS v(product_id, amount)
        ON CONFLICT ("productId", "priceListId")
        DO UPDATE SET "amount" = EXCLUDED."amount", "updatedAt" = now()
      `);

      if (lazadaUpdated !== uplifts.length || productUpdated !== retailUplifts.length || retailRowsUpserted !== retailUplifts.length) {
        throw new Error(
          `จำนวนแถวไม่ตรง: Lazada ${lazadaUpdated}/${uplifts.length}, ` +
            `retailPrice ${productUpdated}/${retailUplifts.length}, RETAIL rows ${retailRowsUpserted}/${retailUplifts.length}`,
        );
      }

      await tx.auditLog.create({
        data: {
          userName: "script",
          userRole: "system",
          action: AuditAction.UPDATE,
          entityType: "ProductPrice",
          entityRef: RUN_ENTITY_REF,
          meta: {
            rule: `lazada & retail = current price * ${LAZADA_PRICE_UPLIFT_MULTIPLIER}, round up to next multiple of 5`,
            scope: "สินค้าทุกตัว (active + inactive) ที่มีราคา Lazada > 0 — ราคาปลีกขึ้นตามเมื่อ > 0",
            scannedCount,
            lazadaUpdatedCount: uplifts.length,
            retailUpdatedCount: retailUplifts.length,
            lazadaPriceListId: lazadaListId,
            retailPriceListId: retailListId,
            before: uplifts.map((uplift) => ({
              code: uplift.code,
              lazada: uplift.lazadaCurrent,
              retail: uplift.retailCurrent,
            })),
          },
        },
      });
    },
    { timeout: TRANSACTION_TIMEOUT_MS },
  );
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const [lazadaList, retailList] = await Promise.all([
    db.priceList.findUnique({ where: { channel: SaleChannel.LAZADA }, select: { id: true } }),
    db.priceList.findUnique({ where: { code: "RETAIL" }, select: { id: true } }),
  ]);
  if (!lazadaList || !retailList) {
    throw new Error("ไม่พบ PriceList ของ Lazada หรือ RETAIL — ตรวจสอบ master data ก่อนรันสคริปต์");
  }

  const alreadyRun = await hasAlreadyRun();
  const { scannedCount, uplifts } = await loadUplifts(lazadaList.id);
  const retailCount = uplifts.filter((uplift) => uplift.retailNext !== null).length;
  const retailDiffersFromLazada = uplifts.filter((uplift) => uplift.retailCurrent !== uplift.lazadaCurrent).length;

  console.log("=".repeat(90));
  console.log(apply ? "APPLY MODE — จะเขียนลง DB จริง" : "DRY RUN — ยังไม่เขียน DB (ใส่ --apply เพื่อรันจริง)");
  console.log("=".repeat(90));
  console.log(`สูตร: ราคาใหม่ = ราคาเดิม × ${LAZADA_PRICE_UPLIFT_MULTIPLIER} ปัดขึ้นลงท้ายด้วย 5 หรือ 0 (เพิ่มขึ้นเสมอ)\n`);
  console.log(`สินค้าที่มีราคา Lazada: ${scannedCount} รายการ`);
  console.log(`จะปรับราคา Lazada: ${uplifts.length} รายการ`);
  console.log(`จะปรับราคาขายปลีก: ${retailCount} รายการ (ราคาปลีกไม่เท่าราคา Lazada อยู่เดิม ${retailDiffersFromLazada} รายการ)`);
  const increasePercents = uplifts.map((uplift) => (uplift.lazadaNext / uplift.lazadaCurrent - 1) * 100);
  if (increasePercents.length > 0) {
    const average = increasePercents.reduce((sum, value) => sum + value, 0) / increasePercents.length;
    console.log(
      `ราคา Lazada ขึ้นจริงหลังปัด: ต่ำสุด ${Math.min(...increasePercents).toFixed(2)}%` +
        ` · เฉลี่ย ${average.toFixed(2)}% · สูงสุด ${Math.max(...increasePercents).toFixed(2)}%`,
    );
  }
  console.log(`เคยรันสคริปต์นี้แล้ว: ${alreadyRun ? "ใช่" : "ยังไม่เคย"}\n`);

  console.log(`ตัวอย่าง ${Math.min(SAMPLE_SIZE, uplifts.length)} รายการแรก:`);
  for (const uplift of uplifts.slice(0, SAMPLE_SIZE)) {
    console.log(
      `  ${uplift.code.padEnd(14)} Lazada ${formatPrice(uplift.lazadaCurrent)} -> ${formatPrice(uplift.lazadaNext)}` +
        `  ปลีก ${formatPrice(uplift.retailCurrent)} -> ${uplift.retailNext === null ? "      (ข้าม)" : formatPrice(uplift.retailNext)}`,
    );
  }

  if (!apply) {
    console.log("\n(dry-run เท่านั้น — ยังไม่มีการเปลี่ยนแปลง)");
    return;
  }
  if (alreadyRun) {
    throw new Error(`พบ AuditLog ${RUN_ENTITY_REF} แล้ว — หยุดเพื่อกันราคาขึ้นซ้อน`);
  }
  if (uplifts.length === 0) {
    console.log("\nไม่มีรายการที่ต้องอัปเดต");
    return;
  }

  try {
    await applyUplifts(uplifts, lazadaList.id, retailList.id, scannedCount);
  } catch (error) {
    console.error("อัปเดตไม่สำเร็จ — ไม่มีการเปลี่ยนแปลงใด ๆ ถูกบันทึก (rollback แล้ว)");
    throw error;
  }

  console.log(`\n[APPLIED] ปรับราคา Lazada ${uplifts.length} รายการ + ราคาขายปลีก ${retailCount} รายการ + เขียน AuditLog แล้ว`);
}

main()
  .then(async () => {
    await db.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
