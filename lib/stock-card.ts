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

function safeSqlNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value;
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

/**
 * ลำดับธุรกิจของเอกสารที่ลงวันที่เดียวกัน (ยืนยันโดยเจ้าของระบบ 2026-07-24):
 *
 *   0 = ยอดยกมา (BF)  →  1 = ของเข้าทุกชนิด  →  2 = ของออกทุกชนิด
 *
 * เดิมลำดับ (sorder) ถูกแจกตามเวลาที่คีย์เท่านั้น ทำให้ใบขายที่บันทึกก่อน
 * ใบซื้อของวันเดียวกันถูกคำนวณก่อน → ยอดคงเหลือติดลบและต้นทุนขายกลายเป็น 0
 * (เคสจริง: SAC26050001 / RR26050036 วันที่ 27/05/2026)
 *
 * Record<StockCardSource, number> ตั้งใจไม่ให้มี default — ถ้ามีการเพิ่ม
 * source ใหม่ใน enum แล้วลืมกำหนดกลุ่ม TypeScript จะ error ทันที
 */
const STOCK_SOURCE_SEQUENCE_GROUP: Record<StockCardSource, number> = {
  BF: 0,
  PURCHASE: 1,
  RETURN_IN: 1,
  ADJUST_IN: 1,
  CLAIM_RETURN_IN: 1,
  CLAIM_RECV_IN: 1,
  SALE: 2,
  RETURN_OUT: 2,
  ADJUST_OUT: 2,
  CLAIM_SEND_OUT: 2,
  CLAIM_REPLACE_OUT: 2,
};

const OUTGOING_SEQUENCE_GROUP = 2;

/** กลุ่มลำดับของ source (ค่าที่อ่านจาก DB เป็น string จึงต้อง narrow ก่อน) */
function getStockSourceGroup(source: string): number {
  return STOCK_SOURCE_SEQUENCE_GROUP[source as StockCardSource] ?? OUTGOING_SEQUENCE_GROUP;
}

/** source ทั้งหมดที่ต้องอยู่ "หลัง" กลุ่มของ source ที่ส่งมา (วันเดียวกัน) */
export function getLaterGroupSources(source: StockCardSource): StockCardSource[] {
  const group = getStockSourceGroup(source);
  return (Object.keys(STOCK_SOURCE_SEQUENCE_GROUP) as StockCardSource[]).filter(
    (candidate) => STOCK_SOURCE_SEQUENCE_GROUP[candidate] > group,
  );
}

export type StockSequenceRow = {
  id: string;
  docDate: Date;
  sorder: number;
  source: string;
};

export type SorderUpdate = { id: string; sorder: number };

/**
 * เรียงแถวตามลำดับธุรกิจ: docDate → กลุ่ม source → sorder เดิม
 * (sorder เดิมเป็น tiebreak จึงคงลำดับการคีย์ภายในกลุ่มเดียวกันไว้ครบ)
 */
export function sortRowsForReplay<T extends StockSequenceRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const dateDiff = a.docDate.getTime() - b.docDate.getTime();
    if (dateDiff !== 0) return dateDiff;
    const groupDiff = getStockSourceGroup(a.source) - getStockSourceGroup(b.source);
    if (groupDiff !== 0) return groupDiff;
    return a.sorder - b.sorder;
  });
}

/**
 * แปลงลำดับที่เรียงแล้วให้เป็นเลข sorder 1..n และคืนเฉพาะแถวที่ค่าต้องเปลี่ยน
 * (diff-write) — ทำให้ sorder ที่เก็บใน DB สะท้อนลำดับธุรกิจจริง ทุก query
 * ที่เรียงด้วย [docDate, sorder] อยู่แล้วจึงถูกต้องโดยไม่ต้องแก้
 */
export function buildSorderUpdates(orderedRows: StockSequenceRow[]): SorderUpdate[] {
  const updates: SorderUpdate[] = [];
  orderedRows.forEach((row, index) => {
    const nextSorder = index + 1;
    if (row.sorder !== nextSorder) updates.push({ id: row.id, sorder: nextSorder });
  });
  return updates;
}

export type StockReplayRow = StockSequenceRow & {
  source: string;
  qtyIn: Prisma.Decimal;
  qtyOut: Prisma.Decimal;
  priceIn: Prisma.Decimal;
  landedCost: Prisma.Decimal;
  usesReferenceCost: boolean;
  qtyBalance: Prisma.Decimal;
  priceBalance: Prisma.Decimal;
  priceOut: Prisma.Decimal;
};

type StockBalanceUpdate = {
  id: string;
  priceOut: number;
  qtyBalance: number;
  priceBalance: number;
};

/**
 * Pure MAVG replay for one product's StockCard rows (already ordered by
 * docDate, sorder). Returns the diff-write update set (only rows whose stored
 * balance actually changes) plus the product's final stock/avgCost. Shared by
 * both the single- and multi-product recalculators so the math stays identical.
 */
