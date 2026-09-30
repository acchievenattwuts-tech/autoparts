import { CreditNoteType, DocStatus, MarketplaceReturnStockDisposition, Prisma } from "@/lib/generated/prisma";
import { resolveReturnUnitCost } from "@/lib/credit-note-return";
import { rebuildCreditNoteProfitFacts, rebuildSaleProfitFacts } from "@/lib/profit-fact";
import {
  replayStockCardMavg, sortRowsForReplay, STOCK_REPLAY_SELECT,
  type StockReplayRow, type StockReplayRowResult,
} from "@/lib/stock-card";
import { isValueOnlyStockSource, type ValueOnlyStockSource } from "@/lib/stock-value-only-source";

/**
 * T1 option A (owner approved 2026-09-30): when a supplier DN is cancelled or its lines/VAT are
 * edited, the cost snapshots of later outbound documents are restated to the valuation the DN
 * change produces.
 *
 * The planner replays each affected SKU twice in memory: as stored (baseline) and with the DN's
 * value-only rows removed or replaced (target). A SALE row whose out price changes restates its
 * SaleItem.costPrice (per base unit, 2 decimals, the same rounding as the Product.avgCost snapshot
 * taken at sale time). A RETURN credit note row (RETURN_IN with a reference cost) derives its cost
 * from those sale items, so its StockCard priceIn is restated too; because that changes later
 * averages, the target replay is repeated until nothing moves. Rows before the DN are identical in
 * both replays, so only documents after the DN position can change. Nothing is written by the
 * planner; the caller checks the month lock with restatementDates() before applying.
 *
 * V8 (owner approved 2026-09-30, W5): the same planner restates later sales when a DISCOUNT/OTHER purchase return's
 * value-only PURCHASE_ALLOWANCE rows ("ลดราคาซื้อ") are reposted or reversed: pass `source` and the return number as
 * `debitNo`. The default source stays SUPPLIER_DEBIT.
 */

type Tx = Prisma.TransactionClient;
type RestatementClient = Pick<Tx, "stockCard" | "saleItem" | "creditNoteItem">;

const MONEY_SCALE = 2;
const PRICE_SCALE = 4;
const MAX_REPLAY_PASSES = 25;
const MAX_AUDIT_DOC_NOS = 50;
const RESTATEMENT_ROW_PREFIX = "restatement:";
const UPDATE_CHUNK_SIZE = 500;

const roundTo = (value: number, scale: number): number =>
  new Prisma.Decimal(value).toDecimalPlaces(scale, Prisma.Decimal.ROUND_HALF_UP).toNumber();
const round2 = (value: number): number => roundTo(value, MONEY_SCALE);
const round4 = (value: number): number => roundTo(value, PRICE_SCALE);

/** A value-only row the change posts at the document's original position (edit); none for a cancel. */
export type DebitReplacementRow = { productId: string; docDate: Date; valuationEpoch: number; valueAdjustment: number };

export type PlanStockRow = StockReplayRow & { productId: string; docNo: string; referenceId: string | null };

export type PlanSaleItem = {
  id: string; saleId: string; saleNo: string; saleDate: Date; saleActive: boolean;
  productId: string; quantity: number; costPrice: number;
};
/** Items of a credit note's source sale, for the exact-line and product-weighted reference cost. */
export type PlanSourceSaleItem = { id: string; saleId: string; productId: string; quantity: number; costPrice: number };
export type PlanReturnItem = {
  id: string; creditNoteId: string; saleId: string | null; saleItemId: string | null; productId: string | null; active: boolean;
};

export type RestatedSaleItem = PlanSaleItem & { before: number; after: number };
export type RestatedReturnRow = { stockCardId: string; productId: string; before: number; after: number };
export type ChangedResidualRow = { stockCardId: string; productId: string; docDate: Date; before: number; after: number };

export type ProductRestatementInput = {
  rows: PlanStockRow[];
  /** Document number of the value-only rows that change (a DN, or a purchase return for PURCHASE_ALLOWANCE). */
  debitNo: string;
  /** Source of those rows; SUPPLIER_DEBIT when omitted. */
  source?: ValueOnlyStockSource;
  replacements: DebitReplacementRow[];
  saleItems: ReadonlyMap<string, PlanSaleItem>;
  returnItems: ReadonlyMap<string, PlanReturnItem>;
  sourceSaleItems: readonly PlanSourceSaleItem[];
};

