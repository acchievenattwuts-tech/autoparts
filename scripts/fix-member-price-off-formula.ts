import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

/**
 * แก้สินค้าที่ "ราคาสมาชิก" ไม่ตรงสูตรมาตรฐาน (สมาชิก = ราคาขายปลีก - 30%)
 *
 * เคสที่เจอจริง (2026-07-19): P0447 — พนักงานเปิดฟอร์มแก้ไขค้างไว้ก่อนสคริปต์ recalc
 * จะรัน พอกดบันทึกอัปโหลดรูปตอน 07:08 ฟอร์มส่งราคาสมาชิกค่าเก่าที่ค้างในหน้าจอ (1190)
 * ทับค่าที่สคริปต์เพิ่งคำนวณไว้ (950) — lost update ไม่ใช่บั๊กของสูตรหรือฟอร์ม
 *
 * Scope: เฉพาะแถวที่ retailPrice > 0 และ memberPrice ไม่ตรงสูตร
 *        สินค้าที่ตรงสูตรอยู่แล้วจะไม่ถูกแตะ
 *
 * Dry-run:  npx tsx --env-file=.env.local scripts/fix-member-price-off-formula.ts
 * Apply:    npx tsx --env-file=.env.local scripts/fix-member-price-off-formula.ts --apply
 */
import { db } from "../lib/db";
import { AuditAction } from "../lib/generated/prisma";
import { deriveMemberPriceFromRetail } from "../lib/product-pricing";

const TRANSACTION_TIMEOUT_MS = 60_000;

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const products = await db.product.findMany({
    where: { retailPrice: { gt: 0 } },
    select: { id: true, code: true, name: true, salePrice: true, retailPrice: true, memberPrice: true },
    orderBy: { code: "asc" },
  });

  const fixes = products
    .map((product) => ({
      id: product.id,
      code: product.code,
      name: product.name,
      wholesale: Number(product.salePrice),
      retail: Number(product.retailPrice),
      currentMember: Number(product.memberPrice),
      nextMember: deriveMemberPriceFromRetail(Number(product.retailPrice)),
    }))
    .filter((row) => row.currentMember !== row.nextMember);

  console.log("=".repeat(78));
  console.log(apply ? "APPLY MODE — จะเขียนลง DB จริง" : "DRY RUN — ยังไม่เขียน DB (ใส่ --apply เพื่อรันจริง)");
  console.log("=".repeat(78));
  console.log("สูตร: ราคาสมาชิก = ราคาขายปลีก x 0.70 (ปัดขึ้นลงท้ายด้วย 0)\n");
  console.log(`ตรวจ ${products.length} รายการ — ไม่ตรงสูตร ${fixes.length} รายการ\n`);

  for (const fix of fixes) {
    console.log(
      `  ${fix.code.padEnd(10)} ส่ง=${fix.wholesale.toFixed(2).padStart(9)}` +
        ` ปลีก=${fix.retail.toFixed(2).padStart(9)}` +
        `  สมาชิก ${fix.currentMember.toFixed(2).padStart(9)} -> ${fix.nextMember.toFixed(2).padStart(9)}` +
        `  ${fix.name}`,
    );
  }

  if (fixes.length === 0) {
    console.log("ไม่มีรายการที่ต้องแก้ — ราคาสมาชิกตรงสูตรทั้งหมด");
    await db.$disconnect();
    return;
  }

  // ลำดับราคาต้องไม่พังหลังแก้: ขายส่ง <= สมาชิก <= ขายปลีก
  const wouldBreakOrder = fixes.filter(
    (fix) => fix.wholesale > 0 && !(fix.wholesale <= fix.nextMember && fix.nextMember <= fix.retail),
  );
  if (wouldBreakOrder.length > 0) {
    console.error("\nหยุด: ค่าที่คำนวณได้ทำให้ลำดับราคาผิด (ขายส่ง <= สมาชิก <= ขายปลีก)");
    for (const row of wouldBreakOrder) console.error(`  ${row.code}`);
    await db.$disconnect();
    process.exit(1);
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
            data: { memberPrice: fix.nextMember },
          });
        }
        await tx.auditLog.create({
          data: {
            userName: "script",
            userRole: "system",
            action: AuditAction.UPDATE,
            entityType: "Product",
            entityRef: "fix-member-price-off-formula",
            meta: {
              rule: "memberPrice = retailPrice * 0.70, ceil to nearest 10",
              scope: "เฉพาะแถวที่ retailPrice > 0 และราคาสมาชิกไม่ตรงสูตร",
              cause:
                "ฟอร์มแก้ไขสินค้าที่เปิดค้างไว้ก่อนสคริปต์ recalc บันทึกทับค่าที่คำนวณใหม่ (lost update)",
              updatedCount: fixes.length,
              items: fixes.map((fix) => ({
                code: fix.code,
                wholesale: fix.wholesale,
                retail: fix.retail,
                memberBefore: fix.currentMember,
                memberAfter: fix.nextMember,
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
