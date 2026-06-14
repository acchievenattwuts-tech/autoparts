/**
 * verify-recalc-diff-write.ts
 *
 * Proves the diff-write `recalculateStockCard()` (2026-06-14) leaves the
 * StockCard / Product state BYTE-IDENTICAL to a full rewrite.
 *
 * How it works, per product (inside a transaction that is ALWAYS rolled back —
 * this script never persists anything):
 *   1. Snapshot the currently-stored balances of every StockCard row.
 *   2. Run the real `recalculateStockCard(tx, productId)` (diff-write version).
 *   3. Read the resulting balances back.
 *   4. Independently recompute the FULL replay in JS using the exact same MAVG
 *      formula, rounded to the column scale Postgres uses (numeric half-away-
 *      from-zero). This is the reference = what a full rewrite would store.
 *   5. Assert: result-after-recalc == reference for every row + Product.
 *   6. Also report how many rows actually differed from the original snapshot
 *      (= the rows diff-write touched) to show the performance win and confirm
 *      every skipped row was already correct.
 *   7. Roll back.
 *
 * Usage:
 *   npx tsx --env-file=.env.local prisma/scripts/verify-recalc-diff-write.ts
 *   npx tsx --env-file=.env.local prisma/scripts/verify-recalc-diff-write.ts --limit=200
 *   npx tsx --env-file=.env.local prisma/scripts/verify-recalc-diff-write.ts --product=<productId>
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "../../lib/generated/prisma";
import { recalculateStockCard } from "../../lib/stock-card";

const QTY_SCALE = 4; // StockCard.qtyBalance Decimal(12,4)
const PRICE_SCALE = 4; // StockCard.priceBalance / priceOut Decimal(10,4)
const AVGCOST_SCALE = 2; // Product.avgCost Decimal(10,2)

const NEUTRAL_IN_SOURCES = ["RETURN_IN", "CLAIM_RETURN_IN", "CLAIM_RECV_IN"];

const ROLLBACK = "__verify_rollback__";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : undefined;
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = new PrismaClient({ adapter });

// Same prediction the engine uses: Postgres rounds numeric half away from zero.
const roundScale = (value: number, scale: number): Prisma.Decimal =>
  new Prisma.Decimal(value).toDecimalPlaces(scale, Prisma.Decimal.ROUND_HALF_UP);

interface RefRow {
  id: string;
  priceOut: Prisma.Decimal;
  qtyBalance: Prisma.Decimal;
  priceBalance: Prisma.Decimal;
}

/** Pure JS full replay — the reference "old full-rewrite" output. */
function computeReference(
  rows: {
    id: string;
    source: string;
    qtyIn: Prisma.Decimal;
    qtyOut: Prisma.Decimal;
    priceIn: Prisma.Decimal;
    landedCost: Prisma.Decimal;
    usesReferenceCost: boolean;
  }[],
): { rows: RefRow[]; finalQty: number; finalPrice: number } {
  let baQty = 0;
  let baPrice = 0;
  let baTotal = 0;
  const out: RefRow[] = [];

  for (const row of rows) {
    const qIn = Number(row.qtyIn);
    const qOut = Number(row.qtyOut);
    const usesRef = row.usesReferenceCost === true;
    const pIn =
      qIn > 0 && NEUTRAL_IN_SOURCES.includes(row.source) && !usesRef
        ? baPrice
        : Number(row.priceIn);
    const lc = Number(row.landedCost);

    const newBaQty = baQty + qIn - qOut;
    let newBaPrice = 0;
    let newBaTotal = 0;
    let priceOut = baPrice;

    if (qIn > 0) {
      if (newBaQty > 0) {
        if (baQty > 0) {
          newBaTotal = baTotal + qIn * pIn - qOut * baPrice + lc;
          newBaPrice = newBaTotal / newBaQty;
        } else {
          newBaPrice = pIn + lc / qIn;
          newBaTotal = newBaPrice * newBaQty;
        }
      }
    } else if (usesRef && Number(row.priceIn) > 0) {
      const refCost = Number(row.priceIn);
      priceOut = refCost;
      if (newBaQty >= 0) {
        newBaTotal = baTotal - qOut * refCost;
        if (newBaTotal < 0) newBaTotal = 0;
        newBaPrice = newBaQty > 0 ? newBaTotal / newBaQty : 0;
      }
    } else {
      priceOut = baPrice;
      if (newBaQty >= 0) {
        newBaPrice = baPrice;
        newBaTotal = baTotal - qOut * baPrice;
        if (newBaTotal < 0) newBaTotal = 0;
      }
    }

    out.push({
      id: row.id,
      priceOut: roundScale(priceOut, PRICE_SCALE),
      qtyBalance: roundScale(newBaQty, QTY_SCALE),
      priceBalance: roundScale(newBaPrice > 0 ? newBaPrice : 0, PRICE_SCALE),
    });

    baQty = newBaQty;
    baPrice = newBaPrice;
    baTotal = newBaTotal;
  }

  return { rows: out, finalQty: Math.round(baQty), finalPrice: baPrice > 0 ? baPrice : 0 };
}

