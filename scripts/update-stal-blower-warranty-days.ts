/**
 * ตั้งระยะเวลาประกัน (warrantyDays) = 180 วัน
 * ขอบเขต: สินค้ายี่ห้อ STAL ในหมวด
 *   - โบเวอร์ พัดลมแอร์ (Blower Motor)
 *   - มอเตอร์พัดลมหน้าเครื่อง / หน้าแผงแอร์ (Condenser Fan Motor)
 *
 * ค่าเริ่มต้นคือ dry-run (ไม่เขียน DB) — ส่ง --apply เพื่อเขียนจริง
 *
 *   npx tsx --env-file=.env.local scripts/update-stal-blower-warranty-days.ts
 *   npx tsx --env-file=.env.local scripts/update-stal-blower-warranty-days.ts --apply
 */
import { db } from "../lib/db";

const TARGET_WARRANTY_DAYS = 180;
const BRAND_NAME = "STAL";
const CATEGORY_NAMES = [
  "โบเวอร์ พัดลมแอร์ (Blower Motor)",
  "มอเตอร์พัดลมหน้าเครื่อง / หน้าแผงแอร์ (Condenser Fan Motor)",
] as const;

type TargetProduct = {
  id: string;
  code: string;
  name: string;
  warrantyDays: number;
  categoryId: string;
};

const main = async (): Promise<void> => {
  const isApply = process.argv.includes("--apply");

  const [brand, categories] = await Promise.all([
    db.partsBrand.findFirst({
      where: { name: BRAND_NAME },
      select: { id: true, name: true },
    }),
    db.category.findMany({
      where: { name: { in: [...CATEGORY_NAMES] } },
      select: { id: true, name: true },
    }),
  ]);

  if (!brand) {
    throw new Error(`ไม่พบยี่ห้อ "${BRAND_NAME}"`);
  }
  if (categories.length !== CATEGORY_NAMES.length) {
    throw new Error(
      `พบหมวดหมู่ ${categories.length}/${CATEGORY_NAMES.length} รายการ: ${categories.map((c) => c.name).join(", ")}`,
    );
  }

  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

  const products: TargetProduct[] = await db.product.findMany({
    where: {
      brandId: brand.id,
      categoryId: { in: categories.map((c) => c.id) },
    },
    select: { id: true, code: true, name: true, warrantyDays: true, categoryId: true },
    orderBy: { code: "asc" },
  });

  const toUpdate = products.filter((p) => p.warrantyDays !== TARGET_WARRANTY_DAYS);

  console.log(`ยี่ห้อ: ${brand.name}`);
  for (const c of categories) {
    const inCat = products.filter((p) => p.categoryId === c.id);
    console.log(`  - ${c.name}: ${inCat.length} รหัส`);
  }
  console.log(`\nสินค้าทั้งหมดในขอบเขต: ${products.length} รหัส`);
  console.log(`ต้องเปลี่ยนเป็น ${TARGET_WARRANTY_DAYS} วัน: ${toUpdate.length} รหัส`);
  console.log(`ตรงค่าเป้าหมายอยู่แล้ว: ${products.length - toUpdate.length} รหัส\n`);

  for (const p of toUpdate) {
    console.log(
      `${p.code}\t${p.warrantyDays} → ${TARGET_WARRANTY_DAYS}\t[${categoryNameById.get(p.categoryId) ?? "-"}]\t${p.name}`,
    );
  }

  if (toUpdate.length === 0) {
    console.log("\nไม่มีรายการต้องอัปเดต");
    return;
  }

  if (!isApply) {
    console.log(`\n[DRY-RUN] ยังไม่เขียน DB — สั่ง --apply เพื่ออัปเดตจริง`);
    return;
  }

  await db.$transaction(async (tx) => {
    await tx.product.updateMany({
      where: { id: { in: toUpdate.map((p) => p.id) } },
      data: { warrantyDays: TARGET_WARRANTY_DAYS },
    });

    await tx.auditLog.create({
      data: {
        action: "UPDATE",
        entityType: "Product",
        entityRef: `${BRAND_NAME} / โบเวอร์ + มอเตอร์พัดลมหน้าเครื่อง`,
        userName: "script:update-stal-blower-warranty-days",
        before: toUpdate.map((p) => ({ code: p.code, warrantyDays: p.warrantyDays })),
        after: toUpdate.map((p) => ({ code: p.code, warrantyDays: TARGET_WARRANTY_DAYS })),
        meta: {
          script: "scripts/update-stal-blower-warranty-days.ts",
          brand: BRAND_NAME,
          categories: [...CATEGORY_NAMES],
          updatedCount: toUpdate.length,
          targetWarrantyDays: TARGET_WARRANTY_DAYS,
        },
      },
    });
  });

  console.log(`\n[APPLIED] อัปเดต ${toUpdate.length} รหัส เป็น ${TARGET_WARRANTY_DAYS} วัน + บันทึก AuditLog แล้ว`);
};

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
