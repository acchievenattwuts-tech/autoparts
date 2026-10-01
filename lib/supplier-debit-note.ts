import { z, ZodError } from "zod";
import { dbTx } from "@/lib/db";
import { Prisma, AuditAction } from "@/lib/generated/prisma";
import {
  formatDateOnlyForInput, formatDateThai, getThailandDateKey, getThailandMonthKey, isDateOnlyString, parseDateOnlyToDate,
} from "@/lib/th-date";
import { generateSupplierDebitNo } from "@/lib/doc-number";
import { writeAuditLogTx, type AuditLogActor, type AuditRequestContext } from "@/lib/audit-log";
import { notifySupplierDebitNote, safeNotifyPeriodLockOverride } from "@/lib/notifications";
import { getStockValuationEpoch, writeStockCard, recalculateStockCardMany } from "@/lib/stock-card";
import { calculateSupplierDebitDocument, allocateSupplierDebitCoverage } from "@/lib/supplier-debit-note-calculation";
import { getVatRegisteredFrom, isInputVatRecoverable } from "@/lib/input-vat";
import { rebuildSupplierDebitProfitFacts } from "@/lib/profit-fact";
import { revalidateProfitDashboardCache } from "@/lib/profit-cache";
import { createDocumentMutationGuard, buildMutationBlockMessage, type GuardDb } from "@/lib/document-mutation-guard";
import {
  assertPeriodsUnlocked, findLockedPeriods, normalizeOverrideReason, PeriodLockedError, type LockedPeriod, type PeriodLockOverride,
} from "@/lib/period-lock";
import {
  applyRestatedReturnCosts, applyRestatedSaleCosts, planSaleCostRestatement, restatementDates, summarizeSaleCostRestatement,
  type DebitReplacementRow, type SaleCostRestatementPlan, type SaleCostRestatementSummary,
} from "@/lib/sale-cost-restatement";
import { clearSupplierDebitRefund, recalculateSupplierDebitBalance } from "@/lib/supplier-debit-balance";

const MAX_DEBIT_ITEMS = 100;
const MAX_MONEY = 99_999_999.99;
const dateSchema = z.string().refine(isDateOnlyString, "วันที่ไม่ถูกต้อง");
const MAX_QUANTITY_DECIMALS = 4;
const positiveMoney = z.number().finite().positive().max(MAX_MONEY)
  .refine((value) => new Prisma.Decimal(value).decimalPlaces() <= 2, "จำนวนเงินต้องไม่เกิน 2 ทศนิยม");
const positiveQuantity = z.number().finite().positive()
  .refine((value) => new Prisma.Decimal(value).decimalPlaces() <= MAX_QUANTITY_DECIMALS, "จำนวนที่ปรับต้องไม่เกิน 4 ทศนิยม");
// vatRecoverable is deliberately absent: the server decides it (decideDebitVatRecoverable) and Zod strips any client value.
export const supplierDebitNoteSchema = z.object({
  purchaseId: z.string().min(1), supplierReferenceNo: z.string().trim().min(1).max(100),
  debitDate: dateSchema, receivedDate: dateSchema, dueDate: dateSchema,
  reason: z.string().trim().min(1, "กรุณาระบุเหตุผล").max(1000), note: z.string().trim().max(2000).default(""),
  vatType: z.enum(["NO_VAT", "EXCLUDING_VAT", "INCLUDING_VAT"]),
  vatRate: z.number().finite().min(0).max(100)
    .refine((value) => new Prisma.Decimal(value).decimalPlaces() <= 2, "อัตรา VAT ต้องไม่เกิน 2 ทศนิยม"),
  expectedInventoryAmount: z.number().finite().nonnegative().optional(),
  expectedVarianceAmount: z.number().finite().nonnegative().optional(),
  items: z.array(z.object({ purchaseItemId: z.string().min(1),
    affectedQuantity: positiveQuantity, amountMode: z.enum(["PER_UNIT", "TOTAL"]),
    increaseAmount: positiveMoney,
  })).min(1).max(MAX_DEBIT_ITEMS),
});
export type SupplierDebitNoteInput = z.infer<typeof supplierDebitNoteSchema>;
const STALE_DEBIT_MESSAGE = "เอกสารนี้ถูกแก้ไขโดยผู้อื่นระหว่างที่คุณแก้ไข กรุณาโหลดหน้าใหม่";
/** Edit adds the DN's updatedAt as loaded by the form, for optimistic concurrency. */
export const supplierDebitNoteUpdateSchema = supplierDebitNoteSchema.extend({
  expectedUpdatedAt: z.string({ error: STALE_DEBIT_MESSAGE })
    .refine((value) => !Number.isNaN(Date.parse(value)), STALE_DEBIT_MESSAGE),
});

/** The DN changed after the edit form loaded it. */
export class SupplierDebitStaleError extends Error {
  constructor() { super(STALE_DEBIT_MESSAGE); this.name = "SupplierDebitStaleError"; }
}
/** Amounts or VAT changed without a matching fresh preview; the form must show "ตรวจยอด" again. */
export class SupplierDebitPreviewRequiredError extends Error {
  constructor() { super("ยอดจัดสรรต้นทุนเปลี่ยนหรือยังไม่ได้ตรวจยอด กรุณาตรวจยอดอีกครั้งก่อนบันทึก"); this.name = "SupplierDebitPreviewRequiredError"; }
}

/**
 * T4 (owner approved 2026-09-30): a supplier's DN number may be reused once the earlier DN is CANCELLED, but never twice
 * among the supplier's ACTIVE DNs. The database enforces it with the partial unique index of
 * prisma/migrations/20260930_review_round4/indexes/01.sql:
 *   ("supplierId", upper(regexp_replace("supplierReferenceNo", '[ \t./-]', '', 'g'))) WHERE "status" = 'ACTIVE'
 * normalizeSupplierReferenceKey is the JavaScript twin of that key expression:
 * - The bracket class removes the same five characters: space, tab (\t is a PostgreSQL ARE escape that stays valid inside
 *   brackets), '.', '/' and '-' (literal inside brackets; '-' because it is last). 'g' and /g both remove every occurrence.
 *   Any other whitespace (newline, no-break space) is kept by both.
 * - Both remove before upper-casing; none of the removed characters has a case, so the order cannot matter.
 * - upper() and toUpperCase() agree on ASCII, and Thai has no case, so Thai characters pass through both unchanged. They can
 *   differ only on rare non-ASCII letters (e.g. 'ß' becomes "SS" in JavaScript, unchanged by a libc upper()); the index is
 *   the final authority, see toSupplierReferenceConflict.
 */
export const SUPPLIER_REFERENCE_ACTIVE_INDEX = "SupplierDebitNote_active_supplier_reference_key";
const SUPPLIER_REFERENCE_IGNORED_CHARACTERS = /[ \t./-]/g;
export const normalizeSupplierReferenceKey = (value: string): string =>
  value.replace(SUPPLIER_REFERENCE_IGNORED_CHARACTERS, "").toUpperCase();
export type SupplierReferenceConflict = { id: string; debitNo: string; supplierReferenceNo: string };
const SUPPLIER_REFERENCE_REUSE_RULE = "เลขที่ต่างกันเพียงตัวพิมพ์เล็ก-ใหญ่ เว้นวรรค จุด / หรือ - ถือเป็นเลขเดียวกัน · ใช้เลขซ้ำได้เมื่อยกเลิก DN เดิมแล้วเท่านั้น";
export const buildSupplierReferenceConflictMessage = (existing: SupplierReferenceConflict | null): string => existing
  ? `เลข DN ของซัพพลายเออร์ซ้ำกับ ${existing.debitNo} (เลขของซัพพลายเออร์ ${existing.supplierReferenceNo}) ที่ยังใช้งานอยู่ · ${SUPPLIER_REFERENCE_REUSE_RULE}`
  : `เลข DN ของซัพพลายเออร์ซ้ำกับ DN อื่นของซัพพลายเออร์นี้ที่ยังใช้งานอยู่ · ${SUPPLIER_REFERENCE_REUSE_RULE}`;
