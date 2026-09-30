import { z } from "zod";
import { dbTx } from "@/lib/db";
import { AuditAction, Prisma, PurchaseReturnSettlementType, type PurchaseReturnRefundMethod } from "@/lib/generated/prisma";
import { getThailandDateKey, isDateOnlyString, parseDateOnlyToDate } from "@/lib/th-date";
import { generateSupplierDebitNo } from "@/lib/doc-number";
import { writeAuditLogTx } from "@/lib/audit-log";
import { notifySupplierDebitNote } from "@/lib/notifications";
import { rebuildSupplierDebitProfitFacts } from "@/lib/profit-fact";
import { revalidateProfitDashboardCache } from "@/lib/profit-cache";
import { findLockedPeriods } from "@/lib/period-lock";
import {
  assertDebitPeriodsUnlocked, assertSupplierReferenceAvailable, notifyDebitPeriodOverride, overrideAuditMeta, postDebitLines,
  prepareDebitLines, summarizeDebitLines, SupplierDebitPreviewRequiredError, toSupplierDebitLockedPeriods,
  toSupplierReferenceConflict, type PreparedDebitLine, type SupplierDebitActor, type SupplierDebitLockedPeriod,
  type SupplierDebitMutationOptions, type SupplierDebitNoteInput, type SupplierReferenceLookup,
} from "@/lib/supplier-debit-note";
import {
  formatSupplierDebitAdjustmentLabel, postSupplierDebitRefund, recalculateSupplierDebitBalance,
  resolveSupplierDebitRefundMethod, splitDebitAdjustmentReduction,
} from "@/lib/supplier-debit-balance";

/**
 * "ปรับยอด DN" (owner approved 2026-09-30: R5-D, T1, ก3). An ACTIVE DN whose amount must change but cannot be edited
 * in place (its month is distributed, or the new amount would fall below what was paid) is corrected by an adjustment
 * DN dated TODAY that references it. The parent never changes except its outstanding balance.
 *
 * Lines reference the parent DN's purchase lines with SIGNED deltas (all lines of one adjustment share one sign):
 * - positive: posts like a DN today (coverage = current on-hand) and is its own payable;
 * - negative: a negative value-only row today; the covered part reduces inventory value (never below zero: the T3
 *   residual clamp of lib/stock-card.ts writes off what would go negative), the rest is negative purchase cost
 *   variance. It first reduces the parent's outstanding balance; the excess is kept as supplier credit or refunded in
 *   cash (lib/supplier-debit-balance.ts). A reduction may not exceed what the parent and its earlier adjustments
 *   charged on that purchase line.
 */

const MAX_MONEY = 99_999_999.99;
const MAX_ADJUSTMENT_ITEMS = 100;
const MAX_QUANTITY_DECIMALS = 4;
const MONEY_DECIMALS = 2;
const dateSchema = z.string().refine(isDateOnlyString, "วันที่ไม่ถูกต้อง");
const signedMoney = z.number().finite()
  .refine((value) => value !== 0, "ส่วนต่างต้องไม่เป็น 0")
  .refine((value) => Math.abs(value) <= MAX_MONEY, "จำนวนเงินเกินขอบเขตที่ระบบรองรับ")
  .refine((value) => new Prisma.Decimal(value).decimalPlaces() <= MONEY_DECIMALS, "จำนวนเงินต้องไม่เกิน 2 ทศนิยม");
const positiveQuantity = z.number().finite().positive()
  .refine((value) => new Prisma.Decimal(value).decimalPlaces() <= MAX_QUANTITY_DECIMALS, "จำนวนที่ปรับต้องไม่เกิน 4 ทศนิยม");
const signedPreviewAmount = z.number().finite().optional();

