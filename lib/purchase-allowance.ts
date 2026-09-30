import { Prisma, ProfitSourceType } from "@/lib/generated/prisma";
import { getStockValuationEpoch, recalculateStockCardMany, writeStockCard } from "@/lib/stock-card";
import { allocateBySatang, allocateSupplierDebitCoverage } from "@/lib/supplier-debit-note-calculation";
import {
  applyRestatedReturnCosts, applyRestatedSaleCosts, planSaleCostRestatement, restatementDates, summarizeSaleCostRestatement,
  type DebitReplacementRow, type SaleCostRestatementPlan, type SaleCostRestatementSummary,
} from "@/lib/sale-cost-restatement";
import { rebuildPurchaseAllowanceProfitFacts } from "@/lib/profit-fact";
import { PURCHASE_ALLOWANCE_LABEL, PURCHASE_ALLOWANCE_SOURCE } from "@/lib/stock-value-only-source";
import { roundItemQuantity } from "@/lib/item-quantity";
import { getThailandDateKey, getThailandMonthKey, parseDateOnlyToDate } from "@/lib/th-date";

/**
 * V8 "ลดราคาซื้อ" (owner approved 2026-09-30, W1–W7): a purchase return of type DISCOUNT or OTHER lowers stock cost
 * exactly like a negative supplier-DN adjustment.
 *
 * - W1: one value-only NEGATIVE StockCard row per line (source PURCHASE_ALLOWANCE, quantity 0), dated at the return's
 *   CREATION date (today's Thai business date when created) with its own same-day valuation epoch. AP, VAT and the
 *   document date stay on returnDate. Coverage = the SKU's aggregate on-hand just before that position: the covered
 *   part lowers inventory value (never below zero, the T3 clamp of lib/stock-card.ts), the rest is a negative
 *   PURCHASE_COST_VARIANCE in the posting period (lib/profit-fact.ts, subtype PURCHASE_ALLOWANCE).
 * - W2: DISCOUNT and OTHER; lines of untracked products post no row.
 * - W3: the cost removed follows lib/input-vat.ts: recoverable VAT → the pre-VAT subtotal, else the VAT-inclusive net,
 *   split over the lines to the satang.
 * - W5: an edit reverses the rows and reposts at the ORIGINAL posting date and position; an edit or cancel restates
 *   later sales and their RETURN credit notes (lib/sale-cost-restatement.ts). The caller checks the month lock over
 *   `lockDates` before any stock write.
 *
 * A return that settles a warranty claim (claimId) is left as before: whether a claim credit should lower the SKU's
 * stock cost is an open owner question (the claimed unit already left stock through CLAIM_SEND_OUT).
 */

type Tx = Prisma.TransactionClient;

const MONEY_SCALE = 2;
const ALLOWANCE_TYPES: ReadonlySet<string> = new Set(["DISCOUNT", "OTHER"]);
const FUTURE_STOCK_MESSAGE_PREFIX = "มีสต็อกวันที่ในอนาคต";

export type PurchaseAllowanceDocument = { type: string; claimId?: string | null };

/** A user-facing refusal (Thai) raised before any write. */
export class PurchaseAllowanceError extends Error {
  constructor(message: string) { super(message); this.name = "PurchaseAllowanceError"; }
}

/** W2: DISCOUNT and OTHER returns lower stock cost; a claim settlement is excluded (see the module note). */
export function postsPurchaseAllowance(doc: PurchaseAllowanceDocument): boolean {
  return ALLOWANCE_TYPES.has(doc.type) && !doc.claimId;
}

/** A DISCOUNT/OTHER type, whatever its claim link: such a return may hold ลดราคาซื้อ rows to reverse. */
export const isPurchaseAllowanceType = (type: string): boolean => ALLOWANCE_TYPES.has(type);

const money = (value: Prisma.Decimal | number): number =>
  new Prisma.Decimal(value).toDecimalPlaces(MONEY_SCALE, Prisma.Decimal.ROUND_HALF_UP).toNumber();
const negate = (value: number): number => (value === 0 ? 0 : -value);