export type ProductRestatementResult = {
  saleItems: RestatedSaleItem[];
  returnRows: RestatedReturnRow[];
  residualRows: ChangedResidualRow[];
  /** SALE rows whose out price changed but that link to no SaleItem (legacy rows); reported, never guessed. */
  unlinkedSaleRows: number;
};

/**
 * New per-base-unit sale cost. A snapshot that matches the stored valuation (the normal case:
 * Product.avgCost at sale time rounded to 2 decimals) takes the new valuation with the same
 * rounding; a snapshot that already differed (e.g. a backdated sale) moves by the valuation change
 * only, so the restatement never rewrites more than the DN's effect.
 */
export function restateSaleUnitCost(current: number, basePriceOut: number, targetPriceOut: number): number {
  return round2(current) === round2(basePriceOut)
    ? round2(targetPriceOut) : round2(Math.max(0, current + targetPriceOut - basePriceOut));
}

/** Same rule for a RETURN_IN reference cost (StockCard priceIn, 4 decimals). */
export function restateReferenceCost(stored: number, before: number, after: number): number {
  return round4(stored) === round4(before) ? round4(after) : round4(Math.max(0, stored + after - before));
}

type ReferenceMaps = { bySaleItemId: Map<string, number>; byProductId: Map<string, number> };

/** Mirrors buildSaleReferenceCostMap (credit-notes/actions.ts): exact line, else product-weighted cost. */
function buildReferenceMaps(items: readonly PlanSourceSaleItem[], costOf: (item: PlanSourceSaleItem) => number): Map<string, ReferenceMaps> {
  const bySale = new Map<string, ReferenceMaps>();
  const totals = new Map<string, { qty: number; cost: number }>();
  for (const item of items) {
    if (!(item.quantity > 0)) continue;
    const maps = bySale.get(item.saleId) ?? { bySaleItemId: new Map<string, number>(), byProductId: new Map<string, number>() };
    maps.bySaleItemId.set(item.id, costOf(item));
    bySale.set(item.saleId, maps);
    const key = `${item.saleId}|${item.productId}`;
    const total = totals.get(key) ?? { qty: 0, cost: 0 };
    total.qty += item.quantity; total.cost += costOf(item) * item.quantity;
    totals.set(key, total);
  }
  for (const [key, total] of totals) {
    const [saleId, productId] = key.split("|");
    if (total.qty > 0) bySale.get(saleId)?.byProductId.set(productId, total.cost / total.qty);
  }
  return bySale;
}

const resolveReference = (item: Pick<PlanReturnItem, "saleId" | "saleItemId" | "productId">,
  maps: Map<string, ReferenceMaps>): number | undefined => {
  const saleMaps = item.saleId ? maps.get(item.saleId) : undefined;
  if (!saleMaps) return undefined;
  return resolveReturnUnitCost({ saleItemId: item.saleItemId, productId: item.productId,
    saleItemCostById: saleMaps.bySaleItemId, productCostById: saleMaps.byProductId });
};

function replayRows(rows: StockReplayRow[]): Map<string, StockReplayRowResult> {
  const results = new Map<string, StockReplayRowResult>();
  replayStockCardMavg(sortRowsForReplay(rows), (result) => { results.set(result.id, result); });
  return results;
}

const DEFAULT_VALUE_SOURCE: ValueOnlyStockSource = "SUPPLIER_DEBIT";

function buildTargetRows(input: ProductRestatementInput): PlanStockRow[] {
  const source = input.source ?? DEFAULT_VALUE_SOURCE;
  const kept = input.rows.filter((row) => !(row.source === source && row.docNo === input.debitNo));
  const zero = new Prisma.Decimal(0);
  const added = input.replacements.map((row, index): PlanStockRow => ({
    id: `${RESTATEMENT_ROW_PREFIX}${row.productId}:${index}`, productId: row.productId, docNo: input.debitNo, referenceId: null,
    docDate: row.docDate, sorder: 0, source, valuationEpoch: row.valuationEpoch,
    qtyIn: zero, qtyOut: zero, priceIn: zero, landedCost: zero, usesReferenceCost: false,
    qtyBalance: zero, priceBalance: zero, priceOut: zero, valueAdjustment: new Prisma.Decimal(row.valueAdjustment), costVariance: zero,
  }));
  return [...kept, ...added];
}