export function replayStockCardMavg(rows: StockReplayRow[]): {
  updates: StockBalanceUpdate[];
  finalQty: number;
  finalPrice: number;
} {
  let baQty = 0;
  let baPrice = 0;
  let baTotal = 0;
  const updates: StockBalanceUpdate[] = [];

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
      updates.push({ id: row.id, priceOut, qtyBalance: nextQtyBalance, priceBalance: nextPriceBalance });
    }

    baQty   = newBaQty;
    baPrice = newBaPrice;
    baTotal = newBaTotal;
  }

  return { updates, finalQty: Math.round(baQty), finalPrice: baPrice > 0 ? baPrice : 0 };
}

/** Flush diff-write balance updates in chunked `UPDATE ... FROM (VALUES ...)`. */
async function flushStockBalanceUpdates(
  tx: Pick<TxClient, "$executeRaw">,
  updates: StockBalanceUpdate[],
): Promise<void> {
  const updateChunkSize = 500;
  for (let i = 0; i < updates.length; i += updateChunkSize) {
    const chunk = updates.slice(i, i + updateChunkSize);
    if (chunk.length === 0) continue;

    const values = Prisma.join(
      chunk.map((update) => Prisma.sql`(
        ${update.id},
        ${safeSqlNumber(update.priceOut)}::numeric,
        ${safeSqlNumber(update.qtyBalance)}::numeric,
        ${safeSqlNumber(update.priceBalance)}::numeric
      )`),
    );

    await tx.$executeRaw`
      UPDATE "StockCard" AS sc
      SET
        "priceOut" = data."priceOut",
        "qtyBalance" = data."qtyBalance",
        "priceBalance" = data."priceBalance"
      FROM (
        VALUES ${values}
      ) AS data("id", "priceOut", "qtyBalance", "priceBalance")
      WHERE sc."id" = data."id"
    `;
  }
}

/**
 * Flush diff-write sorder updates (จัดลำดับใหม่ตามลำดับธุรกิจ) แบบ chunked.
 * ไม่มี unique constraint บน (productId, sorder) จึงอัปเดตทีเดียวได้โดยไม่ชนกัน
 */
async function flushSorderUpdates(
  tx: Pick<TxClient, "$executeRaw">,
  updates: SorderUpdate[],
): Promise<void> {
  const updateChunkSize = 500;
  for (let i = 0; i < updates.length; i += updateChunkSize) {
    const chunk = updates.slice(i, i + updateChunkSize);
    if (chunk.length === 0) continue;

    const values = Prisma.join(
      chunk.map((update) => Prisma.sql`(${update.id}, ${update.sorder}::int)`),
    );

    await tx.$executeRaw`
      UPDATE "StockCard" AS sc
      SET "sorder" = data."sorder"
      FROM (
        VALUES ${values}
      ) AS data("id", "sorder")
      WHERE sc."id" = data."id"
    `;
  }
}

/**
 * Re-calculate all StockCard rows for a product from scratch using MAVG formula.
 * Call this after deleting StockCard rows (i.e., document cancellation).
 * Must be called inside a dbTx().
 *
 * แถวจะถูกจัดลำดับใหม่ตามลำดับธุรกิจ (BF → ของเข้า → ของออก) ก่อนรีเพลย์เสมอ
 * จึงซ่อมข้อมูลเก่าที่ลำดับสลับให้เองโดยอัตโนมัติ
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

  const orderedRows = sortRowsForReplay(rows);
  await flushSorderUpdates(tx, buildSorderUpdates(orderedRows));

  const { updates, finalQty, finalPrice } = replayStockCardMavg(orderedRows);
  await flushStockBalanceUpdates(tx, updates);

  // Update Product with final balance
  await tx.product.update({
    where: { id: productId },
    data: {
      stock:   finalQty,
      avgCost: new Prisma.Decimal(finalPrice),
    },
  });
}

/**
 * Batched equivalent of calling recalculateStockCard() once per product, but
 * with a constant number of round-trips instead of ~4 per product: one lock,
 * one read, one (chunked) StockCard balance write, one Product write. Each
 * product is replayed independently with the SAME MAVG engine, so the result is
 * identical to looping recalculateStockCard() over the same ids.
 * Must be called inside a dbTx().
 */