/**
 * W3: the cost each line removes. Recoverable input VAT (decided by the caller from lib/input-vat.ts, inherited from the
 * referenced purchase — V3) removes the pre-VAT subtotal, otherwise the VAT-inclusive net. The header amount is split
 * over the lines by their amounts to the satang (largest remainder), so the lines always sum to the header; a one-line
 * return gets exactly its line's pre-VAT or VAT-inclusive amount.
 */
export function allocatePurchaseAllowanceAmounts(input: {
  lineAmounts: readonly number[]; subtotalAmount: number; netAmount: number; vatRecoverable: boolean;
}): number[] {
  const basis = money(input.vatRecoverable ? input.subtotalAmount : input.netAmount);
  const weights = input.lineAmounts.map((amount) => new Prisma.Decimal(Math.max(0, money(amount))));
  return allocateBySatang(new Prisma.Decimal(Math.max(0, basis)), weights).map((share) => share.toNumber());
}

/** One return line as the posting sees it: base quantity (W7 exact), its allowance cost and whether stock is tracked. */
export type PurchaseAllowanceSourceLine = {
  lineNo: number; productId: string; qtyInBase: number; costAmount: number; isTracked: boolean;
};

/** A posted (or to-be-posted) line: inventoryAmount and varianceAmount are ≤ 0 and sum to -costAmount. */
export type PurchaseAllowanceLine = {
  lineNo: number; productId: string; affectedBaseQuantity: number; costAmount: number; eligibleBaseQuantity: number;
  inventoryAmount: number; varianceAmount: number;
};

/** The same-day valuation position of a SKU's ลดราคาซื้อ rows (they sort first within their epoch). */
export type PurchaseAllowancePosition = { docDate: Date; valuationEpoch: number };
export type PurchaseAllowancePositions = ReadonlyMap<string, PurchaseAllowancePosition>;

/** The stored ลดราคาซื้อ rows of a return. */
export type PostedAllowanceRow = {
  id: string; productId: string; docDate: Date; valuationEpoch: number; referenceId: string | null;
  valueAdjustment: number; costVariance: number;
};

const BEFORE_POSITION_ORDER = [{ docDate: "desc" as const }, { valuationEpoch: "desc" as const }, { sorder: "desc" as const }];
const beforePositionWhere = (productId: string, position: PurchaseAllowancePosition) => ({ productId, OR: [
  { docDate: { lt: position.docDate } }, { docDate: position.docDate, valuationEpoch: { lt: position.valuationEpoch } },
] });

/** Today's Thai business date: the posting date of a new return (W1). */
export const todayPurchaseAllowancePostingDate = (): Date => parseDateOnlyToDate(getThailandDateKey());

export async function loadPostedAllowanceRows(tx: Pick<Tx, "stockCard">, returnNo: string): Promise<PostedAllowanceRow[]> {
  try {
    const rows = await tx.stockCard.findMany({
      where: { docNo: returnNo, source: PURCHASE_ALLOWANCE_SOURCE },
      orderBy: [{ docDate: "asc" }, { sorder: "asc" }],
      select: { id: true, productId: true, docDate: true, valuationEpoch: true, referenceId: true, valueAdjustment: true, costVariance: true },
    });
    return rows.map((row) => ({ ...row, valueAdjustment: Number(row.valueAdjustment), costVariance: Number(row.costVariance) }));
  } catch (error) {
    console.error("[loadPostedAllowanceRows]", error);
    throw error;
  }
}

/** W1/W5: the original posting date is the stored rows' date, else the return's creation date (Thai business day). */
export function resolvePurchaseAllowancePostingDate(rows: readonly PostedAllowanceRow[], createdAt: Date): Date {
  const stored = rows.reduce<Date | null>((earliest, row) => (!earliest || row.docDate < earliest ? row.docDate : earliest), null);
  return stored ?? parseDateOnlyToDate(getThailandDateKey(createdAt));
}

/**
 * Each SKU's position: a posted SKU keeps its stored epoch (an edit reposts there); a SKU without a row takes the
 * posting date after that SKU's existing rows of the day, like a DN posted on that date.
 */