/** Another ACTIVE DN of the same supplier already holds this supplier DN number (same normalized key). */
export class SupplierDebitReferenceConflictError extends Error {
  readonly existing: SupplierReferenceConflict | null;
  constructor(existing: SupplierReferenceConflict | null) {
    super(buildSupplierReferenceConflictMessage(existing)); this.name = "SupplierDebitReferenceConflictError"; this.existing = existing;
  }
}
/** P2002 raised by the T4 index. Prisma 7 + adapter-pg name the index only in meta (the driver's original message). */
export function isActiveSupplierReferenceViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  let meta = "";
  try { meta = JSON.stringify(error.meta ?? {}); } catch { meta = ""; }
  return error.message.includes(SUPPLIER_REFERENCE_ACTIVE_INDEX) || meta.includes(SUPPLIER_REFERENCE_ACTIVE_INDEX);
}
export type SupplierDebitActor = AuditLogActor & AuditRequestContext & { userId: string };
type Actor = SupplierDebitActor;
type Tx = Prisma.TransactionClient;

/**
 * Month lock (lib/period-lock.ts, owner decision T2): an admin holding PERIOD_LOCK_OVERRIDE_PERMISSION
 * may change a DN in a distributed month by giving a reason; the action resolves `allowed` from the session.
 */
export type SupplierDebitMutationOptions = { periodLockOverride?: PeriodLockOverride };
/** Recorded in the DN audit entry (meta.periodLockOverride) and sent as the override alert after commit. */
export type PeriodLockOverrideRecord = { reason: string; periods: LockedPeriod[] };

/** "ตุลาคม 2026" for a "YYYY-MM" key; day: undefined drops formatDateThai's default day part. */
const formatPeriodKeyLabel = (periodKey: string): string => {
  const [year, month] = periodKey.split("-").map(Number);
  return formatDateThai(new Date(Date.UTC(year, month - 1, 15)), { day: undefined, month: "long", year: "numeric" });
};

/** assertPeriodsUnlocked over `dates`; returns the override to record when one was used. */
export async function assertDebitPeriodsUnlocked(tx: Tx, dates: Array<Date | null | undefined>,
  options: SupplierDebitMutationOptions | undefined): Promise<PeriodLockOverrideRecord | null> {
  try {
    const result = await assertPeriodsUnlocked(tx, dates, options?.periodLockOverride);
    const reason = normalizeOverrideReason(options?.periodLockOverride?.reason);
    return result.overridden && reason ? { reason, periods: result.locked } : null;
  } catch (error) {
    console.error("[assertDebitPeriodsUnlocked]", error);
    throw error;
  }
}

const mergeOverrides = (...records: Array<PeriodLockOverrideRecord | null>): PeriodLockOverrideRecord | null => {
  const used = records.filter((record): record is PeriodLockOverrideRecord => record !== null);
  if (used.length === 0) return null;
  const periods = new Map(used.flatMap((record) => record.periods).map((period) => [period.periodKey, period]));
  return { reason: used[0].reason, periods: [...periods.values()].sort((a, b) => a.periodKey.localeCompare(b.periodKey)) };
};

export const overrideAuditMeta = (record: PeriodLockOverrideRecord | null): { meta?: { periodLockOverride: PeriodLockOverrideRecord } } =>
  record ? { meta: { periodLockOverride: record } } : {};

export async function notifyDebitPeriodOverride(record: PeriodLockOverrideRecord | null, debit: { id: string; debitNo: string },
  action: string, actor: Actor): Promise<void> {
  if (!record) return;
  await safeNotifyPeriodLockOverride({ entityType: "SupplierDebitNote", entityId: debit.id, docNo: debit.debitNo, action,
    periodLabels: record.periods.map((period) => formatPeriodKeyLabel(period.periodKey)), reason: record.reason,
    actorName: actor.userName ?? null, link: `/admin/supplier-debit-notes/${debit.id}` });
}
export type PreparedDebitLine = SupplierDebitNoteInput["items"][number] & {
  productId: string; unitScale: number; showUnitName: string; originalUnitPrice: number;
  productCode: string; productName: string; affectedBaseQuantity: number; subtotalAmount: number;
  vatAmount: number; netAmount: number; costAdjustmentAmount: number; eligibleBaseQuantity: number;
  inventoryAmount: number; varianceAmount: number;
};
type PreparedDebit = {
  purchase: Prisma.PurchaseGetPayload<{ include: { items: { include: { product: true } } } }>;
  lines: PreparedDebitLine[];
};

const sumMoney = (values: number[]): number => values.reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0)).toNumber();

function assertDebitDates(input: Pick<SupplierDebitNoteInput, "debitDate" | "receivedDate">, today: Date): void {
  if (input.debitDate > input.receivedDate || input.receivedDate > getThailandDateKey(today)) {
    throw new Error("วันที่ออกต้องไม่เกินวันที่ได้รับ และวันที่ได้รับต้องไม่เกินวันนี้");
  }
}

export function summarizeDebitLines(lines: PreparedDebitLine[]): {
  subtotalAmount: number; vatAmount: number; netAmount: number; inventoryAmount: number; varianceAmount: number;
} {
  const netAmount = sumMoney(lines.map((line) => line.netAmount));
  // Adjustment DNs carry signed amounts; the column bound applies to both signs.
  if (Math.abs(netAmount) > MAX_MONEY) throw new Error("ยอดรวม DN เกินขอบเขตจำนวนเงินที่ระบบรองรับ");
  return { subtotalAmount: sumMoney(lines.map((line) => line.subtotalAmount)),
    vatAmount: sumMoney(lines.map((line) => line.vatAmount)), netAmount,
    inventoryAmount: sumMoney(lines.map((line) => line.inventoryAmount)),
    varianceAmount: sumMoney(lines.map((line) => line.varianceAmount)) };
}

function assertPreviewedAllocation(input: SupplierDebitNoteInput, lines: PreparedDebitLine[]): void {
  if (input.expectedInventoryAmount === undefined || input.expectedVarianceAmount === undefined ||
    input.expectedInventoryAmount !== sumMoney(lines.map((line) => line.inventoryAmount)) ||
    input.expectedVarianceAmount !== sumMoney(lines.map((line) => line.varianceAmount))) {
    throw new SupplierDebitPreviewRequiredError();
  }
}

async function lockDebitProducts(tx: Tx, productIds: string[]): Promise<void> {
  try {
    if (productIds.length === 0) return;
    await tx.$queryRaw`SELECT id FROM "Product" WHERE id IN (${Prisma.join([...new Set(productIds)].sort())}) ORDER BY id FOR UPDATE`;
  } catch (error) {
    console.error("[lockDebitProducts]", error);
    throw error;
  }
}

/**
 * A DN's valuation position on one SKU: its posting date and same-day epoch. The DN row sorts first
 * within its epoch (source group -1), so "before the DN" is every earlier date plus the same date's
 * lower epochs. An edit reposts at the original position (T1, owner approved 2026-09-30).
 */
export type DebitStockPosition = { docDate: Date; valuationEpoch: number };
type DebitStockPositions = ReadonlyMap<string, DebitStockPosition>;
const BEFORE_POSITION_ORDER = [{ docDate: "desc" as const }, { valuationEpoch: "desc" as const }, { sorder: "desc" as const }];
const beforePositionWhere = (productId: string, position: DebitStockPosition) => ({ productId, OR: [
  { docDate: { lt: position.docDate } }, { docDate: position.docDate, valuationEpoch: { lt: position.valuationEpoch } },
] });

