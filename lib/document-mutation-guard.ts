import { Prisma } from "@/lib/generated/prisma";

export type MutableDocumentEntityType =
  | "SalesQuotation"
  | "Sale"
  | "Purchase"
  | "SupplierDebitNote"
  | "Adjustment"
  | "BalanceForward"
  | "StockCard"
  | "Receipt"
  | "CreditNote"
  | "PurchaseReturn"
  | "SupplierPayment"
  | "SupplierAdvance"
  | "CustomerAdvance"
  | "SupplierAdvanceRefund"
  | "CustomerAdvanceRefund"
  | "Expense"
  | "WarrantyClaim"
  | "CashBankTransfer"
  | "CashBankAdjustment"
  | "MarketplaceSettlement"
  | "DeliveryCommissionRun";

export type DocumentMutationAction = "update" | "cancel" | "reopen";

export type MutationBlockReference = {
  entityType: MutableDocumentEntityType;
  id: string;
  refNo: string;
};

export type MutationBlockResult = {
  blocked: boolean;
  reason: string | null;
  references: MutationBlockReference[];
};

type FindManyArgs = Record<string, unknown>;
type FindManyResult = Promise<Array<Record<string, unknown>>>;

export type GuardDb = {
  stockCard?: { findMany(args: FindManyArgs): FindManyResult };
  purchase?: { findMany(args: FindManyArgs): FindManyResult };
  supplierDebitNote?: { findMany(args: FindManyArgs): FindManyResult };
  adjustment?: { findMany(args: FindManyArgs): FindManyResult };
  balanceForward?: { findMany(args: FindManyArgs): FindManyResult };
  sale?: { findMany(args: FindManyArgs): FindManyResult };
  creditNote?: { findMany(args: FindManyArgs): FindManyResult };
  receiptItem?: { findMany(args: FindManyArgs): FindManyResult };
  warrantyClaim?: { findMany(args: FindManyArgs): FindManyResult };
  purchaseReturn?: { findMany(args: FindManyArgs): FindManyResult };
  supplierPaymentItem?: { findMany(args: FindManyArgs): FindManyResult };
  supplierAdvanceRefund?: { findMany(args: FindManyArgs): FindManyResult };
  customerAdvanceRefund?: { findMany(args: FindManyArgs): FindManyResult };
  marketplaceSettlementLine?: { findMany(args: FindManyArgs): FindManyResult };
  marketplaceSettlement?: { findMany(args: FindManyArgs): FindManyResult };
  expense?: { findMany(args: FindManyArgs): FindManyResult };
  deliveryCommissionItem?: { findMany(args: FindManyArgs): FindManyResult };
  deliveryCommissionRun?: { findMany(args: FindManyArgs): FindManyResult };
};

/** Reason for documents a marketplace settlement round created (fee expense, transfer, adjustment). */
export const MARKETPLACE_SETTLEMENT_SOURCE_REASON =
  "ถูกสร้างจากรอบรับเงินช่องทางขาย กรุณายกเลิกที่รอบรับเงินแทน";
/** Same wording updateShippingStatus uses for a bill whose delivery commission is already paid. */
export const DELIVERY_COMMISSION_SALE_REASON = "บิลนี้ถูกทำจ่ายค่าส่งแล้ว กรุณายกเลิกเอกสารทำจ่ายก่อน";
/** Reason for the expense a delivery commission run created. */
export const DELIVERY_COMMISSION_EXPENSE_REASON =
  "ถูกสร้างจากเอกสารทำจ่ายค่าส่ง กรุณายกเลิกที่เอกสารทำจ่ายแทน";

const allow = (): MutationBlockResult => ({
  blocked: false,
  reason: null,
  references: [],
});

const block = (reason: string, references: MutationBlockReference[],
): MutationBlockResult => ({
  blocked: references.length > 0,
  reason: references.length > 0 ? reason : null,
  references,
});

/**
 * Builds the result the guard would return from relation data a list page has
 * already loaded, so a disabled button can show the exact server message
 * without one guard query per row.
 */
export const buildMutationBlockResult = block;

