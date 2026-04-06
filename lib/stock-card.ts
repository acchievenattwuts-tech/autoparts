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

export interface StockCardInput {
  productId: string;
  docNo: string;
  docDate: Date;
  source: StockCardSource;
  qtyIn: number;       // quantity in, base unit
  qtyOut: number;      // quantity out, base unit
  priceIn: number;     // cost per base unit (for purchase/BF)
  landedCost?: number; // additional landed cost to distribute into avgCost
  detail?: string;
  referenceId?: string;
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
  const rows = await tx.stockCard.findMany({
    where: { productId },
    orderBy: [{ docDate: "asc" }, { sorder: "asc" }],
  });

  let baQty   = 0;
  let baPrice = 0;
  let baTotal = 0;

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
    // For neutral stock-in entries use the running avgCost, not the stored snapshot
    const pIn  = (qIn > 0 && NEUTRAL_IN_SOURCES.includes(row.source))
      ? baPrice
      : Number(row.priceIn);
    const lc   = Number(row.landedCost);

    let newBaQty   = baQty + qIn - qOut;
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
      priceOut = baPrice;
      if (newBaQty >= 0) {
        newBaPrice = baPrice;
        newBaTotal = baTotal - (qOut * baPrice);
        if (newBaTotal < 0) newBaTotal = 0;
      }
    }

    await tx.stockCard.update({
      where: { id: row.id },
      data: {
        priceOut:     new Prisma.Decimal(priceOut),
        qtyBalance:   new Prisma.Decimal(newBaQty),
        priceBalance: new Prisma.Decimal(newBaPrice > 0 ? newBaPrice : 0),
      },
    });

    baQty   = newBaQty;
    baPrice = newBaPrice;
    baTotal = newBaTotal;
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
): Promise<void> {
  const qIn = input.qtyIn;
  const qOut = input.qtyOut;
  const pIn = input.priceIn;
  const lc  = input.landedCost ?? 0;

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
  await tx.stockCard.create({
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
    },
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

    // Use baPrice for neutral stock-in sources
    const NEUTRAL_IN_SOURCES = ["RETURN_IN", "CLAIM_RETURN_IN", "CLAIM_RECV_IN"];
    const effectivePIn = (qIn > 0 && NEUTRAL_IN_SOURCES.includes(input.source))
      ? baPrice
      : pIn;

    let newBaQty   = baQty + qIn - qOut;
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
    } else {
      priceOut = baPrice;
      if (newBaQty >= 0) {
        newBaPrice = baPrice;
        newBaTotal = baTotal - (qOut * baPrice);
        if (newBaTotal < 0) newBaTotal = 0;
      }
    }

    // Update the just-inserted row with computed balances
    const inserted = await tx.stockCard.findFirst({
      where: { productId: input.productId, sorder: maxSorder },
      select: { id: true },
    });
    if (inserted) {
      await tx.stockCard.update({
        where: { id: inserted.id },
        data: {
          priceOut:     new Prisma.Decimal(priceOut),
          qtyBalance:   new Prisma.Decimal(newBaQty),
          priceBalance: new Prisma.Decimal(newBaPrice > 0 ? newBaPrice : 0),
        },
      });
    }

    // Update Product with final balance
    await tx.product.update({
      where: { id: input.productId },
      data: {
        stock:   Math.round(newBaQty),
        avgCost: new Prisma.Decimal(newBaPrice > 0 ? newBaPrice : 0),
      },
    });
  }
}