/**
 * DN coverage uses the true on-hand base quantity: the latest StockCard qtyBalance (the same
 * [productId, docDate, sorder] row postDebitLines snapshots as stockBefore), because Product.stock
 * is rounded to an integer while the MAVG replay divides by the unrounded quantity. For integer
 * stock both are equal. Untracked products never capitalize. With `positions` (edit) coverage is the
 * running qtyBalance just before the DN's original position instead of today's on-hand.
 */
async function readCoverageStock(tx: Tx, products: Array<{ id: string; inventoryTracking: string }>,
  positions?: DebitStockPositions): Promise<Map<string, number>> {
  try {
    const stocks = new Map<string, number>();
    for (const product of products) {
      if (product.inventoryTracking !== "TRACKED") { stocks.set(product.id, 0); continue; }
      const position = positions?.get(product.id);
      const latest = position
        ? await tx.stockCard.findFirst({ where: beforePositionWhere(product.id, position), orderBy: BEFORE_POSITION_ORDER, select: { qtyBalance: true } })
        : await tx.stockCard.findFirst({ where: { productId: product.id },
          orderBy: [{ docDate: "desc" }, { sorder: "desc" }], select: { qtyBalance: true } });
      stocks.set(product.id, latest ? Number(latest.qtyBalance) : 0);
    }
    return stocks;
  } catch (error) {
    console.error("[readCoverageStock]", error);
    throw error;
  }
}

/**
 * Exact received base quantity. PurchaseItem.quantity is Decimal(12,4) and exact since ก5 (it equals
 * showQty x unitScale for every line saved since); rows saved before hold Math.round(showQty x unitScale),
 * so the receipt is still derived from showQty x unitScale whenever both are stored.
 */
function receivedBaseQuantity(source: { quantity: Prisma.Decimal | number; showQty: Prisma.Decimal | null; unitScale: Prisma.Decimal | null }): Prisma.Decimal {
  return source.showQty != null && source.unitScale != null
    ? new Prisma.Decimal(source.showQty).mul(source.unitScale) : new Prisma.Decimal(source.quantity);
}

/**
 * Review V1 (owner decision 2026-09-30, lib/input-vat.ts): DN VAT is input tax, kept out of cost, only when the DN
 * carries VAT and the shop was VAT-registered on the supplier's DN date (debitDate). Decided on the server at every
 * create / edit / repost and stored in vatRecoverable; a DN without VAT never needs the registration setting.
 */
export async function decideDebitVatRecoverable(tx: Tx,
  input: Pick<SupplierDebitNoteInput, "vatType" | "vatRate" | "debitDate">): Promise<boolean> {
  try {
    const registeredFrom = input.vatType === "NO_VAT" ? null : await getVatRegisteredFrom(tx);
    return isInputVatRecoverable({ vatType: input.vatType, vatRate: input.vatRate,
      taxDocumentDate: parseDateOnlyToDate(input.debitDate), registeredFrom });
  } catch (error) {
    console.error("[decideDebitVatRecoverable]", error);
    throw error;
  }
}

/** vatRecoverable comes from decideDebitVatRecoverable (a DN) or the parent DN (an adjustment, V3), never the client. */
export async function prepareDebitLines(tx: Tx, input: SupplierDebitNoteInput, today: Date, vatRecoverable: boolean,
  positions?: DebitStockPositions): Promise<PreparedDebit> {
  try {
    await tx.$queryRaw`SELECT id FROM "Purchase" WHERE id = ${input.purchaseId} FOR UPDATE`;
    const purchase = await tx.purchase.findUnique({ where: { id: input.purchaseId },
      include: { items: { include: { product: true } } },
    });
    if (!purchase || purchase.status !== "ACTIVE" || !purchase.supplierId) throw new Error("ไม่พบใบซื้อที่ใช้งานได้และมี supplier");
    if (purchase.purchaseDate > today) throw new Error("ไม่สามารถอ้างอิงใบซื้อวันที่ในอนาคต");
    assertDebitDates(input, today);
    const ids = input.items.map((item) => item.purchaseItemId);
    if (new Set(ids).size !== ids.length) throw new Error("กรุณารวมส่วนต่างของรายการซื้อเดียวกันไว้ในแถวเดียว");
    const sourceById = new Map(purchase.items.map((item) => [item.id, item]));
    const sourceLines = input.items.map((item) => {
      const source = sourceById.get(item.purchaseItemId);
      if (!source) throw new Error("รายการสินค้าไม่ได้อยู่ในใบซื้อที่อ้างอิง");
      return { item, source };
    });
    await lockDebitProducts(tx, sourceLines.map(({ source }) => source.productId));
    const future = await tx.stockCard.findFirst({ where: {
      productId: { in: sourceLines.map(({ source }) => source.productId) }, docDate: { gt: today },
    }, select: { docNo: true } });
    if (future) throw new Error(`มีสต็อกวันที่ในอนาคต ${future.docNo} กรุณาตรวจสอบก่อนลง DN`);
    const products = await tx.product.findMany({ where: { id: { in: sourceLines.map(({ source }) => source.productId) } },
      select: { id: true, inventoryTracking: true },
    });
    const stocks = await readCoverageStock(tx, products, positions);
    const document = calculateSupplierDebitDocument({ vatType: input.vatType, vatRate: input.vatRate, vatRecoverable,
      lines: sourceLines.map(({ item, source }) => ({ ...item, unitScale: Number(source.unitScale ?? 1) })) });
    const lines = sourceLines.map(({ item, source }, index) => {
      const unitScale = Number(source.unitScale ?? 1);
      const amounts = document.lines[index];
      if (new Prisma.Decimal(amounts.affectedBaseQuantity).gt(receivedBaseQuantity(source))) {
        throw new Error("จำนวนที่ปรับราคาเกินจำนวนรับในรายการเดิม");
      }
      return { ...item, ...amounts, productId: source.productId, unitScale,
        showUnitName: source.showUnitName ?? "หน่วยฐาน", originalUnitPrice: Number(source.showPricePerUnit ?? source.costPrice),
        productCode: source.product.code, productName: source.product.name };
    });
    const allocations = allocateSupplierDebitCoverage(lines, stocks);
    return { purchase, lines: lines.map((line, index) => ({ ...line, ...allocations[index] })) };
  } catch (error) {
    console.error("[prepareDebitLines]", error);
    throw error;
  }
}

/** StockCard detail text of one posted line; adjustments pass their own ("ปรับยอดจาก DN ..."). */
export type DebitLineDetail = (line: PreparedDebitLine) => string;
const defaultDebitLineDetail: DebitLineDetail = (line) =>
  `DN เพิ่มมูลค่า ${line.inventoryAmount.toFixed(2)} / ส่วนต่างต้นทุน ${line.varianceAmount.toFixed(2)}`;