async function resolvePositions(tx: Pick<Tx, "stockCard">, postingDate: Date, rows: readonly PostedAllowanceRow[],
  productIds: readonly string[]): Promise<Map<string, PurchaseAllowancePosition>> {
  const positions = new Map<string, PurchaseAllowancePosition>();
  for (const row of rows) {
    const current = positions.get(row.productId);
    if (!current || row.valuationEpoch < current.valuationEpoch) {
      positions.set(row.productId, { docDate: row.docDate, valuationEpoch: row.valuationEpoch });
    }
  }
  for (const productId of new Set(productIds)) {
    if (positions.has(productId)) continue;
    positions.set(productId, { docDate: postingDate, valuationEpoch: (await getStockValuationEpoch(tx, productId, postingDate)) + 1 });
  }
  return positions;
}

/** Coverage = the running on-hand base quantity just before the position (value-only rows never change quantity). */
async function readCoverage(tx: Pick<Tx, "stockCard">, productIds: readonly string[],
  positions: PurchaseAllowancePositions): Promise<Map<string, number>> {
  const stocks = new Map<string, number>();
  for (const productId of new Set(productIds)) {
    const position = positions.get(productId);
    if (!position) { stocks.set(productId, 0); continue; }
    const before = await tx.stockCard.findFirst({ where: beforePositionWhere(productId, position),
      orderBy: BEFORE_POSITION_ORDER, select: { qtyBalance: true } });
    stocks.set(productId, before ? Number(before.qtyBalance) : 0);
  }
  return stocks;
}

const eligibleLines = (lines: readonly PurchaseAllowanceSourceLine[]): PurchaseAllowanceSourceLine[] =>
  lines.filter((line) => line.isTracked && line.costAmount > 0 && line.qtyInBase > 0);

/** Coverage per SKU, grouped once across duplicate lines (allocateSupplierDebitCoverage), with negative signs. */
async function allocateLines(tx: Pick<Tx, "stockCard">, lines: readonly PurchaseAllowanceSourceLine[],
  positions: PurchaseAllowancePositions): Promise<PurchaseAllowanceLine[]> {
  const eligible = eligibleLines(lines);
  if (eligible.length === 0) return [];
  const stocks = await readCoverage(tx, eligible.map((line) => line.productId), positions);
  const quantities = eligible.map((line) => roundItemQuantity(line.qtyInBase));
  const allocations = allocateSupplierDebitCoverage(eligible.map((line, index) => ({
    productId: line.productId, affectedBaseQuantity: quantities[index], costAdjustmentAmount: line.costAmount })), stocks);
  return eligible.map((line, index) => ({ lineNo: line.lineNo, productId: line.productId,
    affectedBaseQuantity: quantities[index], costAmount: money(line.costAmount),
    eligibleBaseQuantity: allocations[index].eligibleBaseQuantity,
    inventoryAmount: negate(allocations[index].inventoryAmount), varianceAmount: negate(allocations[index].varianceAmount) }));
}

/** A new return posts today; like a DN, a stock row dated after today would sort after it unrestated, so it is refused. */
async function assertNoFutureStock(tx: Pick<Tx, "stockCard">, productIds: readonly string[], postingDate: Date): Promise<void> {
  if (productIds.length === 0) return;
  const future = await tx.stockCard.findFirst({ where: { productId: { in: [...new Set(productIds)] }, docDate: { gt: postingDate } },
    select: { docNo: true } });
  if (future) throw new PurchaseAllowanceError(`${FUTURE_STOCK_MESSAGE_PREFIX} ${future.docNo} กรุณาตรวจสอบก่อนบันทึก${PURCHASE_ALLOWANCE_LABEL}`);
}

export type PreparedPurchaseAllowance = {
  postingDate: Date; positions: PurchaseAllowancePositions; lines: PurchaseAllowanceLine[];
};

/**
 * Create (reads only, before any write): locks nothing itself — the caller holds the sorted SKU locks — refuses stock
 * dated after today, then takes coverage at today's new position of every SKU.
 */
