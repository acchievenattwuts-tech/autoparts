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
 * Write one StockCard row and update Product.stock + Product.avgCost.
 * Must be called inside a db.$transaction().
 */
export async function writeStockCard(
  tx: TxClient,
  input: StockCardInput
): Promise<void> {
  // 1. Get previous StockCard row for this product (latest by sorder)
  const prevRow = await tx.stockCard.findFirst({
    where: { productId: input.productId },
    orderBy: [{ docDate: "desc" }, { sorder: "desc" }],
  });

  const prevBaQty   = prevRow ? Number(prevRow.qtyBalance) : 0;
  const prevBaPrice = prevRow ? Number(prevRow.priceBalance) : 0;
  const prevBaTotal = prevBaQty * prevBaPrice;

  const qIn       = input.qtyIn;
  const qOut      = input.qtyOut;
  const pIn       = input.priceIn;
  const lc        = input.landedCost ?? 0;
  const inTotal   = qIn * pIn;

  const newBaQty = prevBaQty + qIn - qOut;

  let newBaPrice = 0;
  let newBaTotal = 0;
  let priceOut   = prevBaPrice; // avgCost used for COGS on outgoing

  if (qIn > 0) {
    // Incoming (purchase, BF, return from customer, adjustment in)
    if (newBaQty > 0) {
      if (prevBaQty > 0) {
        newBaTotal = prevBaTotal + inTotal - (qOut * prevBaPrice) + lc;
        newBaPrice = newBaTotal / newBaQty;
      } else {
        // Was zero — start fresh
        newBaPrice = qIn > 0 ? pIn + (qIn > 0 ? lc / qIn : 0) : 0;
        newBaTotal = newBaPrice * newBaQty;
      }
    }
    // else newBaQty <= 0 → price stays 0
  } else {
    // Pure outgoing (sale, adjustment out, return to supplier)
    priceOut = prevBaPrice;
    if (newBaQty >= 0) {
      newBaPrice = prevBaPrice; // avgCost unchanged
      newBaTotal = prevBaTotal - (qOut * prevBaPrice);
      if (newBaTotal < 0) newBaTotal = 0;
    }
  }

  // 2. Get next sorder for this product
  const lastRow = await tx.stockCard.findFirst({
    where: { productId: input.productId },
    orderBy: { sorder: "desc" },
  });
  const sorder = lastRow ? lastRow.sorder + 1 : 1;

  // 3. Insert StockCard row
  await tx.stockCard.create({
    data: {
      productId:    input.productId,
      docNo:        input.docNo,
      docDate:      input.docDate,
      source:       input.source,
      sorder,
      qtyIn:        new Prisma.Decimal(qIn),
      qtyOut:       new Prisma.Decimal(qOut),
      qtyBalance:   new Prisma.Decimal(newBaQty),
      landedCost:   new Prisma.Decimal(lc),
      priceIn:      new Prisma.Decimal(pIn),
      priceOut:     new Prisma.Decimal(priceOut),
      priceBalance: new Prisma.Decimal(newBaPrice),
      detail:       input.detail,
      referenceId:  input.referenceId,
    },
  });

  // 4. Update Product.stock and Product.avgCost
  await tx.product.update({
    where: { id: input.productId },
    data: {
      stock:   Math.round(newBaQty),
      avgCost: new Prisma.Decimal(newBaPrice > 0 ? newBaPrice : 0),
    },
  });
}