export async function postDebitLines(tx: Tx, debit: { id: string; debitNo: string },
  postingDate: Date, lines: Awaited<ReturnType<typeof prepareDebitLines>>["lines"], positions?: DebitStockPositions,
  describeLine: DebitLineDetail = defaultDebitLineDetail,
): Promise<void> {
  try {
    const epochs = new Map<string, number>();
    for (const [index, line] of lines.entries()) {
      let epoch = epochs.get(line.productId);
      if (epoch === undefined) {
        epoch = positions?.get(line.productId)?.valuationEpoch ?? (await getStockValuationEpoch(tx, line.productId, postingDate)) + 1;
        epochs.set(line.productId, epoch);
      }
      // A repost at the original position snapshots the row just before it (or this DN's earlier line on the SKU).
      const before = positions?.has(line.productId)
        ? await tx.stockCard.findFirst({ where: { productId: line.productId, OR: [
          ...beforePositionWhere(line.productId, { docDate: postingDate, valuationEpoch: epoch }).OR,
          { docDate: postingDate, valuationEpoch: epoch, source: "SUPPLIER_DEBIT", docNo: debit.debitNo },
        ] }, orderBy: BEFORE_POSITION_ORDER, select: { qtyBalance: true, priceBalance: true } })
        : await tx.stockCard.findFirst({ where: { productId: line.productId },
          orderBy: [{ docDate: "desc" }, { sorder: "desc" }], select: { qtyBalance: true, priceBalance: true },
        });
      const { productCode, productName, ...data } = line;
      void productCode; void productName;
      const item = await tx.supplierDebitNoteItem.create({ data: { ...data, debitNoteId: debit.id,
        lineNo: index + 1, stockBefore: before?.qtyBalance ?? 0, avgCostBefore: before?.priceBalance ?? 0, avgCostAfter: 0,
      } });
      const stockCardId = await writeStockCard(tx, { productId: line.productId, docNo: debit.debitNo,
        docDate: postingDate, source: "SUPPLIER_DEBIT", qtyIn: 0, qtyOut: 0, priceIn: 0,
        valuationEpoch: epoch, valueAdjustment: line.inventoryAmount, costVariance: line.varianceAmount,
        referenceId: item.id, detail: describeLine(line),
      });
      const after = await tx.stockCard.findUniqueOrThrow({ where: { id: stockCardId }, select: { priceBalance: true } });
      await tx.supplierDebitNoteItem.update({ where: { id: item.id }, data: { stockCardId, avgCostAfter: after.priceBalance } });
    }
  } catch (error) {
    console.error("[postDebitLines]", error);
    throw error;
  }
}

export type SupplierReferenceLookup = { supplierId: string; supplierReferenceNo: string; excludeId?: string };

/**
 * The supplier's ACTIVE DN whose number has the same normalized key, excluding the DN being edited. Cancelled DNs never
 * match, so their numbers can be reused. Reads only the supplier's ACTIVE DN numbers ([supplierId, status] index).
 */
async function findActiveSupplierReferenceConflict(tx: Tx, lookup: SupplierReferenceLookup): Promise<SupplierReferenceConflict | null> {
  try {
    const key = normalizeSupplierReferenceKey(lookup.supplierReferenceNo);
    const active = await tx.supplierDebitNote.findMany({
      where: { supplierId: lookup.supplierId, status: "ACTIVE", ...(lookup.excludeId ? { id: { not: lookup.excludeId } } : {}) },
      select: { id: true, debitNo: true, supplierReferenceNo: true },
    });
    return active.find((row) => normalizeSupplierReferenceKey(row.supplierReferenceNo) === key) ?? null;
  } catch (error) {
    console.error("[findActiveSupplierReferenceConflict]", error);
    throw error;
  }
}

/** T4 pre-check inside the saving transaction, before any write. */
export async function assertSupplierReferenceAvailable(tx: Tx, lookup: SupplierReferenceLookup): Promise<void> {
  try {
    const existing = await findActiveSupplierReferenceConflict(tx, lookup);
    if (existing) throw new SupplierDebitReferenceConflictError(existing);
  } catch (error) {
    console.error("[assertSupplierReferenceAvailable]", error);
    throw error;
  }
}

/**
 * Safety net for concurrent saves: both can pass the pre-check, then the T4 index rejects the later write with P2002.
 * That transaction is already rolled back, so the committed DN is read in a fresh transaction to name it, giving the
 * pre-check's message. Any other error, including a P2002 of another unique key, is returned unchanged.
 */
export async function toSupplierReferenceConflict(error: unknown, lookup: SupplierReferenceLookup | null): Promise<unknown> {
  if (!isActiveSupplierReferenceViolation(error)) return error;
  if (!lookup) return new SupplierDebitReferenceConflictError(null);
  try {
    return new SupplierDebitReferenceConflictError(await dbTx((tx) => findActiveSupplierReferenceConflict(tx, lookup)));
  } catch (lookupError) {
    console.error("[toSupplierReferenceConflict]", lookupError);
    return new SupplierDebitReferenceConflictError(null);
  }
}

export async function postSupplierDebitNote(rawInput: unknown, actor: Actor,
  options?: SupplierDebitMutationOptions): Promise<{ id: string; debitNo: string }> {
  let referenceLookup: SupplierReferenceLookup | null = null;
  try {
    const input = supplierDebitNoteSchema.parse(rawInput);
    const postingDate = parseDateOnlyToDate(getThailandDateKey());
    const { override, ...debit } = await dbTx(async (tx) => {
      const vatRecoverable = await decideDebitVatRecoverable(tx, input);
      const { purchase, lines } = await prepareDebitLines(tx, input, postingDate, vatRecoverable);
      referenceLookup = { supplierId: purchase.supplierId!, supplierReferenceNo: input.supplierReferenceNo };
      await assertSupplierReferenceAvailable(tx, referenceLookup);
      assertPreviewedAllocation(input, lines);
      // A DN posts today; today's month is locked only when it was already distributed.
      const periodOverride = await assertDebitPeriodsUnlocked(tx, [postingDate], options);
      const debitNo = await generateSupplierDebitNo(tx, postingDate);
      const totals = summarizeDebitLines(lines);
      const created = await tx.supplierDebitNote.create({ data: {
        debitNo, purchaseId: purchase.id, supplierId: purchase.supplierId!, userId: actor.userId,
        supplierReferenceNo: input.supplierReferenceNo, debitDate: parseDateOnlyToDate(input.debitDate),
        receivedDate: parseDateOnlyToDate(input.receivedDate), postingDate, dueDate: parseDateOnlyToDate(input.dueDate),
        reason: input.reason, note: input.note, vatType: input.vatType, vatRate: input.vatRate,
        vatRecoverable, ...totals, amountRemain: totals.netAmount,
      } });
      await postDebitLines(tx, created, postingDate, lines);
      await rebuildSupplierDebitProfitFacts(tx, created.id);
      await writeAuditLogTx(tx, { ...actor, action: AuditAction.CREATE, entityType: "SupplierDebitNote",
        entityId: created.id, entityRef: created.debitNo, after: { ...created, lines }, ...overrideAuditMeta(periodOverride) });
      return { id: created.id, debitNo: created.debitNo, override: periodOverride };
    });
    await notifySupplierDebitNote(debit, "created");
    await notifyDebitPeriodOverride(override, debit, "บันทึกใบเพิ่มหนี้", actor);
    revalidateProfitDashboardCache();
    return debit;
  } catch (error) {
    console.error("[postSupplierDebitNote]", error);
    throw await toSupplierReferenceConflict(error, referenceLookup);
  }
}

/** A locked month as shown on the DN forms ("ตุลาคม 2026" + the distribution document). */
export type SupplierDebitLockedPeriod = { periodKey: string; label: string; distributionNo: string };
export const toSupplierDebitLockedPeriods = (periods: LockedPeriod[]): SupplierDebitLockedPeriod[] =>
  periods.map((period) => ({ periodKey: period.periodKey, label: formatPeriodKeyLabel(period.periodKey), distributionNo: period.distributionNo }));

export type SupplierDebitPreview = {
  subtotalAmount: number; vatAmount: number; netAmount: number; inventoryAmount: number; varianceAmount: number;
  /** Edit only: later sales whose cost this edit restates, and the distributed months it touches. */
  restatement?: { saleCount: number; delta: number };
  lockedPeriods?: SupplierDebitLockedPeriod[];
};

/**
 * The DN's original position per SKU (from its posted value-only rows). A SKU the edit adds takes the
 * original posting date after that SKU's existing rows of the day, like a DN posted on that date.
 */
