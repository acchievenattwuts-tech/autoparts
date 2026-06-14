/**
 * verify-recalc-many.ts
 *
 * Proves the batched recalculators introduced 2026-06-14 are byte-identical to
 * the per-row versions they replace, on REAL data, always inside rolled-back
 * transactions (this script never persists anything).
 *
 *  Test A — recalculateStockCardMany(tx, ids) == looping recalculateStockCard:
 *           compare the resulting StockCard balances + Product stock/avgCost.
 *  Test B — refreshProductPurchaseLastFields bulk UPDATE == per-row update:
 *           compare resulting Product purchaseLast* fields.
 *
 * Usage:
 *   npx tsx --env-file=.env.local prisma/scripts/verify-recalc-many.ts
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "../../lib/generated/prisma";
import { recalculateStockCard, recalculateStockCardMany } from "../../lib/stock-card";
import {
  refreshProductPurchaseLastFields,
  buildProductPurchaseLastSnapshots,
} from "../../lib/product-purchase-last";

const ROLLBACK = "__verify_rollback__";
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = new PrismaClient({ adapter });

async function rolledBack<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  let captured: T;
  try {
    await db.$transaction(async (tx) => {
      captured = await fn(tx);
      throw new Error(ROLLBACK);
    }, { timeout: 170_000 });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== ROLLBACK) throw e;
  }
  return captured!;
}

async function stockSnapshot(tx: Prisma.TransactionClient, productIds: string[]): Promise<string> {
  const sc = await tx.stockCard.findMany({
    where: { productId: { in: productIds } },
    select: { id: true, qtyBalance: true, priceBalance: true, priceOut: true },
    orderBy: { id: "asc" },
  });
  const prod = await tx.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, stock: true, avgCost: true },
    orderBy: { id: "asc" },
  });
  return JSON.stringify({
    sc: sc.map((r) => `${r.id}|${r.qtyBalance}|${r.priceBalance}|${r.priceOut}`),
    prod: prod.map((r) => `${r.id}|${r.stock}|${r.avgCost}`),
  });
}

async function lastSnapshot(tx: Prisma.TransactionClient, productIds: string[]): Promise<string> {
  const prod = await tx.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, purchaseLastPrice: true, purchaseLastDate: true, purchaseUnitName: true },
    orderBy: { id: "asc" },
  });
  return JSON.stringify(prod.map((r) => `${r.id}|${r.purchaseLastPrice}|${r.purchaseLastDate?.toISOString() ?? "null"}|${r.purchaseUnitName}`));
}

// Faithful re-implementation of the OLD per-row refreshProductPurchaseLastFields.
async function refreshPerRowReference(tx: Prisma.TransactionClient, productIdsInput: string[]) {
  const productIds = [...new Set(productIdsInput.filter(Boolean))];
  if (productIds.length === 0) return;
  const rows = await tx.purchaseItem.findMany({
    where: { productId: { in: productIds }, purchase: { status: "ACTIVE" } },
    orderBy: [
      { productId: "asc" }, { purchase: { purchaseDate: "desc" } },
      { purchase: { purchaseNo: "desc" } }, { lineNo: "desc" }, { id: "desc" },
    ],
    select: {
      id: true, productId: true, lineNo: true, costPrice: true, showPricePerUnit: true,
      showUnitName: true, purchase: { select: { purchaseDate: true, purchaseNo: true } },
      product: { select: { purchaseUnitName: true } },
    },
  });
  const snapshots = buildProductPurchaseLastSnapshots(rows.map((row) => ({
    id: row.id, productId: row.productId, purchaseDate: row.purchase.purchaseDate,
    purchaseNo: row.purchase.purchaseNo, lineNo: row.lineNo, costPrice: Number(row.costPrice),
    showPricePerUnit: row.showPricePerUnit == null ? null : Number(row.showPricePerUnit),
    showUnitName: row.showUnitName, productPurchaseUnitName: row.product.purchaseUnitName,
  })));
  const byProduct = new Map(snapshots.map((s) => [s.productId, s]));
  for (const productId of productIds) {
    const s = byProduct.get(productId);
    await tx.product.update({
      where: { id: productId },
      data: s
        ? { purchaseLastPrice: new Prisma.Decimal(s.purchaseLastPrice), purchaseLastDate: s.purchaseLastDate, purchaseUnitName: s.purchaseUnitName }
        : { purchaseLastPrice: null, purchaseLastDate: null },
    });
  }
}

async function main() {
  const distinct = await db.stockCard.findMany({ distinct: ["productId"], select: { productId: true } });
  const productIds = distinct.map((r) => r.productId);
  console.log(`products under test: ${productIds.length}\n`);

  // Test A — batched recalc vs per-product loop
  const many = await rolledBack(async (tx) => { await recalculateStockCardMany(tx, productIds); return stockSnapshot(tx, productIds); });
  const loop = await rolledBack(async (tx) => { for (const pid of productIds) await recalculateStockCard(tx, pid); return stockSnapshot(tx, productIds); });
  const okA = many === loop;
  console.log(`Test A (recalculateStockCardMany == per-product loop): ${okA ? "✅ PASS" : "❌ FAIL"}`);
  if (!okA) {
    const a = JSON.parse(many), b = JSON.parse(loop);
    for (let i = 0; i < a.sc.length; i++) if (a.sc[i] !== b.sc[i]) { console.log("  sc many:", a.sc[i], "\n  sc loop:", b.sc[i]); break; }
    for (let i = 0; i < a.prod.length; i++) if (a.prod[i] !== b.prod[i]) { console.log("  prod many:", a.prod[i], "\n  prod loop:", b.prod[i]); break; }
  }

  // Test B — batched purchase-last refresh vs per-row
  const refNew = await rolledBack(async (tx) => { await refreshProductPurchaseLastFields(tx, productIds); return lastSnapshot(tx, productIds); });
  const refOld = await rolledBack(async (tx) => { await refreshPerRowReference(tx, productIds); return lastSnapshot(tx, productIds); });
  const okB = refNew === refOld;
  console.log(`Test B (refreshProductPurchaseLastFields bulk == per-row): ${okB ? "✅ PASS" : "❌ FAIL"}`);
  if (!okB) {
    const a = JSON.parse(refNew), b = JSON.parse(refOld);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { console.log("  new:", a[i], "\n  old:", b[i]); break; }
  }

  console.log("\n" + (okA && okB ? "✅ ALL PASS — batched recalc/refresh match per-row behaviour." : "❌ FAILURES — do not deploy."));
  process.exitCode = okA && okB ? 0 : 1;
  await db.$disconnect();
}

main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exitCode = 1; });