/** One SKU's restatement, pure: no database access. */
export function planProductRestatement(input: ProductRestatementInput): ProductRestatementResult {
  const baseline = replayRows(input.rows);
  const target = buildTargetRows(input);
  const originalCost = (item: PlanSourceSaleItem): number => item.costPrice;
  const originalMaps = buildReferenceMaps(input.sourceSaleItems, originalCost);
  const overrides = new Map<string, number>();
  let restated = new Map<string, number>();
  let unlinkedSaleRows = 0;
  let targetResults = new Map<string, StockReplayRowResult>();
  for (let pass = 0; ; pass += 1) {
    if (pass >= MAX_REPLAY_PASSES) throw new Error("Sale cost restatement did not converge");
    targetResults = replayRows(target.map((row) => overrides.has(row.id)
      ? { ...row, priceIn: new Prisma.Decimal(overrides.get(row.id) ?? 0) } : row));
    restated = new Map<string, number>();
    unlinkedSaleRows = 0;
    for (const row of target) {
      if (row.source !== "SALE") continue;
      const before = baseline.get(row.id);
      const after = targetResults.get(row.id);
      if (!before || !after || round4(before.priceOut) === round4(after.priceOut)) continue;
      const item = row.referenceId ? input.saleItems.get(row.referenceId) : undefined;
      if (!item) { unlinkedSaleRows += 1; continue; }
      if (!item.saleActive || restated.has(item.id)) continue;
      const next = restateSaleUnitCost(item.costPrice, before.priceOut, after.priceOut);
      if (next !== round2(item.costPrice)) restated.set(item.id, next);
    }
    const restatedMaps = buildReferenceMaps(input.sourceSaleItems, (item) => restated.get(item.id) ?? item.costPrice);
    let moved = false;
    for (const row of target) {
      if (row.source !== "RETURN_IN" || !row.usesReferenceCost || !row.referenceId) continue;
      const link = input.returnItems.get(row.referenceId);
      if (!link?.active) continue;
      const before = resolveReference(link, originalMaps);
      const after = resolveReference(link, restatedMaps);
      if (before === undefined || after === undefined) continue;
      const next = restateReferenceCost(Number(row.priceIn), before, after);
      if (next !== round4(overrides.get(row.id) ?? Number(row.priceIn))) { overrides.set(row.id, next); moved = true; }
    }
    if (!moved) break;
  }
  const saleItems = [...restated].flatMap(([id, after]) => {
    const item = input.saleItems.get(id);
    return item ? [{ ...item, before: item.costPrice, after }] : [];
  });
  const returnRows = target.flatMap((row) => {
    const after = overrides.get(row.id);
    return after !== undefined && after !== round4(Number(row.priceIn))
      ? [{ stockCardId: row.id, productId: row.productId, before: Number(row.priceIn), after }] : [];
  });
  const residualRows = target.flatMap((row) => {
    const before = baseline.get(row.id)?.costVariance ?? 0;
    const after = targetResults.get(row.id)?.costVariance ?? 0;
    return !row.id.startsWith(RESTATEMENT_ROW_PREFIX) && !isValueOnlyStockSource(row.source) && round2(before) !== round2(after)
      ? [{ stockCardId: row.id, productId: row.productId, docDate: row.docDate, before, after }] : [];
  });
  return { saleItems, returnRows, residualRows, unlinkedSaleRows };
}

export type RestatedCreditNote = { id: string; cnNo: string; cnDate: Date };

export type SaleCostRestatementPlan = {
  saleItems: RestatedSaleItem[];
  returnRows: RestatedReturnRow[];
  residualRows: ChangedResidualRow[];
  creditNotes: RestatedCreditNote[];
  unlinkedSaleRows: number;
};

export type SaleCostRestatementSummary = {
  saleCount: number;
  saleNos: string[];
  saleNosTruncated: boolean;
  lineCount: number;
  costBefore: number;
  costAfter: number;
  delta: number;
  creditNoteCount: number;
  creditNoteNos: string[];
  returnRowCount: number;
  residualRowCount: number;
  unlinkedSaleRows: number;
};

const EMPTY_PLAN: SaleCostRestatementPlan = { saleItems: [], returnRows: [], residualRows: [], creditNotes: [], unlinkedSaleRows: 0 };