// V3: vatType and vatRate must equal the parent DN's (assertInheritsParentVat); vatRecoverable is the parent's stored value
// and never client input (Zod strips it).
export const supplierDebitAdjustmentSchema = z.object({
  parentId: z.string().min(1),
  supplierReferenceNo: z.string().trim().min(1, "กรุณาระบุเลขที่เอกสารของซัพพลายเออร์").max(100),
  debitDate: dateSchema, receivedDate: dateSchema, dueDate: dateSchema,
  reason: z.string().trim().min(1, "กรุณาระบุเหตุผลปรับยอด").max(1000), note: z.string().trim().max(2000).default(""),
  vatType: z.enum(["NO_VAT", "EXCLUDING_VAT", "INCLUDING_VAT"]),
  vatRate: z.number().finite().min(0).max(100)
    .refine((value) => new Prisma.Decimal(value).decimalPlaces() <= MONEY_DECIMALS, "อัตรา VAT ต้องไม่เกิน 2 ทศนิยม"),
  items: z.array(z.object({ purchaseItemId: z.string().min(1), affectedQuantity: positiveQuantity,
    amountMode: z.enum(["PER_UNIT", "TOTAL"]), increaseAmount: signedMoney })).min(1).max(MAX_ADJUSTMENT_ITEMS),
  excessSettlementType: z.enum(["SUPPLIER_CREDIT", "CASH_REFUND"]).optional(),
  cashBankAccountId: z.string().trim().max(50).optional(),
  expectedInventoryAmount: signedPreviewAmount, expectedVarianceAmount: signedPreviewAmount,
  expectedExcessAmount: z.number().finite().nonnegative().optional(),
});
export type SupplierDebitAdjustmentInput = z.infer<typeof supplierDebitAdjustmentSchema>;
export type SupplierDebitAdjustmentDirection = "INCREASE" | "DECREASE";

export type SupplierDebitAdjustmentPreview = {
  direction: SupplierDebitAdjustmentDirection;
  subtotalAmount: number; vatAmount: number; netAmount: number; inventoryAmount: number; varianceAmount: number;
  /** Parent outstanding before this adjustment, the part a reduction takes from it, and what is left over. */
  parentRemain: number; appliedToParent: number; excessAmount: number;
  lockedPeriods: SupplierDebitLockedPeriod[];
};

type Tx = Prisma.TransactionClient;
const MIXED_SIGN_MESSAGE = "เอกสารปรับยอดหนึ่งใบต้องเป็นการเพิ่มยอดทั้งหมดหรือลดยอดทั้งหมด กรุณาแยกเป็นคนละเอกสาร";
const NOT_ADJUSTABLE_MESSAGE = "ปรับยอดได้เฉพาะใบเพิ่มหนี้ต้นฉบับที่ยังใช้งานอยู่";
const LINE_NOT_ON_PARENT_MESSAGE = "รายการที่ปรับยอดต้องเป็นรายการของใบเพิ่มหนี้ต้นทาง";
const EXCESS_TYPE_MISSING_MESSAGE = "ยอดที่ลดเกินยอดค้างของ DN ต้นทาง กรุณาเลือกว่าจะเก็บเป็นเครดิตซัพพลายเออร์หรือรับเงินคืน";
const REFUND_ACCOUNT_MISSING_MESSAGE = "กรุณาเลือกบัญชีที่รับเงินคืนจากซัพพลายเออร์";
const PARENT_VAT_MISMATCH_MESSAGE = "เอกสารปรับยอดต้องใช้ประเภท VAT และอัตรา VAT เดียวกับ DN ต้นทาง กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง";

const negate = (value: number): number => (value === 0 ? 0 : -value);
const money = (value: Prisma.Decimal | number): number =>
  new Prisma.Decimal(value).toDecimalPlaces(MONEY_DECIMALS, Prisma.Decimal.ROUND_HALF_UP).toNumber();
const formatBaht = (value: number): string => value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function resolveAdjustmentDirection(items: ReadonlyArray<{ increaseAmount: number }>): SupplierDebitAdjustmentDirection {
  const positive = items.every((item) => item.increaseAmount > 0);
  const negative = items.every((item) => item.increaseAmount < 0);
  if (!positive && !negative) throw new Error(MIXED_SIGN_MESSAGE);
  return positive ? "INCREASE" : "DECREASE";
}