export async function preparePurchaseAllowanceCreate(tx: Pick<Tx, "stockCard">, input: {
  postingDate: Date; lines: readonly PurchaseAllowanceSourceLine[];
}): Promise<PreparedPurchaseAllowance> {
  try {
    const productIds = eligibleLines(input.lines).map((line) => line.productId);
    await assertNoFutureStock(tx, productIds, input.postingDate);
    const positions = await resolvePositions(tx, input.postingDate, [], productIds);
    return { postingDate: input.postingDate, positions, lines: await allocateLines(tx, input.lines, positions) };
  } catch (error) {
    console.error("[preparePurchaseAllowanceCreate]", error);
    throw error;
  }
}

const describeLine = (line: PurchaseAllowanceLine): string =>
  `${PURCHASE_ALLOWANCE_LABEL} · มูลค่าสต็อก ${line.inventoryAmount.toFixed(MONEY_SCALE)} / ส่วนต่างต้นทุน ${line.varianceAmount.toFixed(MONEY_SCALE)}`;

/** Links each line to the purchase-return line it posts for (StockCard referenceId). */
export function attachAllowanceItemIds(lines: readonly PurchaseAllowanceLine[],
  itemIds: ReadonlyMap<number, string>): Array<PurchaseAllowanceLine & { itemId: string }> {
  return lines.map((line) => {
    const itemId = itemIds.get(line.lineNo);
    if (!itemId) throw new Error(`Missing purchase return item for line ${line.lineNo}`);
    return { ...line, itemId };
  });
}

/** Writes one value-only row per line at its SKU's position (each insert replays the SKU's MAVG). */
export async function postPurchaseAllowanceLines(tx: Tx, input: {
  returnNo: string; positions: PurchaseAllowancePositions; lines: ReadonlyArray<PurchaseAllowanceLine & { itemId: string }>;
}): Promise<void> {
  try {
    for (const line of input.lines) {
      const position = input.positions.get(line.productId);
      if (!position) throw new Error(`Missing purchase allowance position for ${line.productId}`);
      await writeStockCard(tx, { productId: line.productId, docNo: input.returnNo, docDate: position.docDate,
        source: PURCHASE_ALLOWANCE_SOURCE, qtyIn: 0, qtyOut: 0, priceIn: 0, valuationEpoch: position.valuationEpoch,
        valueAdjustment: line.inventoryAmount, costVariance: line.varianceAmount, referenceId: line.itemId, detail: describeLine(line) });
    }
  } catch (error) {
    console.error("[postPurchaseAllowanceLines]", error);
    throw error;
  }
}

const valueKey = (productId: string, inventory: number, variance: number): string =>
  `${productId}|${money(inventory).toFixed(MONEY_SCALE)}|${money(variance).toFixed(MONEY_SCALE)}`;
const sameMultiset = (left: string[], right: string[]): boolean => {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((key, index) => key === b[index]);
};

/** A planned edit or cancel: what to reverse, what to repost, the restatement and the dates the month lock checks. */
export type PurchaseAllowanceChange = {
  returnNo: string; postingDate: Date; positions: PurchaseAllowancePositions;
  oldRows: PostedAllowanceRow[]; lines: PurchaseAllowanceLine[];
  /** Nothing to write: same values at the same position referencing the same (kept) lines. */
  unchanged: boolean;
  plan: SaleCostRestatementPlan;
  lockDates: Date[];
};

const EMPTY_PLAN: SaleCostRestatementPlan = { saleItems: [], returnRows: [], residualRows: [], creditNotes: [], unlinkedSaleRows: 0 };

/**
 * Edit or cancel planning (reads only; call under the return's row lock and the sorted SKU locks, before any stock
 * write). `lines` is empty when the return no longer posts an allowance (a cancel, or a type change to RETURN).
 * `keptItemIds` maps a line number to the id of a line the edit keeps; when every new line is kept and the values are
 * unchanged, nothing is rewritten. The posting date is locked only when the valuation changes.
 */