/** Position of each product's value-only rows (earliest date/epoch); rows before it can never change. */
function debitBoundaries(rows: PlanStockRow[], debitNo: string, replacements: DebitReplacementRow[],
  source: ValueOnlyStockSource): Map<string, { time: number; epoch: number }> {
  const boundaries = new Map<string, { time: number; epoch: number }>();
  const consider = (productId: string, docDate: Date, epoch: number): void => {
    const current = boundaries.get(productId);
    const time = docDate.getTime();
    if (!current || time < current.time || (time === current.time && epoch < current.epoch)) boundaries.set(productId, { time, epoch });
  };
  for (const row of rows) if (row.source === source && row.docNo === debitNo) consider(row.productId, row.docDate, row.valuationEpoch ?? 0);
  for (const row of replacements) consider(row.productId, row.docDate, row.valuationEpoch);
  return boundaries;
}

const isAfterBoundary = (row: PlanStockRow, boundary: { time: number; epoch: number } | undefined): boolean =>
  Boolean(boundary) && (row.docDate.getTime() > boundary!.time ||
    (row.docDate.getTime() === boundary!.time && (row.valuationEpoch ?? 0) >= boundary!.epoch));

async function loadPlanLinks(client: RestatementClient, rows: PlanStockRow[]): Promise<{
  saleItems: Map<string, PlanSaleItem>; returnItems: Map<string, PlanReturnItem>; sourceSaleItems: PlanSourceSaleItem[];
}> {
  const saleRefs = [...new Set(rows.filter((row) => row.source === "SALE" && row.referenceId).map((row) => row.referenceId!))];
  const returnRefs = [...new Set(rows.filter((row) => row.source === "RETURN_IN" && row.usesReferenceCost && row.referenceId)
    .map((row) => row.referenceId!))];
  // Sequential: one transaction connection runs one query at a time.
  const sales = saleRefs.length === 0 ? [] : await client.saleItem.findMany({ where: { id: { in: saleRefs } },
    select: { id: true, saleId: true, productId: true, quantity: true, costPrice: true,
      sale: { select: { saleNo: true, saleDate: true, status: true } } } });
  const returns = returnRefs.length === 0 ? [] : await client.creditNoteItem.findMany({ where: { id: { in: returnRefs } },
    select: { id: true, saleItemId: true, productId: true, creditNote: { select: { id: true, saleId: true, status: true, type: true } } } });
  const sourceSaleIds = [...new Set(returns.flatMap((item) => (item.creditNote.saleId ? [item.creditNote.saleId] : [])))];
  const productIds = [...new Set(rows.map((row) => row.productId))];
  const sourceItems = sourceSaleIds.length === 0 ? [] : await client.saleItem.findMany({
    where: { saleId: { in: sourceSaleIds }, productId: { in: productIds } },
    select: { id: true, saleId: true, productId: true, quantity: true, costPrice: true } });
  return {
    saleItems: new Map(sales.map((item) => [item.id, { id: item.id, saleId: item.saleId, saleNo: item.sale.saleNo,
      saleDate: item.sale.saleDate, saleActive: item.sale.status === DocStatus.ACTIVE, productId: item.productId,
      quantity: Number(item.quantity), costPrice: Number(item.costPrice) }])),
    returnItems: new Map(returns.map((item) => [item.id, { id: item.id, creditNoteId: item.creditNote.id,
      saleId: item.creditNote.saleId, saleItemId: item.saleItemId, productId: item.productId,
      active: item.creditNote.status === DocStatus.ACTIVE && item.creditNote.type === CreditNoteType.RETURN }])),
    sourceSaleItems: sourceItems.map((item) => ({ id: item.id, saleId: item.saleId, productId: item.productId,
      quantity: Number(item.quantity), costPrice: Number(item.costPrice) })),
  };
}

/**
 * RETURN credit notes of the restated sales whose cost reversal changes: a RESTOCK line that
 * resolves (exact sale line, else product-weighted) to a different cost after the restatement.
 */