const parentSelect = {
  id: true, debitNo: true, status: true, adjustsDebitNoteId: true, purchaseId: true, supplierId: true, amountRemain: true,
  vatType: true, vatRate: true, vatRecoverable: true,
  items: { select: { purchaseItemId: true, netAmount: true } },
  adjustments: { where: { status: "ACTIVE" as const }, select: { items: { select: { purchaseItemId: true, netAmount: true } } } },
} satisfies Prisma.SupplierDebitNoteSelect;
type AdjustmentParent = Prisma.SupplierDebitNoteGetPayload<{ select: typeof parentSelect }>;

/** Locks the parent row (every change to a DN family holds it) and returns it when it can be adjusted. */
async function loadAdjustableParent(tx: Tx, parentId: string): Promise<AdjustmentParent> {
  await tx.$queryRaw`SELECT id FROM "SupplierDebitNote" WHERE id = ${parentId} FOR UPDATE`;
  const parent = await tx.supplierDebitNote.findUnique({ where: { id: parentId }, select: parentSelect });
  if (!parent || parent.status !== "ACTIVE" || parent.adjustsDebitNoteId) throw new Error(NOT_ADJUSTABLE_MESSAGE);
  return parent;
}

/** V3: an adjustment inherits the parent's VAT type, rate and recoverability; a different type or rate is rejected. */
function assertInheritsParentVat(parent: AdjustmentParent, input: SupplierDebitAdjustmentInput): void {
  if (input.vatType !== parent.vatType || !new Prisma.Decimal(input.vatRate).equals(parent.vatRate)) {
    throw new Error(PARENT_VAT_MISMATCH_MESSAGE);
  }
}

/** A reduction on a purchase line may not exceed what the parent and its ACTIVE adjustments charged on it. */
function assertReductionWithinCharged(parent: AdjustmentParent, lines: PreparedDebitLine[]): void {
  const charged = new Map<string, Prisma.Decimal>();
  const add = (purchaseItemId: string | null, amount: Prisma.Decimal | number): void => {
    if (!purchaseItemId) return;
    charged.set(purchaseItemId, (charged.get(purchaseItemId) ?? new Prisma.Decimal(0)).plus(amount));
  };
  for (const item of parent.items) add(item.purchaseItemId, item.netAmount);
  for (const adjustment of parent.adjustments) for (const item of adjustment.items) add(item.purchaseItemId, item.netAmount);
  for (const line of lines) {
    const available = charged.get(line.purchaseItemId) ?? new Prisma.Decimal(0);
    if (available.plus(line.netAmount).lt(0)) {
      throw new Error(`ยอดลดของ ${line.productName} (${formatBaht(Math.abs(line.netAmount))} บาท) เกินยอดใบเพิ่มหนี้คงเหลือของรายการนี้ ${formatBaht(available.toNumber())} บาท`);
    }
  }
}

/** The DN-shaped input the shared DN preparation reads: absolute amounts on the parent's purchase, the parent's VAT. */
const toDebitInput = (input: SupplierDebitAdjustmentInput, parent: AdjustmentParent): SupplierDebitNoteInput => ({
  purchaseId: parent.purchaseId, supplierReferenceNo: input.supplierReferenceNo, debitDate: input.debitDate,
  receivedDate: input.receivedDate, dueDate: input.dueDate, reason: input.reason, note: input.note,
  vatType: parent.vatType, vatRate: Number(parent.vatRate),
  items: input.items.map((item) => ({ ...item, increaseAmount: Math.abs(item.increaseAmount) })),
});

const toSignedLine = (line: PreparedDebitLine): PreparedDebitLine => ({ ...line, increaseAmount: negate(line.increaseAmount),
  subtotalAmount: negate(line.subtotalAmount), vatAmount: negate(line.vatAmount), netAmount: negate(line.netAmount),
  costAdjustmentAmount: negate(line.costAdjustmentAmount), inventoryAmount: negate(line.inventoryAmount),
  varianceAmount: negate(line.varianceAmount) });

type PreparedAdjustment = { parent: AdjustmentParent; direction: SupplierDebitAdjustmentDirection; lines: PreparedDebitLine[] };