async function resolveDebitPositions(tx: Tx, debit: { debitNo: string; postingDate: Date },
  productIds: readonly string[]): Promise<Map<string, DebitStockPosition>> {
  try {
    const rows = await tx.stockCard.findMany({ where: { docNo: debit.debitNo, source: "SUPPLIER_DEBIT" },
      select: { productId: true, docDate: true, valuationEpoch: true } });
    const positions = new Map<string, DebitStockPosition>();
    for (const row of rows) {
      const current = positions.get(row.productId);
      if (!current || row.valuationEpoch < current.valuationEpoch) {
        positions.set(row.productId, { docDate: row.docDate, valuationEpoch: row.valuationEpoch });
      }
    }
    for (const productId of new Set(productIds)) {
      if (positions.has(productId)) continue;
      positions.set(productId, { docDate: debit.postingDate,
        valuationEpoch: (await getStockValuationEpoch(tx, productId, debit.postingDate)) + 1 });
    }
    return positions;
  } catch (error) {
    console.error("[resolveDebitPositions]", error);
    throw error;
  }
}

const toReplacementRows = (lines: PreparedDebitLine[], positions: DebitStockPositions): DebitReplacementRow[] =>
  lines.flatMap((line) => {
    const position = positions.get(line.productId);
    return position ? [{ productId: line.productId, docDate: position.docDate, valuationEpoch: position.valuationEpoch,
      valueAdjustment: line.inventoryAmount }] : [];
  });

async function editedProductIds(tx: Tx, purchaseId: string, input: SupplierDebitNoteInput): Promise<string[]> {
  const sources = await tx.purchaseItem.findMany({ where: { purchaseId, id: { in: input.items.map((item) => item.purchaseItemId) } },
    select: { productId: true } });
  return sources.map((source) => source.productId);
}

/**
 * Totals and allocation for the form's "ตรวจยอด". With `debitId` (edit) coverage is taken at the DN's
 * original position, and the preview also reports the sales the edit would restate and any
 * distributed month it touches, so the form can ask an owner for the override reason up front.
 */
export async function previewSupplierDebitNote(rawInput: unknown, options?: { debitId?: string }): Promise<SupplierDebitPreview> {
  try {
    const input = supplierDebitNoteSchema.parse(rawInput);
    const today = parseDateOnlyToDate(getThailandDateKey());
    return await dbTx(async (tx) => {
      if (!options?.debitId) {
        return summarizeDebitLines((await prepareDebitLines(tx, input, today, await decideDebitVatRecoverable(tx, input))).lines);
      }
      const current = await tx.supplierDebitNote.findUnique({ where: { id: options.debitId }, include: { items: true } });
      if (!current || current.status !== "ACTIVE") throw new Error("แก้ไขได้เฉพาะ DN ที่ใช้งานอยู่");
      if (current.adjustsDebitNoteId) throw new Error(SUPPLIER_DEBIT_ADJUSTMENT_EDIT_MESSAGE);
      if (current.purchaseId !== input.purchaseId) throw new Error("ไม่สามารถเปลี่ยนใบซื้ออ้างอิงของ DN ได้ กรุณายกเลิกแล้วบันทึกใหม่");
      const productIds = [...current.items.map((item) => item.productId), ...await editedProductIds(tx, current.purchaseId, input)];
      const positions = await resolveDebitPositions(tx, current, productIds);
      const vatRecoverable = await resolveEditedDebitVatRecoverable(tx, current, input);
      const { lines } = await prepareDebitLines(tx, input, today, vatRecoverable, positions);
      const plan = await planSaleCostRestatement(tx, { productIds, debitNo: current.debitNo, replacements: toReplacementRows(lines, positions) });
      const summary = summarizeSaleCostRestatement(plan);
      const locked = await findLockedPeriods(tx, [current.postingDate, ...restatementDates(plan)]);
      return { ...summarizeDebitLines(lines), restatement: { saleCount: summary.saleCount, delta: summary.delta },
        lockedPeriods: toSupplierDebitLockedPeriods(locked) };
    });
  } catch (error) {
    // An incomplete form (e.g. no reason) is a user error the action already turns into a Thai message.
    if (!(error instanceof ZodError)) console.error("[previewSupplierDebitNote]", error);
    throw error;
  }
}

/**
 * What cancelling the DN would restate and which distributed months it touches (read-only, for the
 * detail page). Only months from the DN's posting month on can be touched, so a cheap check of
 * those declarations skips the replay when none exists.
 */
export async function previewSupplierDebitCancel(id: string): Promise<{
  restatement: { saleCount: number; delta: number }; lockedPeriods: SupplierDebitLockedPeriod[];
}> {
  try {
    return await dbTx(async (tx) => {
      const current = await tx.supplierDebitNote.findUnique({ where: { id }, include: { items: true } });
      const none = { restatement: { saleCount: 0, delta: 0 }, lockedPeriods: [] };
      if (!current || current.status !== "ACTIVE") return none;
      const declared = await tx.profitDistribution.findFirst({ where: { status: "ACTIVE",
        activePeriodKey: { gte: getThailandMonthKey(current.postingDate) } }, select: { id: true } });
      if (!declared) return none;
      const plan = await planSaleCostRestatement(tx, { productIds: current.items.map((item) => item.productId),
        debitNo: current.debitNo, replacements: [] });
      const summary = summarizeSaleCostRestatement(plan);
      const locked = await findLockedPeriods(tx, [current.postingDate, ...restatementDates(plan)]);
      return { restatement: { saleCount: summary.saleCount, delta: summary.delta }, lockedPeriods: toSupplierDebitLockedPeriods(locked) };
    });
  } catch (error) {
    console.error("[previewSupplierDebitCancel]", error);
    throw error;
  }
}

type DebitWithItems = Prisma.SupplierDebitNoteGetPayload<{ include: { items: true } }>;
type DebitHeaderData = Pick<Prisma.SupplierDebitNoteUncheckedUpdateInput,
  "supplierReferenceNo" | "debitDate" | "receivedDate" | "dueDate" | "reason" | "note">;

/**
 * R1 (2026-09-30): a purchase edit may delete a purchase line that only a CANCELLED DN still references.
 * The FK (ON DELETE SET NULL) then clears SupplierDebitNoteItem.purchaseItemId, and the DN line keeps its
 * own product/unit/original-price snapshot. An ACTIVE DN always keeps the link because the purchase is
 * locked while the DN is active; an edit or repost that meets a cleared link is rejected, never guessed.
 */
/** An adjustment ("ปรับยอด DN") is never edited in place: cancel it and key a new one (R5-D). */
export const SUPPLIER_DEBIT_ADJUSTMENT_EDIT_MESSAGE =
  "เอกสารปรับยอด DN แก้ไขไม่ได้ · หากยอดไม่ถูกต้องให้ยกเลิกเอกสารนี้แล้วบันทึกปรับยอดใหม่";
export const SUPPLIER_DEBIT_UNLINKED_LINE_NOTE = "บรรทัดใบซื้อต้นทางถูกแก้ไขแล้ว · แสดงสินค้า หน่วย และราคาเดิมตามที่บันทึกใน DN";
export const SUPPLIER_DEBIT_UNLINKED_EDIT_MESSAGE = "แก้ไข DN นี้ไม่ได้: บรรทัดใบซื้อต้นทางบางรายการถูกแก้ไขแล้ว ไม่พบรายการเดิมให้อ้างอิง";
export const isLinkedSupplierDebitLine = <T extends { purchaseItemId: string | null }>(line: T): line is T & { purchaseItemId: string } =>
  line.purchaseItemId !== null;
function assertSupplierDebitLinesLinked(lines: ReadonlyArray<{ purchaseItemId: string | null }>): void {
  if (!lines.every(isLinkedSupplierDebitLine)) throw new Error(SUPPLIER_DEBIT_UNLINKED_EDIT_MESSAGE);
}