async function findRestatedCreditNotes(client: RestatementClient, saleItems: RestatedSaleItem[]): Promise<RestatedCreditNote[]> {
  const saleIds = [...new Set(saleItems.map((item) => item.saleId))];
  if (saleIds.length === 0) return [];
  const lines = await client.creditNoteItem.findMany({
    where: { stockDisposition: MarketplaceReturnStockDisposition.RESTOCK,
      creditNote: { saleId: { in: saleIds }, status: DocStatus.ACTIVE, type: CreditNoteType.RETURN } },
    select: { saleItemId: true, productId: true, creditNote: { select: { id: true, cnNo: true, cnDate: true, saleId: true } } },
  });
  if (lines.length === 0) return [];
  const items = await client.saleItem.findMany({ where: { saleId: { in: saleIds } },
    select: { id: true, saleId: true, productId: true, quantity: true, costPrice: true } });
  const sourceItems = items.map((item) => ({ id: item.id, saleId: item.saleId, productId: item.productId,
    quantity: Number(item.quantity), costPrice: Number(item.costPrice) }));
  const after = new Map(saleItems.map((item) => [item.id, item.after]));
  const beforeMaps = buildReferenceMaps(sourceItems, (item) => item.costPrice);
  const afterMaps = buildReferenceMaps(sourceItems, (item) => after.get(item.id) ?? item.costPrice);
  const changed = new Map<string, RestatedCreditNote>();
  for (const line of lines) {
    const link = { saleId: line.creditNote.saleId, saleItemId: line.saleItemId, productId: line.productId };
    if (resolveReference(link, beforeMaps) !== resolveReference(link, afterMaps)) {
      changed.set(line.creditNote.id, { id: line.creditNote.id, cnNo: line.creditNote.cnNo, cnDate: line.creditNote.cnDate });
    }
  }
  return [...changed.values()].sort((a, b) => a.cnDate.getTime() - b.cnDate.getTime() || a.cnNo.localeCompare(b.cnNo));
}

/**
 * Plans the restatement for a DN cancel (no replacements) or line/VAT edit (replacement rows at the
 * DN's original position). Call after the DN's SKUs are locked; performs reads only. `source`
 * PURCHASE_ALLOWANCE (with the return number as `debitNo`) plans a purchase allowance change (V8).
 */
export async function planSaleCostRestatement(client: RestatementClient, input: {
  productIds: readonly string[]; debitNo: string; replacements: DebitReplacementRow[]; source?: ValueOnlyStockSource;
}): Promise<SaleCostRestatementPlan> {
  try {
    const productIds = [...new Set(input.productIds.filter(Boolean))];
    if (productIds.length === 0) return EMPTY_PLAN;
    const stored = await client.stockCard.findMany({
      where: { productId: { in: productIds } },
      orderBy: [{ productId: "asc" }, { docDate: "asc" }, { sorder: "asc" }],
      select: { ...STOCK_REPLAY_SELECT, docNo: true, referenceId: true },
    });
    const rows: PlanStockRow[] = stored.map((row) => ({ ...row, referenceId: row.referenceId ?? null }));
    const source = input.source ?? DEFAULT_VALUE_SOURCE;
    const boundaries = debitBoundaries(rows, input.debitNo, input.replacements, source);
    const links = await loadPlanLinks(client, rows.filter((row) => isAfterBoundary(row, boundaries.get(row.productId))));
    const plan: SaleCostRestatementPlan = { saleItems: [], returnRows: [], residualRows: [], creditNotes: [], unlinkedSaleRows: 0 };
    for (const productId of productIds) {
      const result = planProductRestatement({ rows: rows.filter((row) => row.productId === productId), debitNo: input.debitNo, source,
        replacements: input.replacements.filter((row) => row.productId === productId), saleItems: links.saleItems,
        returnItems: links.returnItems, sourceSaleItems: links.sourceSaleItems.filter((item) => item.productId === productId) });
      plan.saleItems.push(...result.saleItems);
      plan.returnRows.push(...result.returnRows);
      plan.residualRows.push(...result.residualRows);
      plan.unlinkedSaleRows += result.unlinkedSaleRows;
    }
    plan.creditNotes = await findRestatedCreditNotes(client, plan.saleItems);
    return plan;
  } catch (error) {
    console.error("[planSaleCostRestatement]", error);
    throw error;
  }
}

/** Dates of every later document whose profit the plan changes (for assertPeriodsUnlocked). */
export function restatementDates(plan: SaleCostRestatementPlan): Date[] {
  return [...plan.saleItems.map((item) => item.saleDate), ...plan.creditNotes.map((note) => note.cnDate),
    ...plan.residualRows.map((row) => row.docDate)];
}