async function prepareAdjustment(tx: Tx, input: SupplierDebitAdjustmentInput, today: Date): Promise<PreparedAdjustment> {
  try {
    const direction = resolveAdjustmentDirection(input.items);
    const parent = await loadAdjustableParent(tx, input.parentId);
    assertInheritsParentVat(parent, input);
    const parentLines = new Set(parent.items.map((item) => item.purchaseItemId).filter((id): id is string => Boolean(id)));
    if (input.items.some((item) => !parentLines.has(item.purchaseItemId))) throw new Error(LINE_NOT_ON_PARENT_MESSAGE);
    const { lines } = await prepareDebitLines(tx, toDebitInput(input, parent), today, parent.vatRecoverable);
    const signed = direction === "DECREASE" ? lines.map(toSignedLine) : lines;
    if (direction === "DECREASE") assertReductionWithinCharged(parent, signed);
    return { parent, direction, lines: signed };
  } catch (error) {
    console.error("[prepareAdjustment]", error);
    throw error;
  }
}

type ExcessSettlement = {
  appliedToParent: number; excessAmount: number; type: PurchaseReturnSettlementType | null;
  cashBankAccountId: string | null; refundMethod: PurchaseReturnRefundMethod | null;
};

/** ก3: a reduction beyond the parent's outstanding balance needs the user's choice; nothing else carries one. */
async function resolveExcessSettlement(tx: Tx, input: SupplierDebitAdjustmentInput, parentRemain: Prisma.Decimal,
  netAmount: number, requireChoice: boolean): Promise<ExcessSettlement> {
  const none: ExcessSettlement = { appliedToParent: 0, excessAmount: 0, type: null, cashBankAccountId: null, refundMethod: null };
  if (netAmount >= 0) return none;
  const { applied, excess } = splitDebitAdjustmentReduction(parentRemain, netAmount);
  const base = { ...none, appliedToParent: money(applied), excessAmount: money(excess) };
  if (excess.lte(0) || !requireChoice) return base;
  if (!input.excessSettlementType) throw new Error(EXCESS_TYPE_MISSING_MESSAGE);
  if (input.excessSettlementType === PurchaseReturnSettlementType.SUPPLIER_CREDIT) {
    return { ...base, type: PurchaseReturnSettlementType.SUPPLIER_CREDIT };
  }
  if (!input.cashBankAccountId) throw new Error(REFUND_ACCOUNT_MISSING_MESSAGE);
  return { ...base, type: PurchaseReturnSettlementType.CASH_REFUND, cashBankAccountId: input.cashBankAccountId,
    refundMethod: await resolveSupplierDebitRefundMethod(tx, input.cashBankAccountId) };
}

function assertPreviewMatches(input: SupplierDebitAdjustmentInput, totals: { inventoryAmount: number; varianceAmount: number },
  excessAmount: number): void {
  if (input.expectedInventoryAmount !== totals.inventoryAmount || input.expectedVarianceAmount !== totals.varianceAmount ||
    (input.expectedExcessAmount ?? 0) !== excessAmount) {
    throw new SupplierDebitPreviewRequiredError();
  }
}

/** Totals, coverage and the parent/excess split for the form's "ตรวจยอด" (reads only; locks like a DN preview). */
export async function previewSupplierDebitAdjustment(rawInput: unknown): Promise<SupplierDebitAdjustmentPreview> {
  try {
    const input = supplierDebitAdjustmentSchema.parse(rawInput);
    const today = parseDateOnlyToDate(getThailandDateKey());
    return await dbTx(async (tx) => {
      const { parent, direction, lines } = await prepareAdjustment(tx, input, today);
      const totals = summarizeDebitLines(lines);
      const settlement = await resolveExcessSettlement(tx, input, parent.amountRemain, totals.netAmount, false);
      const locked = await findLockedPeriods(tx, [today]);
      return { direction, ...totals, parentRemain: Number(parent.amountRemain), appliedToParent: settlement.appliedToParent,
        excessAmount: settlement.excessAmount, lockedPeriods: toSupplierDebitLockedPeriods(locked) };
    });
  } catch (error) {
    console.error("[previewSupplierDebitAdjustment]", error);
    throw error;
  }
}