/**
 * Header date policy (owner decision 2026-09-30, after SAP/BC/Odoo practice). supplierReferenceNo, reason
 * and note stay editable while the DN is ACTIVE. dueDate needs an outstanding balance (amountRemain > 0).
 * debitDate and receivedDate (the AP aging date) also need the DN's posting month to be undeclared: an
 * ACTIVE ProfitDistribution for the Thailand month of postingDate locks them. The server check and the
 * edit form's disabled reasons both come from getSupplierDebitHeaderLocks.
 */
const SUPPLIER_DEBIT_DATE_LOCK_PREFIX = {
  debitDate: "แก้ไขวันที่ออก DN ไม่ได้", receivedDate: "แก้ไขวันที่ได้รับไม่ได้", dueDate: "แก้ไขวันครบกำหนดชำระไม่ได้",
} as const;
export type SupplierDebitDateField = keyof typeof SUPPLIER_DEBIT_DATE_LOCK_PREFIX;
const SUPPLIER_DEBIT_DATE_FIELDS: readonly SupplierDebitDateField[] = ["debitDate", "receivedDate", "dueDate"];
/** A null entry means the date may change; otherwise the Thai reason, naming the field. */
export type SupplierDebitHeaderLocks = Record<SupplierDebitDateField, string | null>;
export type SupplierDebitHeaderLockState = {
  amountRemain: number;
  /** The ACTIVE ProfitDistribution of the DN's posting month, when that month is declared. */
  declaredPeriod: { label: string; distributionNo: string } | null;
};
/** "ตุลาคม 2026": day: undefined drops formatDateThai's default day part. */
const THAI_MONTH_LABEL_FORMAT: Intl.DateTimeFormatOptions = { day: undefined, month: "long", year: "numeric" };

export function getSupplierDebitHeaderLocks(state: SupplierDebitHeaderLockState): SupplierDebitHeaderLocks {
  const settled = state.amountRemain > 0 ? null : "DN นี้ชำระครบแล้ว ไม่มียอดค้างจ่าย";
  const declared = state.declaredPeriod
    ? `งวด ${state.declaredPeriod.label} ซึ่งเป็นเดือนที่ลงต้นทุน DN นี้ ประกาศแบ่งกำไรแล้ว (${state.declaredPeriod.distributionNo})` : null;
  const lock = (field: SupplierDebitDateField, reason: string | null): string | null =>
    reason ? `${SUPPLIER_DEBIT_DATE_LOCK_PREFIX[field]}: ${reason}` : null;
  return { debitDate: lock("debitDate", settled ?? declared), receivedDate: lock("receivedDate", settled ?? declared),
    dueDate: lock("dueDate", settled) };
}

/** Header locks plus the declared posting month they came from (the shared month lock, lib/period-lock.ts). */
async function readSupplierDebitHeaderLockState(client: Tx,
  debit: { amountRemain: Prisma.Decimal | number; postingDate: Date }): Promise<{ locks: SupplierDebitHeaderLocks; declared: LockedPeriod[] }> {
  const amountRemain = Number(debit.amountRemain);
  const declared = amountRemain > 0 ? await findLockedPeriods(client, [debit.postingDate]) : [];
  const locks = getSupplierDebitHeaderLocks({ amountRemain, declaredPeriod: declared[0]
    ? { label: formatDateThai(debit.postingDate, THAI_MONTH_LABEL_FORMAT), distributionNo: declared[0].distributionNo } : null });
  return { locks, declared };
}

/**
 * Takes a transaction client (the shared month lock holds a shared advisory lock until commit).
 * A settled DN locks every date, so the period is read only while open.
 */
export async function getSupplierDebitHeaderLocksForDebit(client: Tx,
  debit: { amountRemain: Prisma.Decimal | number; postingDate: Date }): Promise<SupplierDebitHeaderLocks> {
  try {
    return (await readSupplierDebitHeaderLockState(client, debit)).locks;
  } catch (error) {
    console.error("[getSupplierDebitHeaderLocksForDebit]", error);
    throw error;
  }
}

/**
 * Header locks for the edit form, read in a short transaction (the month lock takes a shared advisory lock).
 * A user holding the override permission may change the debit/received dates of a distributed posting month
 * with a reason, so those inputs stay enabled and headerPeriods tells the form to ask for it; the settled
 * rule always holds.
 */
export async function getSupplierDebitEditLocks(debit: { amountRemain: Prisma.Decimal | number; postingDate: Date },
  canOverride: boolean): Promise<{ headerLocks: SupplierDebitHeaderLocks; headerPeriods: SupplierDebitLockedPeriod[] }> {
  try {
    return await dbTx(async (tx) => {
      const { locks, declared } = await readSupplierDebitHeaderLockState(tx, debit);
      const overridable = canOverride && declared.length > 0 && Number(debit.amountRemain) > 0;
      return { headerLocks: overridable ? { ...locks, debitDate: null, receivedDate: null } : locks,
        headerPeriods: toSupplierDebitLockedPeriods(declared) };
    });
  } catch (error) {
    console.error("[getSupplierDebitEditLocks]", error);
    throw error;
  }
}

/**
 * Rejects a changed header date that the policy locks, before any write. An unchanged date always passes.
 * The settled-balance rule is a field rule and always holds; a declared posting month is the month lock,
 * which an owner override with a reason may pass (returned for the audit and alert).
 */
async function assertHeaderDatesEditable(tx: Tx, current: DebitWithItems, input: SupplierDebitNoteInput,
  options?: SupplierDebitMutationOptions): Promise<PeriodLockOverrideRecord | null> {
  try {
    const changed = SUPPLIER_DEBIT_DATE_FIELDS.filter((field) => formatDateOnlyForInput(current[field]) !== input[field]);
    if (changed.length === 0) return null;
    const { locks, declared } = await readSupplierDebitHeaderLockState(tx, current);
    const blocked = changed.map((field) => locks[field]).find((reason) => reason !== null);
    if (!blocked) return null;
    const reason = normalizeOverrideReason(options?.periodLockOverride?.reason);
    if (Number(current.amountRemain) > 0 && declared.length > 0) {
      if (options?.periodLockOverride?.allowed && reason) return { reason, periods: declared };
      throw new PeriodLockedError(blocked, declared);
    }
    throw new Error(blocked);
  } catch (error) {
    console.error("[assertHeaderDatesEditable]", error);
    throw error;
  }
}

/**
 * True when VAT settings and every line match the posted DN, so only header fields changed.
 * Recoverability is decided by the server (resolveEditedDebitVatRecoverable), never client input, so the caller
 * compares it separately. A line whose source link was cleared (R1) never matches.
 */
export function isSameSupplierDebitPosting(current: DebitWithItems, input: SupplierDebitNoteInput): boolean {
  if (current.vatType !== input.vatType || Number(current.vatRate) !== input.vatRate ||
    current.items.length !== input.items.length) return false;
  const postedBySource = new Map(current.items.filter(isLinkedSupplierDebitLine).map((line) => [line.purchaseItemId, line]));
  return input.items.every((next) => {
    const posted = postedBySource.get(next.purchaseItemId);
    return Boolean(posted) && posted!.amountMode === next.amountMode &&
      Number(posted!.increaseAmount) === next.increaseAmount && Number(posted!.affectedQuantity) === next.affectedQuantity;
  });
}

/**
 * Recoverability of an edited DN (V1). The stored vatRecoverable is kept (a DN is never reposted automatically) until
 * the edit changes what decides it: the lines or VAT, or the supplier's DN date. Then the server decides it again, and
 * a DN-date change that flips it reposts the DN like a line edit (later sales are restated).
 */
export async function resolveEditedDebitVatRecoverable(tx: Tx, current: DebitWithItems,
  input: SupplierDebitNoteInput): Promise<boolean> {
  try {
    const unchanged = isSameSupplierDebitPosting(current, input) && formatDateOnlyForInput(current.debitDate) === input.debitDate;
    return unchanged ? current.vatRecoverable : await decideDebitVatRecoverable(tx, input);
  } catch (error) {
    console.error("[resolveEditedDebitVatRecoverable]", error);
    throw error;
  }
}

