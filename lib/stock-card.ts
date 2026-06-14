/**
 * Stock Card MAVG Engine
 *
 * Logic based on standard moving average cost stored procedure.
 * All quantities and prices are in BASE UNIT (scale=1) of the product.
 *
 * Formula (same as SQL procedure up_stockcard_mavg_loop):
 *   newBaQty   = prevBaQty + qtyIn - qtyOut
 *   newBaTotal = prevBaTotal + (qtyIn × priceIn) - (qtyOut × prevBaPrice) + landedCost
 *   newBaPrice = newBaTotal / newBaQty   (when newBaQty > 0)
 *
 * On pure outgoing (qtyIn = 0):
 *   newBaPrice = prevBaPrice  (avgCost unchanged)
 *   newBaTotal = prevBaTotal - (qtyOut × prevBaPrice)
 */

import { Prisma, StockCardSource } from "@/lib/generated/prisma";
import { db } from "@/lib/db";

// Type for Prisma transaction client
type TxClient = Parameters<Parameters<typeof db.$transaction>[0]>[0];

export async function lockProductForStockMutation(
  tx: Pick<TxClient, "$queryRaw">,
  productId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${productId} FOR UPDATE`;
}

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlNumericLiteral(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return String(value);
}

// Column scales for StockCard balance fields (see prisma/schema.prisma):
//   qtyBalance   Decimal(12,4)
//   priceBalance Decimal(10,4)
//   priceOut     Decimal(10,4)
const STOCK_QTY_SCALE = 4;
const STOCK_PRICE_SCALE = 4;

// Predict the value Postgres will persist into a numeric(_, scale) column.
// Postgres rounds numeric half away from zero, which matches decimal.js
// ROUND_HALF_UP. Used by recalculateStockCard() to detect rows whose stored
// balance already equals the freshly computed value, so a redundant UPDATE can
// be skipped WITHOUT changing the stored result (diff-write).
function roundToColumnScale(value: number, scale: number): Prisma.Decimal {
  return new Prisma.Decimal(value).toDecimalPlaces(scale, Prisma.Decimal.ROUND_HALF_UP);
}

export interface StockCardInput {
  productId: string;
  docNo: string;
  docDate: Date;
  source: StockCardSource;
  qtyIn: number;       // quantity in, base unit
  qtyOut: number;      // quantity out, base unit
  priceIn: number;     // cost per base unit (for purchase/BF, or explicit reference cost when usesReferenceCost=true)
  landedCost?: number; // additional landed cost to distribute into avgCost
  detail?: string;
  referenceId?: string;
  /**
   * When true, `priceIn` carries the explicit per-base cost looked up from a
   * referenced source document (e.g. PurchaseItem.costPrice for a purchase
   * return, SaleItem.costPrice for a customer return). The engine then:
   *   - For IN with a NEUTRAL source: skip the avgCost override and use the
   *     explicit cost — so MAVG reflects the cost basis of the returned items.
   *   - For OUT: reduce inventory by qtyOut × priceIn (instead of × baPrice),
   *     so MAVG mirrors removing items at their original cost.
   * Default false → existing behaviour is preserved for callers that don't set it.
   */
  usesReferenceCost?: boolean;
}

/**
 * Re-calculate all StockCard rows for a product from scratch using MAVG formula.
 * Call this after deleting StockCard rows (i.e., document cancellation).
 * Must be called inside a dbTx().
 */
export async function recalculateStockCard(
  tx: TxClient,
  productId: string
): Promise<void> {
  await lockProductForStockMutation(tx, productId);

  const rows = await tx.stockCard.findMany({
    where: { productId },
    orderBy: [{ docDate: "asc" }, { sorder: "asc" }],
  });

  let baQty   = 0;
  let baPrice = 0;
  let baTotal = 0;
  const pendingUpdates: {
    id: string;
    priceOut: number;
    qtyBalance: number;
    priceBalance: number;
  }[] = [];

  // Sources where stock comes IN but carries no independent cost — the entry
  // is meant to be MAVG-neutral (priceIn was set to avgCost at write time).
  // After any recalculation the stored snapshot may no longer match the running
  // avgCost, so we override pIn with baPrice so the average stays stable.
  //   RETURN_IN      — customer return (CN): stock back at current avgCost
  //   CLAIM_RETURN_IN — defective item returned by customer
  //   CLAIM_RECV_IN  — item received back from supplier after warranty claim
  const NEUTRAL_IN_SOURCES: string[] = [
    "RETURN_IN",
    "CLAIM_RETURN_IN",
    "CLAIM_RECV_IN",
  ];

  for (const row of rows) {
    const qIn  = Number(row.qtyIn);
    const qOut = Number(row.qtyOut);
    const usesRef = row.usesReferenceCost === true;
    // For neutral stock-in entries use the running avgCost, not the stored
    // snapshot — UNLESS this row carries an explicit reference cost.
    const pIn  = (qIn > 0 && NEUTRAL_IN_SOURCES.includes(row.source) && !usesRef)
      ? baPrice
      : Number(row.priceIn);
    const lc   = Number(row.landedCost);

    const newBaQty = baQty + qIn - qOut;
    let newBaPrice = 0;
    let newBaTotal = 0;
    let priceOut   = baPrice;

    if (qIn > 0) {
      if (newBaQty > 0) {
        if (baQty > 0) {
          newBaTotal = baTotal + (qIn * pIn) - (qOut * baPrice) + lc;
          newBaPrice = newBaTotal / newBaQty;
        } else {
          newBaPrice = pIn + (lc / qIn);
          newBaTotal = newBaPrice * newBaQty;
        }
      }
    } else {
      // Reference-cost OUT: reduce inventory at the linked document's cost
      // (e.g. purchase return at PurchaseItem.costPrice) so MAVG mirrors
      // removing those specific units. Stored priceIn holds that explicit cost.
      if (usesRef && Number(row.priceIn) > 0) {
        const refCost = Number(row.priceIn);
        priceOut = refCost;
        if (newBaQty >= 0) {
          newBaTotal = baTotal - (qOut * refCost);
          if (newBaTotal < 0) newBaTotal = 0;
          newBaPrice = newBaQty > 0 ? newBaTotal / newBaQty : 0;
        }
      } else {
        priceOut = baPrice;
        if (newBaQty >= 0) {
          newBaPrice = baPrice;
          newBaTotal = baTotal - (qOut * baPrice);
          if (newBaTotal < 0) newBaTotal = 0;
        }
      }
    }

    const nextQtyBalance   = newBaQty;
    const nextPriceBalance = newBaPrice > 0 ? newBaPrice : 0;

    // Diff-write: only rewrite rows whose stored balance actually changes.
    // The replay math above is untouched, so for a skipped row the value already
    // persisted equals what a full rewrite would store — the final state is
    // identical to a full recalculation, but we avoid UPDATE-ing every row.
    const rowChanged =
      !roundToColumnScale(nextQtyBalance, STOCK_QTY_SCALE).equals(row.qtyBalance) ||
      !roundToColumnScale(nextPriceBalance, STOCK_PRICE_SCALE).equals(row.priceBalance) ||
      !roundToColumnScale(priceOut, STOCK_PRICE_SCALE).equals(row.priceOut);
    if (rowChanged) {
      pendingUpdates.push({
        id: row.id,
        priceOut,
        qtyBalance: nextQtyBalance,
        priceBalance: nextPriceBalance,
      });
    }

    baQty   = newBaQty;
    baPrice = newBaPrice;
    baTotal = newBaTotal;
  }

  const updateChunkSize = 500;
  for (let i = 0; i < pendingUpdates.length; i += updateChunkSize) {
    const chunk = pendingUpdates.slice(i, i + updateChunkSize);
    if (chunk.length === 0) continue;

    const values = chunk
      .map((update) => `(
        ${sqlStringLiteral(update.id)},
        ${sqlNumericLiteral(update.priceOut)}::numeric,
        ${sqlNumericLiteral(update.qtyBalance)}::numeric,
        ${sqlNumericLiteral(update.priceBalance)}::numeric
      )`)
      .join(",");

    await tx.$executeRawUnsafe(`
      UPDATE "StockCard" AS sc
      SET
        "priceOut" = data."priceOut",
        "qtyBalance" = data."qtyBalance",
        "priceBalance" = data."priceBalance"
      FROM (
        VALUES ${values}
      ) AS data("id", "priceOut", "qtyBalance", "priceBalance")
      WHERE sc."id" = data."id"
    `);
  }

  // Update Product with final balance
  await tx.product.update({
    where: { id: productId },
    data: {
      stock:   Math.round(baQty),
      avgCost: new Prisma.Decimal(baPrice > 0 ? baPrice : 0),
    },
  });
}

/**
 * Write one StockCard row and update Product.stock + Product.avgCost.
 * Must be called inside a dbTx().
 *
 * Supports backdating: after inserting the row, re-calculates ALL rows
 * for this product in (docDate, sorder) order to ensure MAVG is always correct
 * regardless of insertion order.
 */
export async function writeStockCard(
  tx: TxClient,
  input: StockCardInput
): Promise<string> {
  await lockProductForStockMutation(tx, input.productId);

  const qIn = input.qtyIn;
  const qOut = input.qtyOut;
  const pIn = input.priceIn;
  const lc  = input.landedCost ?? 0;
  const usesRef = input.usesReferenceCost === true;

  // Get max sorder and latest docDate (may be different rows)
  const [maxSorderRow, latestDateRow] = await Promise.all([
    tx.stockCard.findFirst({
      where: { productId: input.productId },
      orderBy: { sorder: "desc" },
      select: { sorder: true },
    }),
    tx.stockCard.findFirst({
      where: { productId: input.productId },
      orderBy: { docDate: "desc" },
      select: { docDate: true },
    }),
  ]);
  const maxSorder = maxSorderRow ? maxSorderRow.sorder + 1 : 1;

  // Detect backdating: new docDate is before the latest existing row
  const isBackdated = latestDateRow != null && input.docDate < latestDateRow.docDate;

  // Insert row with raw data
  const createdRow = await tx.stockCard.create({
    data: {
      productId:    input.productId,
      docNo:        input.docNo,
      docDate:      input.docDate,
      source:       input.source,
      sorder:       maxSorder,
      qtyIn:        new Prisma.Decimal(qIn),
      qtyOut:       new Prisma.Decimal(qOut),
      qtyBalance:   new Prisma.Decimal(0),
      landedCost:   new Prisma.Decimal(lc),
      priceIn:      new Prisma.Decimal(pIn),
      priceOut:     new Prisma.Decimal(0),
      priceBalance: new Prisma.Decimal(0),
      detail:       input.detail,
      referenceId:  input.referenceId,
      usesReferenceCost: usesRef,
    },
    select: { id: true },
  });

  if (isBackdated) {
    // Backdating detected: must recalculate ALL rows in chronological order
    await recalculateStockCard(tx, input.productId);
  } else {
    // Append mode: compute MAVG inline from current Product state (fast path)
    const product = await tx.product.findUnique({
      where: { id: input.productId },
      select: { stock: true, avgCost: true },
    });
    const baQty   = product ? product.stock : 0;
    const baPrice = product ? Number(product.avgCost) : 0;
    const baTotal = baQty * baPrice;

    // Use baPrice for neutral stock-in sources, unless an explicit reference cost is provided
    const NEUTRAL_IN_SOURCES = ["RETURN_IN", "CLAIM_RETURN_IN", "CLAIM_RECV_IN"];
    const effectivePIn = (qIn > 0 && NEUTRAL_IN_SOURCES.includes(input.source) && !usesRef)
      ? baPrice
      : pIn;

    const newBaQty = baQty + qIn - qOut;
    let newBaPrice = 0;
    let newBaTotal = 0;
    let priceOut   = baPrice;

    if (qIn > 0) {
      if (newBaQty > 0) {
        if (baQty > 0) {
          newBaTotal = baTotal + (qIn * effectivePIn) - (qOut * baPrice) + lc;
          newBaPrice = newBaTotal / newBaQty;
        } else {
          newBaPrice = effectivePIn + (lc / qIn);
          newBaTotal = newBaPrice * newBaQty;
        }
      }
    } else if (usesRef && pIn > 0) {
      // Reference-cost OUT: reduce inventory at linked document's cost
      priceOut = pIn;
      if (newBaQty >= 0) {
        newBaTotal = baTotal - (qOut * pIn);
        if (newBaTotal < 0) newBaTotal = 0;
        newBaPrice = newBaQty > 0 ? newBaTotal / newBaQty : 0;
      }
    } else {
      priceOut = baPrice;
      if (newBaQty >= 0) {
        newBaPrice = baPrice;
        newBaTotal = baTotal - (qOut * baPrice);
        if (newBaTotal < 0) newBaTotal = 0;
      }
    }

    // Update the just-inserted row with computed balances
    await tx.stockCard.update({
      where: { id: createdRow.id },
      data: {
        priceOut:     new Prisma.Decimal(priceOut),
        qtyBalance:   new Prisma.Decimal(newBaQty),
        priceBalance: new Prisma.Decimal(newBaPrice > 0 ? newBaPrice : 0),
      },
    });

    // Update Product with final balance
    await tx.product.update({
      where: { id: input.productId },
      data: {
        stock:   Math.round(newBaQty),
        avgCost: new Prisma.Decimal(newBaPrice > 0 ? newBaPrice : 0),
      },
    });
  }

  return createdRow.id;
}