export function summarizeSaleCostRestatement(plan: SaleCostRestatementPlan): SaleCostRestatementSummary {
  const sales = new Map<string, { saleNo: string; saleDate: Date }>();
  for (const item of plan.saleItems) sales.set(item.saleId, { saleNo: item.saleNo, saleDate: item.saleDate });
  const saleNos = [...sales.values()].sort((a, b) => a.saleDate.getTime() - b.saleDate.getTime() || a.saleNo.localeCompare(b.saleNo))
    .map((sale) => sale.saleNo);
  // Same per-line rounding as the SALE fact's costAmount (quantity x unit cost, 2 decimals).
  const costBefore = round2(plan.saleItems.reduce((sum, item) => sum + round2(item.quantity * item.before), 0));
  const costAfter = round2(plan.saleItems.reduce((sum, item) => sum + round2(item.quantity * item.after), 0));
  return { saleCount: saleNos.length, saleNos: saleNos.slice(0, MAX_AUDIT_DOC_NOS), saleNosTruncated: saleNos.length > MAX_AUDIT_DOC_NOS,
    lineCount: plan.saleItems.length, costBefore, costAfter, delta: round2(costAfter - costBefore),
    creditNoteCount: plan.creditNotes.length, creditNoteNos: plan.creditNotes.slice(0, MAX_AUDIT_DOC_NOS).map((note) => note.cnNo),
    returnRowCount: plan.returnRows.length, residualRowCount: plan.residualRows.length, unlinkedSaleRows: plan.unlinkedSaleRows };
}

/** Step 1, before the SKUs are replayed: restated RETURN_IN reference costs (StockCard priceIn). */
export async function applyRestatedReturnCosts(tx: Pick<Tx, "$executeRaw">, plan: SaleCostRestatementPlan): Promise<void> {
  try {
    for (let i = 0; i < plan.returnRows.length; i += UPDATE_CHUNK_SIZE) {
      const values = Prisma.join(plan.returnRows.slice(i, i + UPDATE_CHUNK_SIZE)
        .map((row) => Prisma.sql`(${row.stockCardId}, ${row.after}::numeric)`));
      await tx.$executeRaw`
        UPDATE "StockCard" AS sc SET "priceIn" = data."priceIn"
        FROM (VALUES ${values}) AS data("id", "priceIn")
        WHERE sc."id" = data."id" AND sc."source" = 'RETURN_IN' AND sc."usesReferenceCost" = true
      `;
    }
  } catch (error) {
    console.error("[applyRestatedReturnCosts]", error);
    throw error;
  }
}

/**
 * Step 2, after the SKUs are replayed: restated SaleItem.costPrice (and the sale's lot cost
 * snapshot SaleItemLot.unitCost, which claim costing reads first), then the SALE facts of the
 * restated sales and the SALE_RETURN facts of their affected RETURN credit notes.
 */
export async function applyRestatedSaleCosts(tx: Tx, plan: SaleCostRestatementPlan): Promise<void> {
  try {
    for (let i = 0; i < plan.saleItems.length; i += UPDATE_CHUNK_SIZE) {
      const chunk = plan.saleItems.slice(i, i + UPDATE_CHUNK_SIZE);
      const costs = Prisma.join(chunk.map((item) => Prisma.sql`(${item.id}, ${item.after}::numeric)`));
      await tx.$executeRaw`
        UPDATE "SaleItem" AS si SET "costPrice" = data."costPrice"
        FROM (VALUES ${costs}) AS data("id", "costPrice") WHERE si."id" = data."id"
      `;
      const deltas = Prisma.join(chunk.map((item) => Prisma.sql`(${item.id}, ${round2(item.after - item.before)}::numeric)`));
      await tx.$executeRaw`
        UPDATE "SaleItemLot" AS lot SET "unitCost" = GREATEST(0, lot."unitCost" + data."delta")
        FROM (VALUES ${deltas}) AS data("saleItemId", "delta") WHERE lot."saleItemId" = data."saleItemId"
      `;
    }
    for (const saleId of [...new Set(plan.saleItems.map((item) => item.saleId))]) await rebuildSaleProfitFacts(tx, saleId);
    for (const note of plan.creditNotes) await rebuildCreditNoteProfitFacts(tx, note.id);
  } catch (error) {
    console.error("[applyRestatedSaleCosts]", error);
    throw error;
  }
}