export async function getSupplierDebitRepostReason(tx: Tx, id: string): Promise<string | null> {
  try {
    return buildMutationBlockMessage(await createDocumentMutationGuard(tx as unknown as GuardDb).check("SupplierDebitNote", id, "update"));
  } catch (error) {
    console.error("[getSupplierDebitRepostReason]", error);
    throw error;
  }
}

const formatBaht = (value: number): string => value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** An edit may not bring the DN below what active payments already settled on it (paid = net - amountRemain). */
export const buildSupplierDebitBelowPaidMessage = (netAmount: number, paid: number): string =>
  `ยอด DN ใหม่ ${formatBaht(netAmount)} บาท ต่ำกว่ายอดที่จ่ายชำระแล้ว ${formatBaht(paid)} บาท ` +
  "กรุณายกเลิกหรือแก้เอกสารจ่ายชำระก่อน หรือแก้ยอดไม่ให้ต่ำกว่ายอดที่จ่ายแล้ว";

type RepostResult = {
  lines: PreparedDebitLine[]; netAmount: number; restatement: SaleCostRestatementSummary; override: PeriodLockOverrideRecord | null;
};

/**
 * Reverse the posted value-only stock rows and repost the edited lines under the same DN number at the DN's ORIGINAL
 * posting date and same-day position (valuation epoch), with coverage = the on-hand quantity at that position
 * (owner approved 2026-09-30, T1). Later sales on the SKUs are restated (lib/sale-cost-restatement.ts).
 *
 * Validation, the payment rule, the restatement plan and the month lock (DN month plus every restated document's
 * month) all run before any write. Value-only rows never change quantity, so coverage read before the reversal equals
 * coverage after it. Only SKUs dropped by the edit are replayed by recalculateStockCardMany; a retained SKU is replayed
 * in full by writeStockCard(SUPPLIER_DEBIT) when its new row is inserted, after the restated return costs are written.
 */
async function repostSupplierDebitNote(tx: Tx, current: DebitWithItems, input: SupplierDebitNoteInput,
  today: Date, header: DebitHeaderData, vatRecoverable: boolean, options?: SupplierDebitMutationOptions): Promise<RepostResult> {
  try {
    assertSupplierDebitLinesLinked(current.items);
    await tx.$queryRaw`SELECT id FROM "Purchase" WHERE id = ${current.purchaseId} FOR UPDATE`;
    const postedProductIds = current.items.map((item) => item.productId);
    const productIds = [...new Set([...postedProductIds, ...await editedProductIds(tx, current.purchaseId, input)])];
    await lockDebitProducts(tx, productIds);
    const reason = await getSupplierDebitRepostReason(tx, current.id);
    if (reason) throw new Error(reason);
    const positions = await resolveDebitPositions(tx, current, productIds);
    const { lines } = await prepareDebitLines(tx, input, today, vatRecoverable, positions);
    assertPreviewedAllocation(input, lines);
    const totals = summarizeDebitLines(lines);
    const paid = new Prisma.Decimal(current.netAmount).minus(current.amountRemain);
    if (paid.gt(totals.netAmount)) throw new Error(buildSupplierDebitBelowPaidMessage(totals.netAmount, paid.toNumber()));
    const plan = await planSaleCostRestatement(tx, { productIds, debitNo: current.debitNo, replacements: toReplacementRows(lines, positions) });
    const override = await assertDebitPeriodsUnlocked(tx, [current.postingDate, ...restatementDates(plan)], options);
    await tx.stockCard.deleteMany({ where: { docNo: current.debitNo, source: "SUPPLIER_DEBIT" } });
    await tx.supplierDebitNoteItem.deleteMany({ where: { debitNoteId: current.id } });
    await applyRestatedReturnCosts(tx, plan);
    const repostedProductIds = new Set(lines.map((line) => line.productId));
    await recalculateStockCardMany(tx, postedProductIds.filter((productId) => !repostedProductIds.has(productId)));
    await tx.supplierDebitNote.update({ where: { id: current.id }, data: { ...header,
      vatType: input.vatType, vatRate: input.vatRate, vatRecoverable, ...totals } });
    await postDebitLines(tx, current, current.postingDate, lines, positions);
    await recalculateSupplierDebitRemain(tx, current.id);
    await applyRestatedSaleCosts(tx, plan);
    await rebuildSupplierDebitProfitFacts(tx, current.id);
    return { lines, netAmount: totals.netAmount, restatement: summarizeSaleCostRestatement(plan), override };
  } catch (error) {
    console.error("[repostSupplierDebitNote]", error);
    throw error;
  }
}

/** What the DN alert shows about restated sales. */
type RestatementNotice = { saleCount: number; delta: number };
const toRestatementNotice = (summary: SaleCostRestatementSummary | undefined): RestatementNotice | undefined =>
  summary && summary.saleCount > 0 ? { saleCount: summary.saleCount, delta: summary.delta } : undefined;

/**
 * Header fields may change while the DN is ACTIVE, within the date policy of getSupplierDebitHeaderLocks
 * (checked for every save, before any write). VAT or line changes, and a DN-date change that flips VAT recoverability
 * (V1), repost the DN at its original position and
 * restate later sales; they are allowed with later stock movements and with payments, as long as the new net
 * amount stays at or above the amount already paid. A changed supplier DN number must not match another ACTIVE
 * DN of the same supplier (T4, normalizeSupplierReferenceKey). Distributed months need the owner override.
 */