async function main() {
  const limit = arg("limit") ? Number(arg("limit")) : undefined;
  const onlyProduct = arg("product");

  const products = onlyProduct
    ? [{ id: onlyProduct }]
    : await db.stockCard.findMany({
        distinct: ["productId"],
        select: { productId: true },
        ...(limit ? { take: limit } : {}),
      }).then((r) => r.map((x) => ({ id: x.productId })));

  console.log(`🔎 Verifying diff-write recalc against full-rewrite reference for ${products.length} product(s)\n`);

  let checked = 0;
  let mismatches = 0;
  let totalRows = 0;
  let totalChangedFromOriginal = 0;

  for (const { id: productId } of products) {
    try {
      await db.$transaction(async (tx) => {
        // 1. original snapshot (what is stored right now)
        const before = await tx.stockCard.findMany({
          where: { productId },
          orderBy: [{ docDate: "asc" }, { sorder: "asc" }],
          select: { id: true, qtyBalance: true, priceBalance: true, priceOut: true },
        });
        const beforeMap = new Map(before.map((r) => [r.id, r]));

        // raw inputs for the independent reference replay
        const inputs = await tx.stockCard.findMany({
          where: { productId },
          orderBy: [{ docDate: "asc" }, { sorder: "asc" }],
          select: {
            id: true,
            source: true,
            qtyIn: true,
            qtyOut: true,
            priceIn: true,
            landedCost: true,
            usesReferenceCost: true,
          },
        });
        const reference = computeReference(inputs);

        // 2. run the real diff-write recalc
        await recalculateStockCard(tx, productId);

        // 3. read result
        const after = await tx.stockCard.findMany({
          where: { productId },
          orderBy: [{ docDate: "asc" }, { sorder: "asc" }],
          select: { id: true, qtyBalance: true, priceBalance: true, priceOut: true },
        });
        const afterMap = new Map(after.map((r) => [r.id, r]));
        const product = await tx.product.findUnique({
          where: { id: productId },
          select: { stock: true, avgCost: true },
        });

        totalRows += after.length;

        // 4. assert result == reference (the iron rule), and tally diff-write touches
        const problems: string[] = [];
        for (const ref of reference.rows) {
          const a = afterMap.get(ref.id);
          if (!a) {
            problems.push(`row ${ref.id} missing after recalc`);
            continue;
          }
          if (
            !a.qtyBalance.equals(ref.qtyBalance) ||
            !a.priceBalance.equals(ref.priceBalance) ||
            !a.priceOut.equals(ref.priceOut)
          ) {
            problems.push(
              `row ${ref.id}: got qty=${a.qtyBalance} price=${a.priceBalance} out=${a.priceOut} | expected qty=${ref.qtyBalance} price=${ref.priceBalance} out=${ref.priceOut}`,
            );
          }
          const orig = beforeMap.get(ref.id);
          if (
            orig &&
            (!orig.qtyBalance.equals(ref.qtyBalance) ||
              !orig.priceBalance.equals(ref.priceBalance) ||
              !orig.priceOut.equals(ref.priceOut))
          ) {
            totalChangedFromOriginal += 1;
          }
        }

        if (product) {
          if (product.stock !== reference.finalQty) {
            problems.push(`Product.stock got ${product.stock} expected ${reference.finalQty}`);
          }
          if (!product.avgCost.equals(roundScale(reference.finalPrice, AVGCOST_SCALE))) {
            problems.push(
              `Product.avgCost got ${product.avgCost} expected ${roundScale(reference.finalPrice, AVGCOST_SCALE)}`,
            );
          }
        }

        if (problems.length > 0) {
          mismatches += 1;
          console.log(`❌ ${productId} (${after.length} rows)`);
          problems.slice(0, 5).forEach((p) => console.log(`   - ${p}`));
          if (problems.length > 5) console.log(`   …and ${problems.length - 5} more`);
        }

        checked += 1;
        // 7. always roll back — this script must not persist anything
        throw new Error(ROLLBACK);
      }, { timeout: 115_000, maxWait: 20_000 });
    } catch (err) {
      if (!(err instanceof Error) || err.message !== ROLLBACK) {
        console.error(`⚠️  error verifying ${productId}:`, err);
      }
    }
  }

  console.log("\n──────────────────────────────────────");
  console.log(`Products checked      : ${checked}`);
  console.log(`StockCard rows replayed: ${totalRows}`);
  console.log(`Rows diff-write touched: ${totalChangedFromOriginal} (${totalRows > 0 ? ((totalChangedFromOriginal / totalRows) * 100).toFixed(2) : "0"}% — the rest were skipped as already-correct)`);
  console.log(mismatches === 0
    ? "✅ IDENTICAL — diff-write recalc matches full-rewrite reference on every row + Product."
    : `❌ ${mismatches} product(s) MISMATCHED — investigate before deploying.`);

  process.exitCode = mismatches === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
