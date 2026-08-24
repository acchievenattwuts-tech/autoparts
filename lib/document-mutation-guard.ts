export type MutableDocumentEntityType =
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
  | "ShopeeSettlement";

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

type GuardDb = {
  creditNote?: { findMany(args: FindManyArgs): FindManyResult };
  receiptItem?: { findMany(args: FindManyArgs): FindManyResult };
  warrantyClaim?: { findMany(args: FindManyArgs): FindManyResult };
  purchaseReturn?: { findMany(args: FindManyArgs): FindManyResult };
  supplierPaymentItem?: { findMany(args: FindManyArgs): FindManyResult };
  supplierAdvanceRefund?: { findMany(args: FindManyArgs): FindManyResult };
  customerAdvanceRefund?: { findMany(args: FindManyArgs): FindManyResult };
  shopeeSettlementSale?: { findMany(args: FindManyArgs): FindManyResult };
};

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
  ShopeeSettlement: "/admin/sales/shopee/settlements",
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

      if (entityType === "Sale") {
        const [creditNotes, receiptItems, claims, settlements] = await Promise.all([
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
          database.shopeeSettlementSale?.findMany({
            where: { saleId: entityId, activeSaleId: { not: null }, settlement: { status: "ACTIVE" } },
            select: { settlement: { select: { id: true, settlementNo: true } } },
          }) ?? Promise.resolve([]),
        ]);
        return block("ถูกนำไปใช้ที่เอกสารปลายทาง", [
          ...mapDirectRefs(creditNotes, "CreditNote", "cnNo"),
          ...mapNestedRefs(receiptItems, "receipt", "Receipt", "receiptNo"),
          ...mapDirectRefs(claims, "WarrantyClaim", "claimNo"),
          ...mapNestedRefs(settlements, "settlement", "ShopeeSettlement", "settlementNo"),
        ]);
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
        const receiptItems =
          (await database.receiptItem?.findMany({
          where: { cnId: entityId, receipt: { status: "ACTIVE" } },
          select: { receipt: { select: { id: true, receiptNo: true } } },
        })) ?? [];
        return block("ถูกนำไปใช้ที่ใบเสร็จรับเงิน", mapNestedRefs(receiptItems, "receipt", "Receipt", "receiptNo"),
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