export async function recalculateStockCardMany(
  tx: TxClient,
  productIdsInput: Iterable<string>,
): Promise<void> {
  const productIds = [...new Set([...productIdsInput].filter(Boolean))];
  if (productIds.length === 0) return;

  // Lock every affected Product row in one statement, in a deterministic order
  // to avoid deadlocks with other transactions taking the same locks.
  await tx.$queryRaw`
    SELECT id FROM "Product"
    WHERE id IN (${Prisma.join(productIds)})
    ORDER BY id
    FOR UPDATE
  `;

  const rows = await tx.stockCard.findMany({
    where: { productId: { in: productIds } },
    orderBy: [{ productId: "asc" }, { docDate: "asc" }, { sorder: "asc" }],
  });

  const byProduct = new Map<string, StockReplayRow[]>();
  for (const row of rows) {
    const group = byProduct.get(row.productId);
    if (group) group.push(row);
    else byProduct.set(row.productId, [row]);
  }

  const allUpdates: StockBalanceUpdate[] = [];
  const allSorderUpdates: SorderUpdate[] = [];
  const productFinals: { id: string; stock: number; avgCost: number }[] = [];
  for (const productId of productIds) {
    const orderedRows = sortRowsForReplay(byProduct.get(productId) ?? []);
    allSorderUpdates.push(...buildSorderUpdates(orderedRows));
    const { updates, finalQty, finalPrice } = replayStockCardMavg(orderedRows);
    allUpdates.push(...updates);
    productFinals.push({ id: productId, stock: finalQty, avgCost: finalPrice });
  }

  await flushSorderUpdates(tx, allSorderUpdates);
  await flushStockBalanceUpdates(tx, allUpdates);

  // Update every Product's final balance in chunked bulk statements.
  const productChunkSize = 500;
  for (let i = 0; i < productFinals.length; i += productChunkSize) {
    const chunk = productFinals.slice(i, i + productChunkSize);
    if (chunk.length === 0) continue;
    const values = Prisma.join(
      chunk.map((p) => Prisma.sql`(
        ${p.id},
        ${Math.round(p.stock)}::int,
        ${safeSqlNumber(p.avgCost)}::numeric
      )`),
    );
    await tx.$executeRaw`
      UPDATE "Product" AS p
      SET "stock" = data."stock", "avgCost" = data."avgCost"
      FROM (VALUES ${values}) AS data("id", "stock", "avgCost")
      WHERE p."id" = data."id"
    `;
  }
}

/**
 * Write one StockCard row and update Product.stock + Product.avgCost.
 * Must be called inside a dbTx().
 *
 * Supports backdating: after inserting the row, re-calculates ALL rows
 * for this product in (docDate, กลุ่ม source, sorder) order to ensure MAVG is
 * always correct regardless of insertion order. เอกสารวันเดียวกันจะถูกเรียงเป็น
 * BF → ของเข้า → ของออก เสมอ (ดู STOCK_SOURCE_SEQUENCE_GROUP)
 */
export async function writeStockCard(
  tx: TxClient,
  input: StockCardInput,
  /**
   * Optional out-parameter: when supplied, the productId is appended if this
   * write drives stock across zero (was > 0, now <= 0) via an outgoing qty.
   * Detection is free — it reuses the balances already computed in the append
   * fast path and never runs on the (rare) backdated recalculation path. The
   * caller fires the real-time out-of-stock alert AFTER the transaction commits.
   * Backward compatible: callers that omit it are completely unaffected.
   */
  crossedToZero?: string[]
): Promise<string> {
  await lockProductForStockMutation(tx, input.productId);

  const qIn = input.qtyIn;
  const qOut = input.qtyOut;
  const pIn = input.priceIn;
  const lc  = input.landedCost ?? 0;
  const usesRef = input.usesReferenceCost === true;

  // Get max sorder and check whether any existing row must sort AFTER this one.
  // Sequential awaits on the single transaction connection — Promise.all here
  // triggers the pg-adapter "client.query() while already executing" warning.
  const maxSorderRow = await tx.stockCard.findFirst({
    where: { productId: input.productId },
    orderBy: { sorder: "desc" },
    select: { sorder: true },
  });
  const maxSorder = maxSorderRow ? maxSorderRow.sorder + 1 : 1;

  // แถวที่ต้องอยู่หลังแถวใหม่ = ลงวันที่หลังกว่า (ย้อนหลังแบบเดิม) หรือ
  // วันเดียวกันแต่เป็นกลุ่มที่ต้องมาทีหลัง (เช่น แถวใหม่เป็นใบซื้อ และมีใบขาย
  // ของวันเดียวกันอยู่แล้ว) — ทั้งสองกรณีต้องเรียงใหม่ + คำนวณใหม่ทั้งใบ
  // ใช้ index [productId, docDate, sorder] ครอบทั้งสองเงื่อนไข จึงเป็น
  // index seek ไม่ใช่ full scan แม้ StockCard จะโตขึ้นมาก
  const laterGroupSources = getLaterGroupSources(input.source);
  const rowThatMustSortLater = await tx.stockCard.findFirst({
    where: {
      productId: input.productId,
      OR: [
        { docDate: { gt: input.docDate } },
        ...(laterGroupSources.length > 0
          ? [{ docDate: input.docDate, source: { in: laterGroupSources } }]
          : []),
      ],
    },
    select: { id: true },
  });
  const needsFullRecalc = rowThatMustSortLater != null;

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

  if (needsFullRecalc) {
    // แถวใหม่ไม่ได้อยู่ท้ายสุด (ลงย้อนหลัง หรือวันเดียวกันแต่ต้องมาก่อนแถวเดิม)
    // → จัดลำดับใหม่ทั้งใบแล้วรีเพลย์ MAVG ตั้งแต่ต้น
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

    // Zero-crossing detection for the real-time out-of-stock alert. Uses the
    // balances already in hand (no extra query) and only flags the first
    // crossing so a product that is already at/below zero never re-flags.
    if (crossedToZero && qOut > 0 && baQty > 0 && newBaQty <= 0) {
      crossedToZero.push(input.productId);
    }

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