export async function planPurchaseAllowanceChange(tx: Tx, input: {
  returnNo: string; createdAt: Date; lines: readonly PurchaseAllowanceSourceLine[];
  keptItemIds?: ReadonlyMap<number, string>;
}): Promise<PurchaseAllowanceChange> {
  try {
    const oldRows = await loadPostedAllowanceRows(tx, input.returnNo);
    const postingDate = resolvePurchaseAllowancePostingDate(oldRows, input.createdAt);
    const newProductIds = eligibleLines(input.lines).map((line) => line.productId);
    const positions = await resolvePositions(tx, postingDate, oldRows, newProductIds);
    const lines = await allocateLines(tx, input.lines, positions);
    const valuesChanged = !sameMultiset(oldRows.map((row) => valueKey(row.productId, row.valueAdjustment, row.costVariance)),
      lines.map((line) => valueKey(line.productId, line.inventoryAmount, line.varianceAmount)));
    const referencesKept = lines.every((line) => input.keptItemIds?.has(line.lineNo)) && sameMultiset(
      oldRows.map((row) => `${row.referenceId ?? ""}|${valueKey(row.productId, row.valueAdjustment, row.costVariance)}`),
      lines.map((line) => `${input.keptItemIds?.get(line.lineNo) ?? ""}|${valueKey(line.productId, line.inventoryAmount, line.varianceAmount)}`));
    const replacements: DebitReplacementRow[] = lines.flatMap((line) => {
      const position = positions.get(line.productId);
      return position ? [{ productId: line.productId, docDate: position.docDate, valuationEpoch: position.valuationEpoch,
        valueAdjustment: line.inventoryAmount }] : [];
    });
    const plan = valuesChanged ? await planSaleCostRestatement(tx, {
      productIds: [...new Set([...oldRows.map((row) => row.productId), ...newProductIds])],
      debitNo: input.returnNo, source: PURCHASE_ALLOWANCE_SOURCE, replacements,
    }) : EMPTY_PLAN;
    return { returnNo: input.returnNo, postingDate, positions, oldRows, lines,
      unchanged: !valuesChanged && referencesKept, plan,
      lockDates: valuesChanged ? [postingDate, ...restatementDates(plan)] : [] };
  } catch (error) {
    console.error("[planPurchaseAllowanceChange]", error);
    throw error;
  }
}

/** What a cancel or an edit would touch: the dates its month lock checks, and the later sales it restates when planned. */
export type PurchaseAllowanceChangePreview = {
  lockDates: Date[];
  restatement: { saleCount: number; delta: number } | null;
};
export type PurchaseAllowanceCancelPreview = PurchaseAllowanceChangePreview;

/**
 * X4 / Y2 (owner 2026-09-30), reads only and no locks: the ลดราคาซื้อ side of a cancel (`lines` empty) or an edit (the
 * lines the edit would post) — the posting date plus, through planPurchaseAllowanceChange (the planner the cancel and
 * the edit themselves run), the later sales, their RETURN credit notes and residual rows it restates. Like
 * previewSupplierDebitCancel, the replay is skipped when no month from the posting month on is declared: restated
 * documents come after the posting, so none could be locked. The action plans the change again under its locks and
 * stays the source of truth.
 */
export async function previewPurchaseAllowanceChange(tx: Tx, input: {
  returnNo: string; createdAt: Date; lines: readonly PurchaseAllowanceSourceLine[];
}): Promise<PurchaseAllowanceChangePreview> {
  try {
    const rows = await loadPostedAllowanceRows(tx, input.returnNo);
    if (rows.length === 0 && input.lines.length === 0) return { lockDates: [], restatement: null };
    const postingDate = resolvePurchaseAllowancePostingDate(rows, input.createdAt);
    const declared = await tx.profitDistribution.findFirst({ where: { status: "ACTIVE",
      activePeriodKey: { gte: getThailandMonthKey(postingDate) } }, select: { id: true } });
    if (!declared) return { lockDates: [postingDate], restatement: null };
    const change = await planPurchaseAllowanceChange(tx, { returnNo: input.returnNo, createdAt: input.createdAt, lines: input.lines });
    const summary = summarizeSaleCostRestatement(change.plan);
    return { lockDates: change.lockDates, restatement: { saleCount: summary.saleCount, delta: summary.delta } };
  } catch (error) {
    console.error("[previewPurchaseAllowanceChange]", error);
    throw error;
  }
}

/** X4: the cancel dialog's preview — a change that posts no line. */
export const previewPurchaseAllowanceCancel = (tx: Tx, input: {
  returnNo: string; createdAt: Date;
}): Promise<PurchaseAllowanceCancelPreview> => previewPurchaseAllowanceChange(tx, { ...input, lines: [] });

