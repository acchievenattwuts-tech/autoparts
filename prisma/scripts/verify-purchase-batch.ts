/**
 * verify-purchase-batch.ts
 *
 * Validates the batched updatePurchase writes (2026-06-14) against the
 * per-row behaviour they replace, on REAL data, always inside a rolled-back
 * transaction (this script never persists anything).
 *
 *  Test 1 — bulk PurchaseItem UPDATE is a faithful no-op: feed each item's
 *           CURRENT values back through the batched UPDATE ... FROM VALUES and
 *           assert no column changed (proves SQL/column names + row targeting).
 *  Test 2 — batched LotBalance reverse == per-row reversePurchaseLotBalance:
 *           run both from the same start state in separate rolled-back txs and
 *           compare the resulting LotBalance rows.
 *  Test 3 — bulk StockCard landedCost UPDATE is a faithful no-op.
 *
 * Usage:
 *   npx tsx --env-file=.env.local prisma/scripts/verify-purchase-batch.ts
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "../../lib/generated/prisma";
import { reversePurchaseLotBalance } from "../../lib/lot-control";

const ROLLBACK = "__verify_rollback__";
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = new PrismaClient({ adapter });

const sqlText = (v: string | null) => (v === null ? "NULL" : `'${v.replace(/'/g, "''")}'`);
const sqlNum = (v: number) => (Number.isFinite(v) ? String(v) : "0");

async function rolledBack<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  let captured: T;
  try {
    await db.$transaction(async (tx) => {
      captured = await fn(tx);
      throw new Error(ROLLBACK);
    }, { timeout: 60_000 });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== ROLLBACK) throw e;
  }
  return captured!;
}

async function biggestPurchase(withLots: boolean): Promise<string | null> {
  const rows: { id: string }[] = await db.$queryRawUnsafe(
    withLots
      ? `SELECT p.id, count(l.id) AS n FROM "Purchase" p
         JOIN "PurchaseItem" pi ON pi."purchaseId"=p.id
         JOIN "PurchaseItemLot" l ON l."purchaseItemId"=pi.id
         WHERE p.status='ACTIVE' GROUP BY p.id ORDER BY n DESC LIMIT 1`
      : `SELECT p.id, count(pi.id) AS n FROM "Purchase" p
         JOIN "PurchaseItem" pi ON pi."purchaseId"=p.id
         WHERE p.status='ACTIVE' GROUP BY p.id ORDER BY n DESC LIMIT 1`,
  );
  return rows[0]?.id ?? null;
}

async function test1(purchaseId: string) {
  const itemSelect = {
    id: true, lineNo: true, supplierId: true, subtotalAmount: true, showQty: true,
    showUnitName: true, showPricePerUnit: true, unitScale: true, landedCost: true,
  } as const;
  const base = await db.purchaseItem.findMany({
    where: { purchaseId }, select: { id: true }, orderBy: { id: "asc" },
  });

  // Synthetic-but-realistic new values per line (numbers, never null) — exactly
  // what the matched-sync path computes. Test both landedCost modes.
  const newVals = base.map((r, i) => ({
    id: r.id,
    supplierId: null as string | null,
    lineNo: i + 1,
    subtotalAmount: 100 + i,
    showQty: 2 + (i % 3),
    showUnitName: "ชิ้น",
    showPricePerUnit: 50 + i,
    unitScale: 1 + (i % 2),
    landedCostPerSelectedUnit: 3.25 + i,
  }));

  const snapshot = (tx: Prisma.TransactionClient) =>
    tx.purchaseItem.findMany({ where: { purchaseId }, select: itemSelect, orderBy: { id: "asc" } })
      .then((rows) => JSON.stringify(rows));

  for (const landedSync of [false, true]) {
    const oldResult = await rolledBack(async (tx) => {
      for (const v of newVals) {
        await tx.purchaseItem.update({
          where: { id: v.id },
          data: {
            supplierId: v.supplierId, lineNo: v.lineNo, subtotalAmount: v.subtotalAmount,
            showQty: v.showQty, showUnitName: v.showUnitName, showPricePerUnit: v.showPricePerUnit,
            unitScale: v.unitScale,
            ...(landedSync ? { landedCost: v.landedCostPerSelectedUnit } : {}),
          },
        });
      }
      return snapshot(tx);
    });

    const newResult = await rolledBack(async (tx) => {
      const values = newVals.map((v) => `(
        ${sqlText(v.id)}, ${v.lineNo}::int, ${sqlNum(v.subtotalAmount)}::numeric,
        ${sqlNum(v.showQty)}::numeric, ${sqlText(v.showUnitName)},
        ${sqlNum(v.showPricePerUnit)}::numeric, ${sqlNum(v.unitScale)}::numeric,
        ${landedSync ? `${sqlNum(v.landedCostPerSelectedUnit)}::numeric` : "NULL::numeric"}
      )`).join(",");
      await tx.$executeRawUnsafe(`
        UPDATE "PurchaseItem" AS pi SET
          "supplierId" = ${sqlText(null)},
          "lineNo" = d."lineNo", "subtotalAmount" = d."subtotalAmount",
          "showQty" = d."showQty", "showUnitName" = d."showUnitName",
          "showPricePerUnit" = d."showPricePerUnit", "unitScale" = d."unitScale",
          "landedCost" = COALESCE(d."landedCost", pi."landedCost")
        FROM (VALUES ${values}) AS d("id","lineNo","subtotalAmount","showQty","showUnitName","showPricePerUnit","unitScale","landedCost")
        WHERE pi."id" = d."id"`);
      return snapshot(tx);
    });

    if (oldResult !== newResult) {
      console.log(`Test 1 (bulk == per-row, landedSync=${landedSync}): ❌ FAIL`);
      const a = JSON.parse(oldResult), b = JSON.parse(newResult);
      for (let i = 0; i < a.length; i++) if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) {
        console.log("  old:", JSON.stringify(a[i]), "\n  new:", JSON.stringify(b[i])); break;
      }
      return false;
    }
    console.log(`Test 1 (bulk == per-row, landedSync=${landedSync}): ✅ PASS (${newVals.length} items)`);
  }
  return true;
}

async function test2(purchaseId: string) {
  const items = await db.purchaseItem.findMany({ where: { purchaseId }, select: { id: true, productId: true } });
  const lots = await db.purchaseItemLot.findMany({
    where: { purchaseItemId: { in: items.map((i) => i.id) } },
    select: { purchaseItemId: true, lotNo: true, qty: true },
  });
  const productByItem = new Map(items.map((i) => [i.id, i.productId]));
  const affected = new Set(lots.map((l) => `${productByItem.get(l.purchaseItemId)} ${l.lotNo}`));

  const snapshot = async (tx: Prisma.TransactionClient) => {
    const rows = await tx.lotBalance.findMany({ select: { productId: true, lotNo: true, qtyOnHand: true } });
    return rows
      .filter((r) => affected.has(`${r.productId} ${r.lotNo}`))
      .map((r) => `${r.productId}|${r.lotNo}|${r.qtyOnHand.toString()}`)
      .sort()
      .join("\n");
  };

  const resultOld = await rolledBack(async (tx) => {
    for (const it of items) await reversePurchaseLotBalance(tx, it.id, it.productId);
    return snapshot(tx);
  });

  const resultNew = await rolledBack(async (tx) => {
    const dec = new Map<string, { productId: string; lotNo: string; dec: Prisma.Decimal }>();
    for (const lot of lots) {
      const productId = productByItem.get(lot.purchaseItemId);
      if (!productId) continue;
      const key = `${productId} ${lot.lotNo}`;
      const ex = dec.get(key);
      if (ex) ex.dec = ex.dec.add(lot.qty);
      else dec.set(key, { productId, lotNo: lot.lotNo, dec: new Prisma.Decimal(lot.qty) });
    }
    if (dec.size > 0) {
      const values = [...dec.values()].map((d) => `(${sqlText(d.productId)}, ${sqlText(d.lotNo)}, ${d.dec.toString()}::numeric)`).join(",");
      await tx.$executeRawUnsafe(`
        UPDATE "LotBalance" AS lb SET "qtyOnHand" = GREATEST(lb."qtyOnHand" - d."dec", 0)
        FROM (VALUES ${values}) AS d("productId","lotNo","dec")
        WHERE lb."productId" = d."productId" AND lb."lotNo" = d."lotNo"`);
    }
    return snapshot(tx);
  });

  const ok = resultOld === resultNew;
  console.log(`Test 2 (batched LotBalance reverse == per-row): ${ok ? "✅ PASS" : "❌ FAIL"} (${lots.length} lot rows)`);
  if (!ok) { console.log("  OLD:\n" + resultOld); console.log("  NEW:\n" + resultNew); }
  return ok;
}

async function test3(purchaseId: string) {
  const sc = await db.stockCard.findMany({
    where: { docNo: (await db.purchase.findUnique({ where: { id: purchaseId }, select: { purchaseNo: true } }))!.purchaseNo },
    select: { id: true, landedCost: true },
  });
  if (sc.length === 0) { console.log("Test 3 (bulk StockCard landedCost no-op): ⚠️  skipped (no stock cards)"); return true; }
  const before = JSON.stringify(sc.map((r) => `${r.id}|${r.landedCost.toString()}`).sort());

  const after = await rolledBack(async (tx) => {
    const values = sc.map((r) => `(${sqlText(r.id)}, ${sqlNum(Number(r.landedCost))}::numeric)`).join(",");
    await tx.$executeRawUnsafe(`
      UPDATE "StockCard" AS sc SET "landedCost" = d."landedCost"
      FROM (VALUES ${values}) AS d("id","landedCost")
      WHERE sc."id" = d."id"`);
    const rows = await tx.stockCard.findMany({ where: { id: { in: sc.map((r) => r.id) } }, select: { id: true, landedCost: true } });
    return JSON.stringify(rows.map((r) => `${r.id}|${r.landedCost.toString()}`).sort());
  });

  const ok = before === after;
  console.log(`Test 3 (bulk StockCard landedCost no-op): ${ok ? "✅ PASS" : "❌ FAIL"} (${sc.length} rows)`);
  return ok;
}

async function main() {
  const big = await biggestPurchase(false);
  const bigLots = await biggestPurchase(true);
  if (!big) { console.log("no ACTIVE purchase found"); return; }
  console.log(`big purchase: ${big}`);
  if (bigLots) console.log(`big lot purchase: ${bigLots}\n`);

  const r1 = await test1(big);
  const r2 = bigLots ? await test2(bigLots) : true;
  const r3 = await test3(big);

  console.log("\n" + (r1 && r2 && r3 ? "✅ ALL PASS — batched writes match per-row behaviour." : "❌ FAILURES present — do not deploy."));
  process.exitCode = r1 && r2 && r3 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
