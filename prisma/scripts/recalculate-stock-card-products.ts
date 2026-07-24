/**
 * คำนวณสต็อกการ์ด (MAVG) ใหม่เฉพาะสินค้าที่ระบุ พร้อมจัดลำดับ sorder ใหม่ตาม
 * กฎลำดับธุรกิจ: BF → ของเข้าทุกชนิด → ของออกทุกชนิด (ดู lib/stock-card.ts)
 *
 * ใช้เครื่องคำนวณตัวเดียวกับระบบจริง (recalculateStockCardMany) จึงได้ผลเท่ากับ
 * การกดปุ่ม "คำนวณใหม่" ที่หน้ารายงานสต็อกการ์ด แต่จำกัดเฉพาะสินค้าที่สั่ง
 *
 * ดูผลก่อนโดยไม่เขียนจริง:
 *   npx tsx --env-file=.env prisma/scripts/recalculate-stock-card-products.ts --codes=P0488,P0489 --dry-run
 * เขียนจริง:
 *   npx tsx --env-file=.env prisma/scripts/recalculate-stock-card-products.ts --codes=P0488,P0489
 */
import { db, dbTx } from "../../lib/db";
import { recalculateStockCardMany } from "../../lib/stock-card";

const ROLLBACK_SIGNAL = "__dry_run_rollback__";

function getArg(name: string): string | undefined {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

type Snapshot = {
  code: string;
  stock: number;
  avgCost: string;
  rows: { docNo: string; source: string; sorder: number; qtyBalance: string; priceOut: string; priceBalance: string }[];
};

async function snapshot(productIds: string[]): Promise<Snapshot[]> {
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, code: true, stock: true, avgCost: true },
    orderBy: { code: "asc" },
  });

  const result: Snapshot[] = [];
  for (const product of products) {
    const rows = await db.stockCard.findMany({
      where: { productId: product.id },
      orderBy: [{ docDate: "asc" }, { sorder: "asc" }],
      select: { docNo: true, source: true, sorder: true, qtyBalance: true, priceOut: true, priceBalance: true },
    });
    result.push({
      code: product.code ?? "-",
      stock: product.stock,
      avgCost: product.avgCost.toString(),
      rows: rows.map((row) => ({
        docNo: row.docNo,
        source: row.source,
        sorder: row.sorder,
        qtyBalance: row.qtyBalance.toString(),
        priceOut: row.priceOut.toString(),
        priceBalance: row.priceBalance.toString(),
      })),
    });
  }
  return result;
}

function printSnapshot(label: string, snapshots: Snapshot[]): void {
  console.log(`\n===== ${label}`);
  for (const item of snapshots) {
    console.log(`  ${item.code} | stock=${item.stock} avgCost=${item.avgCost}`);
    item.rows.forEach((row) =>
      console.log(
        `    #${row.sorder} ${row.docNo} ${row.source} bal=${row.qtyBalance} priceOut=${row.priceOut} priceBalance=${row.priceBalance}`,
      ),
    );
  }
}

async function main(): Promise<void> {
  const codesArg = getArg("codes");
  if (!codesArg) throw new Error("ต้องระบุ --codes=P0001,P0002");
  const isDryRun = process.argv.includes("--dry-run");

  const codes = codesArg.split(",").map((code) => code.trim()).filter(Boolean);
  const products = await db.product.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  });
  const missing = codes.filter((code) => !products.some((product) => product.code === code));
  if (missing.length > 0) throw new Error(`ไม่พบสินค้ารหัส: ${missing.join(", ")}`);

  const productIds = products.map((product) => product.id);
  printSnapshot("ก่อนคำนวณใหม่", await snapshot(productIds));

  if (isDryRun) {
    try {
      await dbTx(async (tx) => {
        await recalculateStockCardMany(tx, productIds);

        // อ่านผลลัพธ์ภายใน transaction เดียวกันก่อน rollback
        const preview: Snapshot[] = [];
        for (const product of products) {
          const [stored, rows] = await Promise.all([
            tx.product.findUniqueOrThrow({ where: { id: product.id }, select: { stock: true, avgCost: true } }),
            tx.stockCard.findMany({
              where: { productId: product.id },
              orderBy: [{ docDate: "asc" }, { sorder: "asc" }],
              select: { docNo: true, source: true, sorder: true, qtyBalance: true, priceOut: true, priceBalance: true },
            }),
          ]);
          preview.push({
            code: product.code ?? "-",
            stock: stored.stock,
            avgCost: stored.avgCost.toString(),
            rows: rows.map((row) => ({
              docNo: row.docNo,
              source: row.source,
              sorder: row.sorder,
              qtyBalance: row.qtyBalance.toString(),
              priceOut: row.priceOut.toString(),
              priceBalance: row.priceBalance.toString(),
            })),
          });
        }
        printSnapshot("ผลที่จะได้ (dry-run)", preview);

        throw new Error(ROLLBACK_SIGNAL);
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== ROLLBACK_SIGNAL) throw error;
    }
    console.log("\n[dry-run] rollback แล้ว — ข้อมูลจริงไม่ถูกแก้");
    return;
  }

  const before = await snapshot(productIds);

  await dbTx(async (tx) => {
    await recalculateStockCardMany(tx, productIds);
  });

  const after = await snapshot(productIds);
  printSnapshot("หลังคำนวณใหม่", after);

  // Audit trail: การแก้ข้อมูลจริงต้องบันทึกไว้เสมอ แม้จะสั่งจากสคริปต์
  await db.auditLog.create({
    data: {
      userName: "maintenance-script",
      action: "RECALCULATE",
      entityType: "StockCard",
      entityId: productIds.join(","),
      entityRef: codes.join(","),
      before: JSON.parse(JSON.stringify(before)),
      after: JSON.parse(JSON.stringify(after)),
      meta: {
        script: "prisma/scripts/recalculate-stock-card-products.ts",
        reason: "จัดลำดับสต็อกการ์ดวันเดียวกันใหม่: BF → ของเข้า → ของออก",
      },
    },
  });
  console.log(`\n✅ คำนวณใหม่เสร็จ ${productIds.length} สินค้า: ${codes.join(", ")}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