const describeAdjustmentLine = (parentDebitNo: string) => (line: PreparedDebitLine): string =>
  `${formatSupplierDebitAdjustmentLabel(parentDebitNo)} · มูลค่าสต็อก ${line.inventoryAmount.toFixed(2)} / ส่วนต่างต้นทุน ${line.varianceAmount.toFixed(2)}`;

/**
 * Posts the adjustment today: month lock on today's posting date only (the parent's month may be distributed),
 * the same numbering, VAT and value-only posting as a DN, then the parent/excess split (refund movement when chosen),
 * the family balance, its variance facts, the audit entry and the bell + Telegram alert.
 */
export async function postSupplierDebitAdjustment(rawInput: unknown, actor: SupplierDebitActor,
  options?: SupplierDebitMutationOptions): Promise<{ id: string; debitNo: string }> {
  let referenceLookup: SupplierReferenceLookup | null = null;
  try {
    const input = supplierDebitAdjustmentSchema.parse(rawInput);
    const postingDate = parseDateOnlyToDate(getThailandDateKey());
    const { override, notice, ...debit } = await dbTx(async (tx) => {
      const { parent, direction, lines } = await prepareAdjustment(tx, input, postingDate);
      referenceLookup = { supplierId: parent.supplierId, supplierReferenceNo: input.supplierReferenceNo };
      await assertSupplierReferenceAvailable(tx, referenceLookup);
      const totals = summarizeDebitLines(lines);
      const settlement = await resolveExcessSettlement(tx, input, parent.amountRemain, totals.netAmount, true);
      assertPreviewMatches(input, totals, settlement.excessAmount);
      const periodOverride = await assertDebitPeriodsUnlocked(tx, [postingDate], options);
      const debitNo = await generateSupplierDebitNo(tx, postingDate);
      const receivedDate = parseDateOnlyToDate(input.receivedDate);
      const created = await tx.supplierDebitNote.create({ data: {
        debitNo, purchaseId: parent.purchaseId, supplierId: parent.supplierId, userId: actor.userId,
        supplierReferenceNo: input.supplierReferenceNo, debitDate: parseDateOnlyToDate(input.debitDate), receivedDate,
        postingDate, dueDate: direction === "DECREASE" ? receivedDate : parseDateOnlyToDate(input.dueDate),
        reason: input.reason, note: input.note, vatType: parent.vatType, vatRate: parent.vatRate,
        vatRecoverable: parent.vatRecoverable, ...totals, amountRemain: direction === "INCREASE" ? totals.netAmount : 0,
        adjustsDebitNoteId: parent.id, excessSettlementType: settlement.type, refundMethod: settlement.refundMethod,
        cashBankAccountId: settlement.cashBankAccountId,
      } });
      await postDebitLines(tx, created, postingDate, lines, undefined, describeAdjustmentLine(parent.debitNo));
      if (settlement.type === PurchaseReturnSettlementType.CASH_REFUND && settlement.cashBankAccountId) {
        await postSupplierDebitRefund(tx, { debitId: created.id, debitNo, accountId: settlement.cashBankAccountId,
          amount: settlement.excessAmount, txnDate: postingDate, note: `รับเงินคืน ${formatSupplierDebitAdjustmentLabel(parent.debitNo)}` });
      }
      await recalculateSupplierDebitBalance(tx, created.id);
      await rebuildSupplierDebitProfitFacts(tx, created.id);
      await writeAuditLogTx(tx, { ...actor, action: AuditAction.CREATE, entityType: "SupplierDebitNote",
        entityId: created.id, entityRef: debitNo, after: { ...created, adjusts: { id: parent.id, debitNo: parent.debitNo },
          direction, lines, settlement }, ...overrideAuditMeta(periodOverride) });
      return { id: created.id, debitNo, override: periodOverride,
        notice: { parentDebitNo: parent.debitNo, netAmount: totals.netAmount } };
    });
    await notifySupplierDebitNote({ ...debit, adjustment: notice }, "created");
    await notifyDebitPeriodOverride(override, debit, "บันทึกปรับยอด DN", actor);
    revalidateProfitDashboardCache();
    return debit;
  } catch (error) {
    console.error("[postSupplierDebitAdjustment]", error);
    throw await toSupplierReferenceConflict(error, referenceLookup);
  }
}
