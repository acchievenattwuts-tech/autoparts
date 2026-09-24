export type MutableDocumentEntityType =
  | "SalesQuotation"
  | "Sale"
  | "Purchase"
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
    href: `${ENTITY_ROUTE[ref.entityType]}/${ref.id}`,
    label: ref.refNo,
  }));
}

export function createDocumentMutationGuard(database: GuardDb) {
  return {
    async check(
      entityType: MutableDocumentEntityType,
      entityId: string,
      action: DocumentMutationAction,
    ): Promise<MutationBlockResult> {
      if (!entityId) return allow();

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
          database.warrantyClaim?.findMany({
            where: { warranty: { saleId: entityId }, status: { not: "CANCELLED" },
            },
            select: { id: true, claimNo: true },
          }) ?? Promise.resolve([]),
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
        const [returns, payments] = await Promise.all([
          database.purchaseReturn?.findMany({
            where: { purchaseId: entityId, status: "ACTIVE" },
            select: { id: true, returnNo: true },
          }) ?? Promise.resolve([]),
          database.supplierPaymentItem?.findMany({
            where: { purchaseId: entityId, payment: { status: "ACTIVE" } },
            select: { payment: { select: { id: true, paymentNo: true } } },
          }) ?? Promise.resolve([]),
        ]);
        return block("ถูกนำไปใช้ที่เอกสารปลายทาง", [
          ...mapDirectRefs(returns, "PurchaseReturn", "returnNo"),
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