export async function updateSupplierDebitNote(id: string, rawInput: unknown, actor: Actor,
  options?: SupplierDebitMutationOptions): Promise<{ id: string; debitNo: string; reposted: boolean }> {
  let referenceLookup: SupplierReferenceLookup | null = null;
  try {
    const parsedId = z.string().min(1).parse(id);
    const input = supplierDebitNoteUpdateSchema.parse(rawInput);
    const today = parseDateOnlyToDate(getThailandDateKey());
    const { amountChange, restatement, override, ...result } = await dbTx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "SupplierDebitNote" WHERE id = ${parsedId} FOR UPDATE`;
      const current = await tx.supplierDebitNote.findUnique({ where: { id: parsedId }, include: { items: true } });
      if (!current || current.status !== "ACTIVE") throw new Error("แก้ไขได้เฉพาะ DN ที่ใช้งานอยู่");
      if (current.adjustsDebitNoteId) throw new Error(SUPPLIER_DEBIT_ADJUSTMENT_EDIT_MESSAGE);
      if (current.updatedAt.getTime() !== Date.parse(input.expectedUpdatedAt)) throw new SupplierDebitStaleError();
      if (current.purchaseId !== input.purchaseId) throw new Error("ไม่สามารถเปลี่ยนใบซื้ออ้างอิงของ DN ได้ กรุณายกเลิกแล้วบันทึกใหม่");
      assertSupplierDebitLinesLinked(current.items);
      const headerOverride = await assertHeaderDatesEditable(tx, current, input, options);
      assertDebitDates(input, today);
      if (input.supplierReferenceNo !== current.supplierReferenceNo) {
        referenceLookup = { supplierId: current.supplierId, supplierReferenceNo: input.supplierReferenceNo, excludeId: parsedId };
        await assertSupplierReferenceAvailable(tx, referenceLookup);
      }
      const header: DebitHeaderData = { supplierReferenceNo: input.supplierReferenceNo,
        debitDate: parseDateOnlyToDate(input.debitDate), receivedDate: parseDateOnlyToDate(input.receivedDate),
        dueDate: parseDateOnlyToDate(input.dueDate), reason: input.reason, note: input.note };
      // V1: a DN-date change that flips VAT recoverability changes cost, so it reposts like a line or VAT edit.
      const vatRecoverable = await resolveEditedDebitVatRecoverable(tx, current, input);
      const reposted = !isSameSupplierDebitPosting(current, input) || vatRecoverable !== current.vatRecoverable;
      const repost = reposted ? await repostSupplierDebitNote(tx, current, input, today, header, vatRecoverable, options) : null;
      if (!reposted) await tx.supplierDebitNote.update({ where: { id: parsedId }, data: header });
      const periodOverride = mergeOverrides(headerOverride, repost?.override ?? null);
      const after = await tx.supplierDebitNote.findUnique({ where: { id: parsedId }, include: { items: true } });
      await writeAuditLogTx(tx, { ...actor, action: AuditAction.UPDATE, entityType: "SupplierDebitNote",
        entityId: parsedId, entityRef: current.debitNo, before: current,
        after: { ...after, reposted, ...(repost ? { lines: repost.lines, restatement: repost.restatement } : {}) },
        ...overrideAuditMeta(periodOverride) });
      return { id: parsedId, debitNo: current.debitNo, reposted, override: periodOverride, restatement: repost?.restatement,
        amountChange: repost ? { before: Number(current.netAmount), after: repost.netAmount } : undefined };
    });
    await notifySupplierDebitNote({ ...result, amountChange, restatement: toRestatementNotice(restatement) }, "updated");
    await notifyDebitPeriodOverride(override, result, "แก้ไขใบเพิ่มหนี้", actor);
    if (result.reposted) revalidateProfitDashboardCache();
    return result;
  } catch (error) {
    console.error("[updateSupplierDebitNote]", error);
    throw await toSupplierReferenceConflict(error, referenceLookup);
  }
}

/**
 * Outstanding balance after a payment or DN change. With "ปรับยอด DN" adjustments the parent and its negative
 * adjustments are recomputed together (lib/supplier-debit-balance.ts); a DN without adjustments keeps
 * amountRemain = net - active payments.
 */
export async function recalculateSupplierDebitRemain(tx: Tx, debitNoteId: string): Promise<void> {
  try {
    await recalculateSupplierDebitBalance(tx, debitNoteId);
  } catch (error) {
    console.error("[recalculateSupplierDebitRemain]", error);
    throw error;
  }
}

export async function getSupplierDebitCancelReason(tx: Tx, id: string): Promise<string | null> {
  try {
    const debit = await tx.supplierDebitNote.findUnique({ where: { id }, select: { status: true } });
    if (!debit || debit.status !== "ACTIVE") return "ไม่พบ DN ที่ใช้งานได้";
    return buildMutationBlockMessage(await createDocumentMutationGuard(tx as unknown as GuardDb).check("SupplierDebitNote", id, "cancel"));
  } catch (error) {
    console.error("[getSupplierDebitCancelReason]", error);
    throw error;
  }
}

/**
 * An adjustment ("ปรับยอด DN") locks its parent too, parent and adjustment in id order: every change to a DN family
 * (payment, adjustment create/cancel, parent cancel/edit) holds the parent's row lock. Returns the parent's DN number.
 */
async function lockDebitForCancel(tx: Tx, id: string): Promise<{ parentId: string; parentDebitNo: string } | null> {
  try {
    const link = await tx.supplierDebitNote.findUnique({ where: { id },
      select: { adjustsDebitNoteId: true, adjustsDebitNote: { select: { debitNo: true } } } });
    if (!link?.adjustsDebitNoteId) {
      await tx.$queryRaw`SELECT id FROM "SupplierDebitNote" WHERE id = ${id} FOR UPDATE`;
      return null;
    }
    const ids = [id, link.adjustsDebitNoteId].sort();
    await tx.$queryRaw`SELECT id FROM "SupplierDebitNote" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
    return { parentId: link.adjustsDebitNoteId, parentDebitNo: link.adjustsDebitNote?.debitNo ?? "" };
  } catch (error) {
    console.error("[lockDebitForCancel]", error);
    throw error;
  }
}

/**
 * Cancel reverses the DN's value-only rows, replays its SKUs and restates the cost of every later sale (and the
 * cost reversal of their RETURN credit notes) to the valuation without the DN (T1, owner approved 2026-09-30).
 * Later stock movements no longer block it; an ACTIVE payment (for an adjustment: one that consumed its credit) or
 * an ACTIVE adjustment of this DN still does. The DN month and every restated document's month are checked against
 * the month lock before any write. Cancelling an adjustment also reverses its cash refund and gives the parent back
 * the outstanding balance the adjustment had reduced.
 */
export async function cancelSupplierDebitNote(id: string, cancelNote: string, actor: Actor,
  options?: SupplierDebitMutationOptions): Promise<void> {
  try {
    const parsedId = z.string().min(1).parse(id);
    const parsedNote = z.string().trim().min(1, "กรุณาระบุเหตุผลยกเลิก").max(1000).parse(cancelNote);
    const { override, restatement, adjustment, ...debit } = await dbTx(async (tx) => {
      const parent = await lockDebitForCancel(tx, parsedId);
      const current = await tx.supplierDebitNote.findUniqueOrThrow({ where: { id: parsedId }, include: { items: true } });
      const productIds = current.items.map((item) => item.productId);
      await lockDebitProducts(tx, productIds);
      const reason = await getSupplierDebitCancelReason(tx, parsedId);
      if (reason) throw new Error(reason);
      const plan: SaleCostRestatementPlan = await planSaleCostRestatement(tx, { productIds, debitNo: current.debitNo, replacements: [] });
      const periodOverride = await assertDebitPeriodsUnlocked(tx, [current.postingDate, ...restatementDates(plan)], options);
      await tx.stockCard.deleteMany({ where: { docNo: current.debitNo, source: "SUPPLIER_DEBIT" } });
      await applyRestatedReturnCosts(tx, plan);
      await recalculateStockCardMany(tx, productIds);
      await applyRestatedSaleCosts(tx, plan);
      await tx.factProfit.updateMany({ where: { sourceType: "PURCHASE_COST_VARIANCE", sourceId: parsedId, isActive: true },
        data: { isActive: false, supersededAt: new Date(), sourceStatus: "CANCELLED" } });
      if (parent) await clearSupplierDebitRefund(tx, parsedId);
      await tx.supplierDebitNote.update({ where: { id: parsedId }, data: {
        status: "CANCELLED", cancelledAt: new Date(), cancelNote: parsedNote, amountRemain: 0,
      } });
      if (parent) await recalculateSupplierDebitBalance(tx, parent.parentId);
      const summary = summarizeSaleCostRestatement(plan);
      await writeAuditLogTx(tx, { ...actor, action: AuditAction.CANCEL, entityType: "SupplierDebitNote",
        entityId: parsedId, entityRef: current.debitNo, before: current,
        after: { status: "CANCELLED", cancelNote: parsedNote, amountRemain: 0, restatement: summary,
          ...(parent ? { adjusts: { id: parent.parentId, debitNo: parent.parentDebitNo }, refundReversed: current.excessSettlementType === "CASH_REFUND" } : {}) },
        ...overrideAuditMeta(periodOverride) });
      return { id: parsedId, debitNo: current.debitNo, override: periodOverride, restatement: summary,
        adjustment: parent ? { parentDebitNo: parent.parentDebitNo, netAmount: Number(current.netAmount) } : undefined };
    });
    await notifySupplierDebitNote({ ...debit, adjustment, restatement: toRestatementNotice(restatement) }, "cancelled");
    await notifyDebitPeriodOverride(override, debit, "ยกเลิกใบเพิ่มหนี้", actor);
    revalidateProfitDashboardCache();
  } catch (error) {
    console.error("[cancelSupplierDebitNote]", error);
    throw error;
  }
}
