import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

/**
 * Bulk-update retailPrice = salePrice (wholesale) * 1.70, rounded UP so the
 * result always ends in 0 (ceil to nearest 10).
 *
 * Scope: every product with salePrice > 0 (active AND inactive).
 *
 * Safety:
 * - Dry-run by default (prints preview). Pass --apply to write.
 * - Runs inside a single transaction and writes ONE summary AuditLog row.
 */
import { db } from "../lib/db";
import { AuditAction } from "../lib/generated/prisma";

const MARKUP = 1.7;
const ROUND_TO = 10;

const computeRetail = (wholesale: number): number =>
  Math.ceil((wholesale * MARKUP) / ROUND_TO) * ROUND_TO;

async function main() {
  const apply = process.argv.includes("--apply");

  const products = await db.product.findMany({
    where: { salePrice: { gt: 0 } },
    select: { id: true, code: true, name: true, salePrice: true, retailPrice: true },
    orderBy: { code: "asc" },
  });

  const updates: { id: string; proposed: number }[] = [];
  const sample: string[] = [];
  for (const p of products) {
    const wholesale = Number(p.salePrice);
    const current = Number(p.retailPrice);
    const proposed = computeRetail(wholesale);
    if (proposed !== current) updates.push({ id: p.id, proposed });
    if (sample.length < 20) {
      sample.push(
        `${p.code.padEnd(16)} ส่ง=${wholesale.toFixed(2).padStart(10)}  ปลีกเดิม=${current
          .toFixed(2)
          .padStart(10)}  ปลีกใหม่=${proposed.toFixed(2).padStart(10)}`,
      );
    }
  }

  console.log(`Products with salePrice>0: ${products.length}`);
  console.log(`retailPrice จะถูกเปลี่ยน: ${updates.length} รายการ (ปัดขึ้นทีละ 10)\n`);
  console.log("ตัวอย่าง 20 รายการแรก:");
  console.log(sample.join("\n"));

  if (!apply) {
    console.log("\n[DRY-RUN] ยังไม่เขียน DB — ใส่ --apply เพื่ออัปเดตจริง");
    await db.$disconnect();
    return;
  }

  await db.$transaction(async (tx) => {
    for (const u of updates) {
      await tx.product.update({ where: { id: u.id }, data: { retailPrice: u.proposed } });
    }
    await tx.auditLog.create({
      data: {
        userName: "script",
        userRole: "system",
        action: AuditAction.UPDATE,
        entityType: "Product",
        entityRef: "bulk-retail-price-recalc",
        meta: {
          rule: "retailPrice = salePrice * 1.70, ceil to nearest 10",
          scope: "salePrice > 0 (active + inactive)",
          updatedCount: updates.length,
          scannedCount: products.length,
        },
      },
    });
  }, { timeout: 120000 });

  console.log(`\n[APPLIED] อัปเดต ${updates.length} รายการ + เขียน AuditLog แล้ว`);
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
