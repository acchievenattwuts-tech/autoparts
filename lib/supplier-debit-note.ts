import { z } from "zod";
import { dbTx } from "@/lib/db";
import { Prisma, AuditAction } from "@/lib/generated/prisma";
import { getThailandDateKey, isDateOnlyString, parseDateOnlyToDate } from "@/lib/th-date";
import { generateSupplierDebitNo } from "@/lib/doc-number";
import { writeAuditLogTx, type AuditLogActor, type AuditRequestContext } from "@/lib/audit-log";
import { notifySupplierDebitNote } from "@/lib/notifications";
import { getStockValuationEpoch, writeStockCard, recalculateStockCardMany } from "@/lib/stock-card";
import { calculateSupplierDebitLine, allocateSupplierDebitCoverage } from "@/lib/supplier-debit-note-calculation";
import { rebuildSupplierDebitProfitFacts } from "@/lib/profit-fact";
import { revalidateProfitDashboardCache } from "@/lib/profit-cache";
import { createDocumentMutationGuard, buildMutationBlockMessage, type GuardDb } from "@/lib/document-mutation-guard";

const MAX_DEBIT_ITEMS = 100;
const MAX_MONEY = 99_999_999.99;
const dateSchema = z.string().refine(isDateOnlyString, "วันที่ไม่ถูกต้อง");
const positiveMoney = z.number().finite().positive().max(MAX_MONEY)
  .refine((value) => new Prisma.Decimal(value).decimalPlaces() <= 2, "จำนวนเงินต้องไม่เกิน 2 ทศนิยม");