const uniqueRefs = (refs: MutationBlockReference[],
): MutationBlockReference[] => {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.entityType}:${ref.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function nestedRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function mapDirectRefs(
  rows: Array<Record<string, unknown>>,
  entityType: MutableDocumentEntityType,
  refField: string,
): MutationBlockReference[] {
  return rows
    .map((row) => {
      const id = stringValue(row.id);
      const refNo = stringValue(row[refField]);
      return id && refNo ? { entityType, id, refNo } : null;
    })
    .filter((ref): ref is MutationBlockReference => ref !== null);
}

function mapNestedRefs(
  rows: Array<Record<string, unknown>>,
  nestedField: string,
  entityType: MutableDocumentEntityType,
  refField: string,
): MutationBlockReference[] {
  return rows
    .map((row) => {
      const nested = nestedRecord(row[nestedField]);
      const id = stringValue(nested?.id);
      const refNo = stringValue(nested?.[refField]);
      return id && refNo ? { entityType, id, refNo } : null;
    })
    .filter((ref): ref is MutationBlockReference => ref !== null);
}

export function buildMutationBlockMessage(result: MutationBlockResult,
): string | null {
  if (!result.blocked || !result.reason) return null;
  const refs = result.references.map((ref) => ref.refNo).join(", ");
  return `ไม่สามารถดำเนินการได้ เนื่องจาก${result.reason}${refs ? `: ${refs}` : ""}`;
}

const ENTITY_ROUTE: Record<MutableDocumentEntityType, string> = {
  SalesQuotation: "/admin/sales-quotations",
  Sale: "/admin/sales",
  Purchase: "/admin/purchases",
  SupplierDebitNote: "/admin/supplier-debit-notes",
  Adjustment: "/admin/stock/adjustments",
  BalanceForward: "/admin/stock/bf",
  StockCard: "/admin/stock/card",
  Receipt: "/admin/receipts",
  CreditNote: "/admin/credit-notes",
  PurchaseReturn: "/admin/purchase-returns",
  SupplierPayment: "/admin/supplier-payments",
  SupplierAdvance: "/admin/supplier-advances",
  CustomerAdvance: "/admin/customer-advances",
  SupplierAdvanceRefund: "/admin/supplier-advance-refunds",
  CustomerAdvanceRefund: "/admin/customer-advance-refunds",
  Expense: "/admin/expenses",
  WarrantyClaim: "/admin/warranty-claims",
  CashBankTransfer: "/admin/cash-bank/transfers",
  CashBankAdjustment: "/admin/cash-bank/adjustments",
  MarketplaceSettlement: "/admin/marketplace/settlements",
  DeliveryCommissionRun: "/admin/delivery-commissions",
};

export type MutationBlockReferenceLink = {
  href: string;
  label: string;
};

export function buildMutationBlockReferenceLinks(
  result: MutationBlockResult,
): MutationBlockReferenceLink[] {
  return result.references.map((ref) => ({
    href: ref.entityType === "StockCard"
      ? `${ENTITY_ROUTE.StockCard}?productId=${encodeURIComponent(ref.id)}`
      : ref.entityType === "Adjustment" || ref.entityType === "BalanceForward"
        ? `${ENTITY_ROUTE[ref.entityType]}#document-${encodeURIComponent(ref.id)}`
      : `${ENTITY_ROUTE[ref.entityType]}/${ref.id}`,
    label: ref.refNo,
  }));
}

const STOCK_BOUNDARY_REASON = "รายการสต็อกถูกใช้คำนวณใบเพิ่มหนี้แล้ว กรุณายกเลิกเอกสารปลายทางก่อน";
const DEBIT_LATER_STOCK_REASON = "มีรายการสต็อกหลังใบเพิ่มหนี้ กรุณายกเลิกเอกสารปลายทางก่อน";

type StockBoundaryRow = {
  productId: string;
  docNo: string;
  docDate: Date;
  sorder: number;
  valuationEpoch: number;
};

function stockBoundaryRow(row: Record<string, unknown>): StockBoundaryRow | null {
  const productId = stringValue(row.productId);
  const docNo = stringValue(row.docNo);
  return productId && docNo && row.docDate instanceof Date && typeof row.sorder === "number"
    ? { productId, docNo, docDate: row.docDate, sorder: row.sorder,
        valuationEpoch: typeof row.valuationEpoch === "number" ? row.valuationEpoch : 0 }
    : null;
}

const stockBoundarySelect = {
  productId: true, docNo: true, docDate: true, sorder: true, valuationEpoch: true,
};

/** Batch list-page reasons from the same persisted DN boundary used by server guards. */
export async function getStockDocumentDebitBlocks(database: GuardDb, docNos: string[]): Promise<Map<string, MutationBlockResult>> {
  const results = new Map<string, MutationBlockResult>();
  if (!database.stockCard || docNos.length === 0) return results;
  try {
    const ownRows = (await database.stockCard.findMany({ where: { docNo: { in: docNos } }, select: stockBoundarySelect }))
      .map(stockBoundaryRow).filter((row): row is StockBoundaryRow => Boolean(row));
    if (ownRows.length === 0) return results;
    const laterRows = (await database.stockCard.findMany({ where: {
      source: "SUPPLIER_DEBIT", OR: ownRows.map(laterStockWhere),
    }, select: stockBoundarySelect })).map(stockBoundaryRow).filter((row): row is StockBoundaryRow => Boolean(row));
    const debitRefs = mapDirectRefs(await database.supplierDebitNote?.findMany({
      where: { debitNo: { in: [...new Set(laterRows.map((row) => row.docNo))] }, status: "ACTIVE" },
      select: { id: true, debitNo: true },
    }) ?? [], "SupplierDebitNote", "debitNo");
    const refByNo = new Map(debitRefs.map((ref) => [ref.refNo, ref]));
    for (const docNo of docNos) {
      const refs = laterRows.filter((later) => ownRows.some((own) => own.docNo === docNo && own.productId === later.productId &&
        (later.docDate > own.docDate || (later.docDate.getTime() === own.docDate.getTime() &&
          (later.valuationEpoch > own.valuationEpoch || (later.valuationEpoch === own.valuationEpoch && later.sorder > own.sorder))))))
        .map((row) => refByNo.get(row.docNo)).filter((ref): ref is MutationBlockReference => Boolean(ref));
      results.set(docNo, block(STOCK_BOUNDARY_REASON, uniqueRefs(refs)));
    }
    return results;
  } catch (error) { console.error("[getStockDocumentDebitBlocks]", error); throw error; }
}

/** The persisted epoch preserves posting order even when source precedence differs. */
function laterStockWhere(row: StockBoundaryRow): Record<string, unknown> {
  return { productId: row.productId, OR: [
    { docDate: { gt: row.docDate } },
    { docDate: row.docDate, valuationEpoch: { gt: row.valuationEpoch } },
    { docDate: row.docDate, valuationEpoch: row.valuationEpoch, sorder: { gt: row.sorder } },
  ] };
}

async function checkStockRowsBoundary(database: GuardDb, ownRows: StockBoundaryRow[],
  debitCancellation: boolean): Promise<MutationBlockResult> {
  if (!database.stockCard || ownRows.length === 0) return allow();
  const ownDocNos = [...new Set(ownRows.map((row) => row.docNo))];
  const later = await database.stockCard.findMany({
    where: { docNo: { notIn: ownDocNos }, ...(debitCancellation ? {} : { source: "SUPPLIER_DEBIT" }),
      OR: ownRows.map(laterStockWhere) },
    select: stockBoundarySelect,
  });
  const docNos = [...new Set(later.map((row) => stringValue(row.docNo)).filter((value): value is string => Boolean(value)))];
  if (docNos.length === 0) return allow();
  if (!debitCancellation) {
    const debits = await database.supplierDebitNote?.findMany({
      where: { debitNo: { in: docNos }, status: "ACTIVE" }, select: { id: true, debitNo: true },
    }) ?? [];
    return block(STOCK_BOUNDARY_REASON, uniqueRefs(mapDirectRefs(debits, "SupplierDebitNote", "debitNo")));
  }
  // All retained StockCard rows represent active stock effects. Link known source documents;
  // legacy claim rows without an exact source match remain reachable through the product card.
  const sources: Array<[MutableDocumentEntityType, GuardDb[keyof GuardDb], string]> = [
    ["SupplierDebitNote", database.supplierDebitNote, "debitNo"],
    ["Purchase", database.purchase, "purchaseNo"], ["Sale", database.sale, "saleNo"],
    ["CreditNote", database.creditNote, "cnNo"], ["PurchaseReturn", database.purchaseReturn, "returnNo"],
    ["Adjustment", database.adjustment, "adjustNo"], ["BalanceForward", database.balanceForward, "docNo"],
  ];
  const references: MutationBlockReference[] = [];
  for (const [entityType, delegate, refField] of sources) {
    if (!delegate) continue;
    const rows = await delegate.findMany({ where: { [refField]: { in: docNos } }, select: { id: true, [refField]: true } });
    references.push(...mapDirectRefs(rows, entityType, refField));
  }
  const matched = new Set(references.map((ref) => ref.refNo));
  for (const row of later) {
    const productId = stringValue(row.productId);
    const docNo = stringValue(row.docNo);
    if (productId && docNo && !matched.has(docNo)) references.push({ entityType: "StockCard", id: productId, refNo: docNo });
  }
  return block(DEBIT_LATER_STOCK_REASON, uniqueRefs(references));
}

async function checkEntityStockBoundary(database: GuardDb, entityType: MutableDocumentEntityType,
  entityId: string): Promise<MutationBlockResult> {
  if (!database.stockCard) return allow();
  const source: Partial<Record<MutableDocumentEntityType, [GuardDb[keyof GuardDb], string]>> = {
    Purchase: [database.purchase, "purchaseNo"], Sale: [database.sale, "saleNo"],
    SupplierDebitNote: [database.supplierDebitNote, "debitNo"], CreditNote: [database.creditNote, "cnNo"],
    PurchaseReturn: [database.purchaseReturn, "returnNo"], Adjustment: [database.adjustment, "adjustNo"],
    BalanceForward: [database.balanceForward, "docNo"], WarrantyClaim: [database.warrantyClaim, "claimNo"],
  };
  const spec = source[entityType];
  if (!spec?.[0]) return allow();
  const docs = await spec[0].findMany({ where: { id: entityId }, select: { [spec[1]]: true } });
  const docNo = stringValue(docs[0]?.[spec[1]]);
  if (!docNo) return allow();
  const rows = await database.stockCard.findMany({
    where: entityType === "WarrantyClaim" ? { OR: [{ referenceId: entityId }, { docNo: { startsWith: docNo } }] } : { docNo },
    select: stockBoundarySelect,
  });
  return checkStockRowsBoundary(database, rows.map(stockBoundaryRow).filter((row): row is StockBoundaryRow => Boolean(row)), entityType === "SupplierDebitNote");
}

export class DocumentMutationBlockedError extends Error {
  constructor(message: string) { super(message); this.name = "DocumentMutationBlockedError"; }
}

/** Acquire the same sorted SKU locks as DN posting before checking frozen stock coverage. */
export async function lockStockMutationProducts(tx: Prisma.TransactionClient, productIds: readonly string[]): Promise<void> {
  const ids = [...new Set(productIds)].sort();
  if (ids.length === 0) return;
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Product" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`);
}

export async function assertDocumentMutationAllowedInTx(tx: Prisma.TransactionClient,
  entityType: MutableDocumentEntityType, entityId: string, action: DocumentMutationAction): Promise<void> {
  const result = await createDocumentMutationGuard(tx as unknown as GuardDb).check(entityType, entityId, action);
  const message = buildMutationBlockMessage(result);
  if (message) throw new DocumentMutationBlockedError(message);
}

/** Bulk purchase insertion must obey the same backdating boundary as writeStockCard. */
export async function assertStockWriteDateAllowed(tx: Prisma.TransactionClient,
  productIds: readonly string[], docDate: Date): Promise<void> {
  const rows = await tx.stockCard.findMany({
    where: { productId: { in: [...new Set(productIds)] }, source: "SUPPLIER_DEBIT", docDate: { gt: docDate } },
    select: { docNo: true },
  });
  if (rows.length === 0) return;
  const debits = await tx.supplierDebitNote.findMany({
    where: { debitNo: { in: rows.map((row) => row.docNo) }, status: "ACTIVE" }, select: { id: true, debitNo: true },
  });
  const result = block(STOCK_BOUNDARY_REASON, mapDirectRefs(debits, "SupplierDebitNote", "debitNo"));
  const message = buildMutationBlockMessage(result);
  if (message) throw new DocumentMutationBlockedError(message);
}

export function createDocumentMutationGuard(database: GuardDb) {
  return {
    async check(
      entityType: MutableDocumentEntityType,
      entityId: string,
      action: DocumentMutationAction,
    ): Promise<MutationBlockResult> {
      if (!entityId) return allow();

      const stockBoundary = await checkEntityStockBoundary(database, entityType, entityId);
      if (stockBoundary.blocked) return stockBoundary;

      if (entityType === "SupplierDebitNote") {
        const payments = await database.supplierPaymentItem?.findMany({
          where: { debitNoteId: entityId, payment: { status: "ACTIVE" } },
          select: { payment: { select: { id: true, paymentNo: true } } },
        }) ?? [];
        return block("ถูกนำไปใช้ที่เอกสารจ่ายชำระ", uniqueRefs(mapNestedRefs(payments, "payment", "SupplierPayment", "paymentNo")));
      }

      if (entityType === "SalesQuotation") {
        const sales = await database.sale?.findMany({ where: { activeQuotationId: entityId, status: "ACTIVE" }, select: { id: true, saleNo: true } }) ?? [];
        return block("ถูกนำไปใช้ที่ใบขาย", mapDirectRefs(sales, "Sale", "saleNo"));
      }
      if (entityType === "Sale") {
        const [creditNotes, receiptItems, claims, settlements, commissionItems] = await Promise.all([
          database.creditNote?.findMany({
            where: { saleId: entityId, status: "ACTIVE" },
            select: { id: true, cnNo: true },
          }) ?? Promise.resolve([]),
          database.receiptItem?.findMany({
            where: { saleId: entityId, receipt: { status: "ACTIVE" } },
            select: { receipt: { select: { id: true, receiptNo: true } } },
          }) ?? Promise.resolve([]),
          // Claims block cancelling the sale — any claim, whatever its status: claims on
          // sale warranties are deleted when cancelled, and a kept (on-site) claim row
          // would still hold the warranty the cancel deletes. They do NOT block an edit:
          // updateSale locks only the claimed lines (see sale-claim-lock.ts).
          action === "update"
            ? Promise.resolve([])
            : (database.warrantyClaim?.findMany({
                where: { warranty: { saleId: entityId } },
                select: { id: true, claimNo: true },
              }) ?? Promise.resolve([])),
          database.marketplaceSettlementLine?.findMany({
            where: { saleId: entityId, activeSaleId: { not: null }, settlement: { status: "ACTIVE" } },
            select: { settlement: { select: { id: true, settlementNo: true } } },
          }) ?? Promise.resolve([]),
          // A bill held by an ACTIVE delivery commission run has had its commission paid.
          database.deliveryCommissionItem?.findMany({
            where: { activeSaleId: entityId, run: { status: "ACTIVE" } },
            select: { run: { select: { id: true, runNo: true } } },
          }) ?? Promise.resolve([]),
        ]);
        const otherRefs = [
          ...mapDirectRefs(creditNotes, "CreditNote", "cnNo"),
          ...mapNestedRefs(receiptItems, "receipt", "Receipt", "receiptNo"),
          ...mapDirectRefs(claims, "WarrantyClaim", "claimNo"),
          ...mapNestedRefs(settlements, "settlement", "MarketplaceSettlement", "settlementNo"),
        ];
        const commissionRefs = uniqueRefs(
          mapNestedRefs(commissionItems, "run", "DeliveryCommissionRun", "runNo"),
        );
        return block(
          otherRefs.length === 0 && commissionRefs.length > 0
            ? DELIVERY_COMMISSION_SALE_REASON
            : "ถูกนำไปใช้ที่เอกสารปลายทาง",
          [...otherRefs, ...commissionRefs],
        );
      }

      if (entityType === "Purchase") {
        const [returns, payments, debits] = await Promise.all([
          database.purchaseReturn?.findMany({
            where: { purchaseId: entityId, status: "ACTIVE" },
            select: { id: true, returnNo: true },
          }) ?? Promise.resolve([]),
          database.supplierPaymentItem?.findMany({
            where: { purchaseId: entityId, payment: { status: "ACTIVE" } },
            select: { payment: { select: { id: true, paymentNo: true } } },
          }) ?? Promise.resolve([]),
          database.supplierDebitNote?.findMany({
            where: { purchaseId: entityId, status: "ACTIVE" },
            select: { id: true, debitNo: true },
          }) ?? Promise.resolve([]),
        ]);
        return block("ถูกนำไปใช้ที่เอกสารปลายทาง", [
          ...mapDirectRefs(returns, "PurchaseReturn", "returnNo"),
          ...mapDirectRefs(debits, "SupplierDebitNote", "debitNo"),
          ...mapNestedRefs(payments, "payment", "SupplierPayment", "paymentNo"),
        ]);
      }

      if (entityType === "CreditNote") {
        const [receiptItems, settlements, expenses] = await Promise.all([
          database.receiptItem?.findMany({
            where: { cnId: entityId, receipt: { status: "ACTIVE" } },
            select: { receipt: { select: { id: true, receiptNo: true } } },
          }) ?? Promise.resolve([]),
          database.marketplaceSettlementLine?.findMany({
            where: {
              creditNoteId: entityId,
              activeCreditNoteId: { not: null },
              settlement: { status: "ACTIVE" },
            },
            select: { settlement: { select: { id: true, settlementNo: true } } },
          }) ?? Promise.resolve([]),
          database.expense?.findMany({
            where: { marketplaceReturnCreditNoteId: entityId, status: "ACTIVE" },
            select: { id: true, expenseNo: true },
          }) ?? Promise.resolve([]),
        ]);
        return block("ถูกนำไปใช้ที่เอกสารปลายทาง", [
          ...mapNestedRefs(receiptItems, "receipt", "Receipt", "receiptNo"),
          ...mapNestedRefs(settlements, "settlement", "MarketplaceSettlement", "settlementNo"),
          ...mapDirectRefs(expenses, "Expense", "expenseNo"),
        ]);
      }

      // ใบค่าธรรมเนียม / ใบโอนเงิน / ใบปรับยอด ที่ถูกสร้างโดยรอบรับเงิน marketplace
      // ต้องยกเลิกผ่านการยกเลิกรอบเท่านั้น มิฉะนั้นเอกสารรอบจะยัง ACTIVE ทั้งที่
      // ค่าธรรมเนียมหายไปแล้ว ทำให้ทั้งกำไรและยอดบัญชีพักเงินเพี้ยน
      if (
        entityType === "Expense" ||
        entityType === "CashBankTransfer" ||
        entityType === "CashBankAdjustment"
      ) {
        const field =
          entityType === "Expense"
            ? "expenseId"
            : entityType === "CashBankTransfer"
              ? "cashBankTransferId"
              : "cashBankAdjustmentId";
        const [settlements, commissionRuns] = await Promise.all([
          database.marketplaceSettlement?.findMany({
            where: { [field]: entityId, status: "ACTIVE" },
            select: { id: true, settlementNo: true },
          }) ?? Promise.resolve([]),
          // The expense a delivery commission run created is cancelled by cancelling
          // the run (cancelDeliveryCommissionRun updates it directly, not via this guard).
          entityType === "Expense"
            ? (database.deliveryCommissionRun?.findMany({
                where: { expenseId: entityId, status: "ACTIVE" },
                select: { id: true, runNo: true },
              }) ?? Promise.resolve([]))
            : Promise.resolve([]),
        ]);
        const settlementRefs = mapDirectRefs(settlements, "MarketplaceSettlement", "settlementNo");
        const commissionRefs = mapDirectRefs(commissionRuns, "DeliveryCommissionRun", "runNo");
        return block(
          settlementRefs.length === 0 && commissionRefs.length > 0
            ? DELIVERY_COMMISSION_EXPENSE_REASON
            : MARKETPLACE_SETTLEMENT_SOURCE_REASON,
          [...settlementRefs, ...commissionRefs],
        );
      }

      if (entityType === "PurchaseReturn") {
        const paymentItems =
          (await database.supplierPaymentItem?.findMany({
          where: { purchaseReturnId: entityId, payment: { status: "ACTIVE" },
            },
          select: { payment: { select: { id: true, paymentNo: true } } },
        })) ?? [];
        return block(
          "ถูกนำไปใช้ที่เอกสารจ่ายชำระ",
          uniqueRefs(mapNestedRefs(paymentItems, "payment", "SupplierPayment", "paymentNo",
            ),
          ),
        );
      }

      if (entityType === "SupplierAdvance") {
        const [paymentItems, refunds] = await Promise.all([
          database.supplierPaymentItem?.findMany({
          where: { advanceId: entityId, payment: { status: "ACTIVE" } },
          select: { payment: { select: { id: true, paymentNo: true } } },
        }) ?? Promise.resolve([]),
          action === "cancel"
            ? (database.supplierAdvanceRefund?.findMany({
                where: { supplierAdvanceId: entityId, status: "ACTIVE" },
                select: { id: true, refundNo: true },
              }) ?? Promise.resolve([]))
            : Promise.resolve([]),
        ]);
        return block(
          refunds.length > 0
            ? "ถูกนำไปใช้ที่เอกสารปลายทาง"
            : "ถูกนำไปใช้ที่เอกสารจ่ายชำระ",
          uniqueRefs([
            ...mapNestedRefs(paymentItems, "payment", "SupplierPayment", "paymentNo",
            ),
            ...mapDirectRefs(refunds, "SupplierAdvanceRefund", "refundNo"),
          ]),
        );
      }

      if (entityType === "CustomerAdvance") {
        const [receiptItems, refunds] = await Promise.all([
          database.receiptItem?.findMany({
          where: { customerAdvanceId: entityId, receipt: { status: "ACTIVE" },
            },
          select: { receipt: { select: { id: true, receiptNo: true } } },
        }) ?? Promise.resolve([]),
          action === "cancel"
            ? (database.customerAdvanceRefund?.findMany({
                where: { customerAdvanceId: entityId, status: "ACTIVE" },
                select: { id: true, refundNo: true },
              }) ?? Promise.resolve([]))
            : Promise.resolve([]),
        ]);
        return block(
          refunds.length > 0
            ? "ถูกนำไปใช้ที่เอกสารปลายทาง"
            : "ถูกนำไปใช้ที่ใบเสร็จรับเงิน",
          uniqueRefs([
            ...mapNestedRefs(receiptItems, "receipt", "Receipt", "receiptNo"),
            ...mapDirectRefs(refunds, "CustomerAdvanceRefund", "refundNo"),
          ]),
        );
      }

      if (entityType === "WarrantyClaim") {
        const returns =
          (await database.purchaseReturn?.findMany({
          where: { claimId: entityId, status: "ACTIVE" },
          select: { id: true, returnNo: true },
        })) ?? [];
        return block("ถูกนำไปใช้ที่ใบลดหนี้ซื้อ", mapDirectRefs(returns, "PurchaseReturn", "returnNo"),
        );
      }

      return allow();
    },
  };
}

export async function checkDocumentMutation(
  entityType: MutableDocumentEntityType,
  entityId: string,
  action: DocumentMutationAction,
): Promise<MutationBlockResult> {
  const { db } = await import("@/lib/db");
  return createDocumentMutationGuard(db as unknown as GuardDb).check(entityType, entityId, action,
  );
}

export async function getDocumentMutationBlockMessage(
  entityType: MutableDocumentEntityType,
  entityId: string,
  action: DocumentMutationAction,
): Promise<string | null> {
  const result = await checkDocumentMutation(entityType, entityId, action);
  return buildMutationBlockMessage(result);
}
