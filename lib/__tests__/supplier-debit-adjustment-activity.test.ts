import assert from "node:assert/strict";
import test, { before, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";

/** §8.7 relation map for "ปรับยอด DN": Parent -> Adjustment -> Payment (credit used) / cash refund. */
const mocksUnavailable = typeof (mock as { module?: unknown }).module !== "function" && "requires module mocks";
const at = (minute: number): Date => new Date(Date.UTC(2026, 8, 30, 3, minute));
const purchase = { id: "po-1", purchaseNo: "PU26080001", createdAt: at(0) };
const heads: Record<string, unknown> = {
  dn: { netAmount: new Prisma.Decimal(500), cashBankAccount: null, purchase, adjustsDebitNote: null },
  "adj-1": { netAmount: new Prisma.Decimal(-200), cashBankAccount: { name: "KBank" }, purchase,
    adjustsDebitNote: { id: "dn", debitNo: "SDN26080001", createdAt: at(1) } },
};
let activity: typeof import("@/lib/document-activity");

before(async () => {
  if (mocksUnavailable) return;
  await mock.module("@/lib/db", { namedExports: { db: {
    auditLog: { findMany: async () => [] },
    supplierDebitNote: {
      findUnique: async ({ where }: { where: { id: string } }) => heads[where.id] ?? null,
      findMany: async ({ where }: { where: { adjustsDebitNoteId: string } }) => where.adjustsDebitNoteId === "dn"
        ? [{ id: "adj-1", debitNo: "SDN26090002", createdAt: at(2), netAmount: new Prisma.Decimal(-200) }] : [],
    },
    supplierPaymentItem: { findMany: async ({ where }: { where: { debitNoteId?: string; paymentId?: string } }) => {
      if (where.paymentId === "pay-2") return [{ paidAmount: new Prisma.Decimal(200), purchase: null, purchaseReturn: null, advance: null,
        debitNote: { id: "adj-1", debitNo: "SDN26090002", postingDate: at(2), createdAt: at(2), netAmount: new Prisma.Decimal(-200) } }];
      return where.debitNoteId === "adj-1"
        ? [{ paidAmount: new Prisma.Decimal(50), payment: { id: "pay-2", paymentNo: "SP26090002", createdAt: at(3) } }] : [];
    } },
    documentPayment: { findMany: async () => [{ id: "dp-1", amount: new Prisma.Decimal(150), createdAt: at(2) }] },
  } } });
  activity = await import("@/lib/document-activity");
});

test("the parent DN lists its ปรับยอด DN as a downstream document", { skip: mocksUnavailable }, async () => {
  const events = await activity.getDocumentActivityTimeline("SupplierDebitNote", "dn");
  const adjusted = events.find((event) => event.hrefLabel === "SDN26090002");
  assert.deepEqual(adjusted && [adjusted.kind, adjusted.title, adjusted.href], ["USED_BY", "ถูกปรับยอดโดยเอกสารปรับยอด DN", "/admin/supplier-debit-notes/adj-1"]);
});

test("the adjustment links back to its parent and shows the credit used and the cash refunded", { skip: mocksUnavailable }, async () => {
  const events = await activity.getDocumentActivityTimeline("SupplierDebitNote", "adj-1");
  const byTitle = new Map(events.map((event) => [event.title, event]));
  assert.equal(byTitle.get("ปรับยอดจากใบเพิ่มหนี้")?.href, "/admin/supplier-debit-notes/dn");
  assert.equal(byTitle.get("เครดิตถูกนำไปหักที่จ่ายชำระเจ้าหนี้")?.hrefLabel, "SP26090002");
  assert.match(byTitle.get("รับเงินคืนจากซัพพลายเออร์")?.description ?? "", /150\.00 บาท เข้าบัญชี KBank/);
});

test("the payment shows the adjustment credit it used, not a DN payable", { skip: mocksUnavailable }, async () => {
  const events = await activity.getDocumentActivityTimeline("SupplierPayment", "pay-2");
  assert.deepEqual(events.map((event) => [event.title, event.hrefLabel]), [["ใช้เครดิตจากเอกสารปรับยอด DN", "SDN26090002"]]);
});