/**
 * Step 1 of an edit or cancel, after the month lock passed: deletes the stored rows, writes the restated RETURN_IN
 * reference costs, and replays every SKU that gets no new row (a reposted SKU is replayed when its new row is written).
 */
export async function reversePurchaseAllowance(tx: Tx, change: PurchaseAllowanceChange): Promise<void> {
  try {
    if (change.unchanged || change.oldRows.length === 0) {
      if (!change.unchanged) await applyRestatedReturnCosts(tx, change.plan);
      return;
    }
    await tx.stockCard.deleteMany({ where: { docNo: change.returnNo, source: PURCHASE_ALLOWANCE_SOURCE } });
    await applyRestatedReturnCosts(tx, change.plan);
    const reposted = new Set(change.lines.map((line) => line.productId));
    await recalculateStockCardMany(tx, change.oldRows.map((row) => row.productId).filter((productId) => !reposted.has(productId)));
  } catch (error) {
    console.error("[reversePurchaseAllowance]", error);
    throw error;
  }
}

/**
 * Step 2, after the return's lines are written: reposts at the original positions, writes the restated sale costs
 * (and their credit-note facts) and rebuilds the return's variance facts. A cancel passes `cancelled`, which only
 * deactivates the facts.
 */
export async function repostPurchaseAllowance(tx: Tx, change: PurchaseAllowanceChange, input: {
  purchaseReturnId: string; itemIds: ReadonlyMap<number, string>; cancelled?: boolean;
}): Promise<void> {
  try {
    if (change.unchanged) return;
    if (!input.cancelled) {
      await postPurchaseAllowanceLines(tx, { returnNo: change.returnNo, positions: change.positions,
        lines: attachAllowanceItemIds(change.lines, input.itemIds) });
    }
    await applyRestatedSaleCosts(tx, change.plan);
    if (input.cancelled) {
      await tx.factProfit.updateMany({
        where: { sourceType: ProfitSourceType.PURCHASE_COST_VARIANCE, sourceId: input.purchaseReturnId, isActive: true },
        data: { isActive: false, supersededAt: new Date(), sourceStatus: "CANCELLED" },
      });
      return;
    }
    await rebuildPurchaseAllowanceProfitFacts(tx, input.purchaseReturnId);
  } catch (error) {
    console.error("[repostPurchaseAllowance]", error);
    throw error;
  }
}

/** The audit entry's view of a posting (create, edit or cancel). */
export type PurchaseAllowanceAudit = {
  postingDate: string; inventoryAmount: number; varianceAmount: number;
  lines: Array<{ lineNo: number; productId: string; affectedBaseQuantity: number; eligibleBaseQuantity: number;
    costAmount: number; inventoryAmount: number; varianceAmount: number }>;
  reversed?: { inventoryAmount: number; varianceAmount: number };
  restatement?: SaleCostRestatementSummary;
};

const sumMoney = (values: number[]): number => money(values.reduce((sum, value) => sum + value, 0));

export function summarizePurchaseAllowance(input: {
  postingDate: Date; lines: readonly PurchaseAllowanceLine[]; change?: PurchaseAllowanceChange;
}): PurchaseAllowanceAudit {
  const lines = input.lines.map((line) => ({ lineNo: line.lineNo, productId: line.productId,
    affectedBaseQuantity: line.affectedBaseQuantity, eligibleBaseQuantity: line.eligibleBaseQuantity,
    costAmount: line.costAmount, inventoryAmount: line.inventoryAmount, varianceAmount: line.varianceAmount }));
  return {
    postingDate: getThailandDateKey(input.postingDate),
    inventoryAmount: sumMoney(lines.map((line) => line.inventoryAmount)),
    varianceAmount: sumMoney(lines.map((line) => line.varianceAmount)),
    lines,
    ...(input.change ? {
      reversed: { inventoryAmount: sumMoney(input.change.oldRows.map((row) => row.valueAdjustment)),
        varianceAmount: sumMoney(input.change.oldRows.map((row) => row.costVariance)) },
      restatement: summarizeSaleCostRestatement(input.change.plan),
    } : {}),
  };
}