export const supplierDebitNoteSchema = z.object({
  purchaseId: z.string().min(1), supplierReferenceNo: z.string().trim().min(1).max(100),
  debitDate: dateSchema, receivedDate: dateSchema, dueDate: dateSchema,
  reason: z.string().trim().min(1, "กรุณาระบุเหตุผล").max(1000), note: z.string().trim().max(2000).default(""),
  vatType: z.enum(["NO_VAT", "EXCLUDING_VAT", "INCLUDING_VAT"]),
  vatRate: z.number().finite().min(0).max(100)
    .refine((value) => new Prisma.Decimal(value).decimalPlaces() <= 2, "อัตรา VAT ต้องไม่เกิน 2 ทศนิยม"), vatRecoverable: z.boolean(),
  expectedInventoryAmount: z.number().finite().nonnegative().optional(),
  expectedVarianceAmount: z.number().finite().nonnegative().optional(),
  items: z.array(z.object({ purchaseItemId: z.string().min(1),
    affectedQuantity: z.number().finite().positive(), amountMode: z.enum(["PER_UNIT", "TOTAL"]),
    increaseAmount: positiveMoney,
  })).min(1).max(MAX_DEBIT_ITEMS),
});
export type SupplierDebitNoteInput = z.infer<typeof supplierDebitNoteSchema>;
type Actor = AuditLogActor & AuditRequestContext & { userId: string };
type Tx = Prisma.TransactionClient;
type PreparedDebitLine = SupplierDebitNoteInput["items"][number] & {
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

function summarizeDebitLines(lines: PreparedDebitLine[]): {
  subtotalAmount: number; vatAmount: number; netAmount: number; inventoryAmount: number; varianceAmount: number;
} {
  const netAmount = sumMoney(lines.map((line) => line.netAmount));
  if (netAmount > MAX_MONEY) throw new Error("ยอดรวม DN เกินขอบเขตจำนวนเงินที่ระบบรองรับ");
  return { subtotalAmount: sumMoney(lines.map((line) => line.subtotalAmount)),
    vatAmount: sumMoney(lines.map((line) => line.vatAmount)), netAmount,
    inventoryAmount: sumMoney(lines.map((line) => line.inventoryAmount)),
    varianceAmount: sumMoney(lines.map((line) => line.varianceAmount)) };
}

function assertPreviewedAllocation(input: SupplierDebitNoteInput, lines: PreparedDebitLine[]): void {
  if (input.expectedInventoryAmount === undefined || input.expectedVarianceAmount === undefined ||
    input.expectedInventoryAmount !== sumMoney(lines.map((line) => line.inventoryAmount)) ||
    input.expectedVarianceAmount !== sumMoney(lines.map((line) => line.varianceAmount))) {
    throw new Error("ยอดจัดสรรต้นทุนเปลี่ยนหรือยังไม่ได้ตรวจยอด กรุณาตรวจยอดอีกครั้งก่อนบันทึก");
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

async function prepareDebitLines(tx: Tx, input: SupplierDebitNoteInput, today: Date): Promise<PreparedDebit> {
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
      select: { id: true, stock: true, inventoryTracking: true },
    });
    const stocks = new Map(products.map((product) => [product.id, product.inventoryTracking === "TRACKED" ? product.stock : 0]));
    const lines = sourceLines.map(({ item, source }) => {
      const unitScale = Number(source.unitScale ?? 1);
      const amounts = calculateSupplierDebitLine({ ...item, unitScale, vatType: input.vatType,
        vatRate: input.vatRate, vatRecoverable: input.vatRecoverable });
      if (amounts.affectedBaseQuantity > source.quantity) throw new Error("จำนวนที่ปรับราคาเกินจำนวนรับในรายการเดิม");
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

async function postDebitLines(tx: Tx, debit: { id: string; debitNo: string },
  postingDate: Date, lines: Awaited<ReturnType<typeof prepareDebitLines>>["lines"],
): Promise<void> {
  try {
    const epochs = new Map<string, number>();
    for (const [index, line] of lines.entries()) {
      let epoch = epochs.get(line.productId);
      if (epoch === undefined) {
        epoch = (await getStockValuationEpoch(tx, line.productId, postingDate)) + 1;
        epochs.set(line.productId, epoch);
      }
      const before = await tx.stockCard.findFirst({ where: { productId: line.productId },
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
        referenceId: item.id, detail: `DN เพิ่มมูลค่า ${line.inventoryAmount.toFixed(2)} / ส่วนต่างต้นทุน ${line.varianceAmount.toFixed(2)}`,
      });
      const after = await tx.stockCard.findUniqueOrThrow({ where: { id: stockCardId }, select: { priceBalance: true } });
      await tx.supplierDebitNoteItem.update({ where: { id: item.id }, data: { stockCardId, avgCostAfter: after.priceBalance } });
    }
  } catch (error) {
    console.error("[postDebitLines]", error);
    throw error;
  }
}

export async function postSupplierDebitNote(rawInput: unknown, actor: Actor): Promise<{ id: string; debitNo: string }> {
  try {
    const input = supplierDebitNoteSchema.parse(rawInput);
    const postingDate = parseDateOnlyToDate(getThailandDateKey());
    const debit = await dbTx(async (tx) => {
      const { purchase, lines } = await prepareDebitLines(tx, input, postingDate);
      assertPreviewedAllocation(input, lines);
      const debitNo = await generateSupplierDebitNo(tx, postingDate);
      const totals = summarizeDebitLines(lines);
      const created = await tx.supplierDebitNote.create({ data: {
        debitNo, purchaseId: purchase.id, supplierId: purchase.supplierId!, userId: actor.userId,
        supplierReferenceNo: input.supplierReferenceNo, debitDate: parseDateOnlyToDate(input.debitDate),
        receivedDate: parseDateOnlyToDate(input.receivedDate), postingDate, dueDate: parseDateOnlyToDate(input.dueDate),
        reason: input.reason, note: input.note, vatType: input.vatType, vatRate: input.vatRate,
        vatRecoverable: input.vatRecoverable, ...totals, amountRemain: totals.netAmount,
      } });
      await postDebitLines(tx, created, postingDate, lines);
      await rebuildSupplierDebitProfitFacts(tx, created.id);
      await writeAuditLogTx(tx, { ...actor, action: AuditAction.CREATE, entityType: "SupplierDebitNote",
        entityId: created.id, entityRef: created.debitNo, after: { ...created, lines } });
      return { id: created.id, debitNo: created.debitNo };
    });
    await notifySupplierDebitNote(debit, "created");
    revalidateProfitDashboardCache();
    return debit;
  } catch (error) {
    console.error("[postSupplierDebitNote]", error);
    throw error;
  }
}

export async function previewSupplierDebitNote(rawInput: unknown): Promise<{
  subtotalAmount: number; vatAmount: number; netAmount: number; inventoryAmount: number; varianceAmount: number;
}> {
  try {
    const input = supplierDebitNoteSchema.parse(rawInput);
    return dbTx(async (tx) => {
      const { lines } = await prepareDebitLines(tx, input, parseDateOnlyToDate(getThailandDateKey()));
      return summarizeDebitLines(lines);
    });
  } catch (error) {
    console.error("[previewSupplierDebitNote]", error);
    throw error;
  }
}

type DebitWithItems = Prisma.SupplierDebitNoteGetPayload<{ include: { items: true } }>;
type DebitHeaderData = Pick<Prisma.SupplierDebitNoteUncheckedUpdateInput,
  "supplierReferenceNo" | "debitDate" | "receivedDate" | "dueDate" | "reason" | "note">;

/** True when VAT settings and every line match the posted DN, so only header fields changed. */
export function isSameSupplierDebitPosting(current: DebitWithItems, input: SupplierDebitNoteInput): boolean {
  if (current.vatType !== input.vatType || Number(current.vatRate) !== input.vatRate ||
    current.vatRecoverable !== input.vatRecoverable || current.items.length !== input.items.length) return false;
  const postedBySource = new Map(current.items.map((line) => [line.purchaseItemId, line]));
  return input.items.every((next) => {
    const posted = postedBySource.get(next.purchaseItemId);
    return Boolean(posted) && posted!.amountMode === next.amountMode &&
      Number(posted!.increaseAmount) === next.increaseAmount && Number(posted!.affectedQuantity) === next.affectedQuantity;
  });
}

export async function getSupplierDebitRepostReason(tx: Tx, id: string): Promise<string | null> {
  try {
    return buildMutationBlockMessage(await createDocumentMutationGuard(tx as unknown as GuardDb).check("SupplierDebitNote", id, "update"));
  } catch (error) {
    console.error("[getSupplierDebitRepostReason]", error);
    throw error;
  }
}

/** Reverse the posted value-only stock rows and post the edited lines at today's business date under the same DN number. */
async function repostSupplierDebitNote(tx: Tx, current: DebitWithItems, input: SupplierDebitNoteInput,
  postingDate: Date, header: DebitHeaderData): Promise<{ lines: PreparedDebitLine[] }> {
  try {
    await tx.$queryRaw`SELECT id FROM "Purchase" WHERE id = ${current.purchaseId} FOR UPDATE`;
    const sources = await tx.purchaseItem.findMany({ where: { purchaseId: current.purchaseId,
      id: { in: input.items.map((item) => item.purchaseItemId) } }, select: { productId: true } });
    const postedProductIds = current.items.map((item) => item.productId);
    await lockDebitProducts(tx, [...postedProductIds, ...sources.map((source) => source.productId)]);
    const reason = await getSupplierDebitRepostReason(tx, current.id);
    if (reason) throw new Error(reason);
    await tx.stockCard.deleteMany({ where: { docNo: current.debitNo, source: "SUPPLIER_DEBIT" } });
    await tx.supplierDebitNoteItem.deleteMany({ where: { debitNoteId: current.id } });
    await recalculateStockCardMany(tx, postedProductIds);
    const { lines } = await prepareDebitLines(tx, input, postingDate);
    assertPreviewedAllocation(input, lines);
    const totals = summarizeDebitLines(lines);
    await tx.supplierDebitNote.update({ where: { id: current.id }, data: { ...header, postingDate,
      vatType: input.vatType, vatRate: input.vatRate, vatRecoverable: input.vatRecoverable,
      ...totals, amountRemain: totals.netAmount } });
    await postDebitLines(tx, current, postingDate, lines);
    await rebuildSupplierDebitProfitFacts(tx, current.id);
    return { lines };
  } catch (error) {
    console.error("[repostSupplierDebitNote]", error);
    throw error;
  }
}

/**
 * Header fields (supplier reference, dates, reason, note) may change while the DN is ACTIVE.
 * VAT or line changes repost the DN and require the same guard as cancellation: no active payment
 * and no later stock movement on the affected SKUs.
 */
export async function updateSupplierDebitNote(id: string, rawInput: unknown, actor: Actor): Promise<{
  id: string; debitNo: string; reposted: boolean;
}> {
  try {
    const parsedId = z.string().min(1).parse(id);
    const input = supplierDebitNoteSchema.parse(rawInput);
    const today = parseDateOnlyToDate(getThailandDateKey());
    const result = await dbTx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "SupplierDebitNote" WHERE id = ${parsedId} FOR UPDATE`;
      const current = await tx.supplierDebitNote.findUnique({ where: { id: parsedId }, include: { items: true } });
      if (!current || current.status !== "ACTIVE") throw new Error("แก้ไขได้เฉพาะ DN ที่ใช้งานอยู่");
      if (current.purchaseId !== input.purchaseId) throw new Error("ไม่สามารถเปลี่ยนใบซื้ออ้างอิงของ DN ได้ กรุณายกเลิกแล้วบันทึกใหม่");
      assertDebitDates(input, today);
      const header: DebitHeaderData = { supplierReferenceNo: input.supplierReferenceNo,
        debitDate: parseDateOnlyToDate(input.debitDate), receivedDate: parseDateOnlyToDate(input.receivedDate),
        dueDate: parseDateOnlyToDate(input.dueDate), reason: input.reason, note: input.note };
      const reposted = !isSameSupplierDebitPosting(current, input);
      const repost = reposted ? await repostSupplierDebitNote(tx, current, input, today, header) : null;
      if (!reposted) await tx.supplierDebitNote.update({ where: { id: parsedId }, data: header });
      const after = await tx.supplierDebitNote.findUnique({ where: { id: parsedId }, include: { items: true } });
      await writeAuditLogTx(tx, { ...actor, action: AuditAction.UPDATE, entityType: "SupplierDebitNote",
        entityId: parsedId, entityRef: current.debitNo, before: current,
        after: { ...after, reposted, ...(repost ? { lines: repost.lines } : {}) } });
      return { id: parsedId, debitNo: current.debitNo, reposted };
    });
    await notifySupplierDebitNote(result, "updated");
    if (result.reposted) revalidateProfitDashboardCache();
    return result;
  } catch (error) {
    console.error("[updateSupplierDebitNote]", error);
    throw error;
  }
}

export async function recalculateSupplierDebitRemain(tx: Tx, debitNoteId: string): Promise<void> {
  try {
    const debit = await tx.supplierDebitNote.findUniqueOrThrow({ where: { id: debitNoteId },
      select: { status: true, netAmount: true, supplierPaymentItems: {
        where: { payment: { status: "ACTIVE" } }, select: { paidAmount: true },
      } },
    });
    const paid = sumMoney(debit.supplierPaymentItems.map((item) => Number(item.paidAmount)));
    await tx.supplierDebitNote.update({ where: { id: debitNoteId }, data: {
      amountRemain: debit.status === "CANCELLED" ? 0 : Prisma.Decimal.max(0, debit.netAmount.minus(paid)),
    } });
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

export async function cancelSupplierDebitNote(id: string, cancelNote: string, actor: Actor): Promise<void> {
  try {
    const parsedId = z.string().min(1).parse(id);
    const parsedNote = z.string().trim().min(1, "กรุณาระบุเหตุผลยกเลิก").max(1000).parse(cancelNote);
    const debit = await dbTx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "SupplierDebitNote" WHERE id = ${parsedId} FOR UPDATE`;
      const current = await tx.supplierDebitNote.findUniqueOrThrow({ where: { id: parsedId }, include: { items: true } });
      await lockDebitProducts(tx, current.items.map((item) => item.productId));
      const reason = await getSupplierDebitCancelReason(tx, parsedId);
      if (reason) throw new Error(reason);
      await tx.stockCard.deleteMany({ where: { docNo: current.debitNo, source: "SUPPLIER_DEBIT" } });
      await recalculateStockCardMany(tx, current.items.map((item) => item.productId));
      await tx.factProfit.updateMany({ where: { sourceType: "PURCHASE_COST_VARIANCE", sourceId: parsedId, isActive: true },
        data: { isActive: false, supersededAt: new Date(), sourceStatus: "CANCELLED" } });
      await tx.supplierDebitNote.update({ where: { id: parsedId }, data: {
        status: "CANCELLED", cancelledAt: new Date(), cancelNote: parsedNote, amountRemain: 0,
      } });
      await writeAuditLogTx(tx, { ...actor, action: AuditAction.CANCEL, entityType: "SupplierDebitNote",
        entityId: parsedId, entityRef: current.debitNo, before: current,
        after: { status: "CANCELLED", cancelNote: parsedNote, amountRemain: 0 } });
      return { id: parsedId, debitNo: current.debitNo };
    });
    await notifySupplierDebitNote(debit, "cancelled");
    revalidateProfitDashboardCache();
  } catch (error) {
    console.error("[cancelSupplierDebitNote]", error);
    throw error;
  }
}
