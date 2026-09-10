import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { quotationSchema } from "@/lib/sales-quotation-form";
import type { AuditLogInput } from "@/lib/audit-log";

test("SQ revisions log complete before/after values, skip no-op saves and reject stale or referenced edits", async () => {
  let permitted = true;
  let writes = 0;
  const audits: AuditLogInput[] = [];
  const data = quotationSchema.parse({ quotationDate: "2026-09-07", customerId: "c1", customerName: "ลูกค้า", creditTerm: 30, discount: 0, note: "เดิม", vatType: "NO_VAT", vatRate: 7, items: [{ productId: "p1", unitName: "ชิ้น", qty: 2, salePrice: 100, unitListPrice: 100 }] });
  const quote = { id: "sq1", quotationNo: "SQ26090001", revision: 0, ...data, quotationDate: new Date("2026-09-06T17:00:00Z"), status: "ACTIVE", activeSale: null as { id: string; saleNo: string } | null,
    totalAmount: 200, subtotalAmount: 200, vatAmount: 0, netAmount: 200,
    items: [{ id: "qi1", lineNo: 0, productId: "p1", showUnitName: "ชิ้น", showQty: 2, unitScale: 1, quantity: 2, salePrice: 100, unitListPrice: 100, lineDiscount: 0, totalAmount: 200, moreDetail: "", priceListId: null, pricePromotionId: null }],
  };
  const tx = {
    $queryRaw: async () => [],
    customer: { findUnique: async () => ({ isActive: true }) },
    user: { findUnique: async () => ({ name: "ผู้ทำเอกสาร", signatureUrl: "products/users/signatures/u1.png" }) },
    product: { findMany: async () => [{ id: "p1", code: "P1", name: "สินค้าทดสอบ", isActive: true, units: [{ name: "ชิ้น", scale: 1 }] }] },
    salesQuotation: {
      findUnique: async () => structuredClone(quote),
      update: async ({ data: values }: { data: Record<string, unknown> }) => {
        writes++;
        if (values.revision) quote.revision++;
        if (typeof values.note === "string") quote.note = values.note;
        return structuredClone(quote);
      },
    },
  };
  await mock.module("@/lib/db", { namedExports: { db: tx, dbTx: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx) } });
  await mock.module("@/lib/require-auth", { namedExports: {
    requirePermission: async () => { if (!permitted) throw new Error("denied"); return { user: { id: "u1", name: "ผู้บันทึกล่าสุด" } }; }, requireAnyPermission: async () => ({}),
  } });
  await mock.module("next/cache", { namedExports: { revalidatePath: () => undefined } });
  await mock.module("@/lib/audit-log", { namedExports: { getAuditActorFromSession: () => ({ userId: "u1" }), getRequestContext: async () => ({}), writeAuditLogTx: async (_tx: unknown, audit: AuditLogInput) => { audits.push(audit); } } });
  await mock.module("@/lib/transaction-product-search", { namedExports: { searchTransactionProductDetailRows: async () => [] } });
  await mock.module("@/lib/transaction-options", { namedExports: { getSaleProductOptionsByIds: async () => [] } });
  const { saveQuotation, cancelQuotation } = await import("../actions");
  const savedNumber = (result: Awaited<ReturnType<typeof saveQuotation>>) => "quotationNo" in result ? result.quotationNo : "";
  const failure = (result: Awaited<ReturnType<typeof saveQuotation>>) => "error" in result ? result.error : "";
  assert.equal(savedNumber(await saveQuotation(data, "sq1", 0)), "SQ26090001");
  assert.equal(writes, 0);
  assert.equal(audits.length, 0);
  const changed = { ...data, note: "แก้ครั้งแรก" };
  assert.equal(savedNumber(await saveQuotation(changed, "sq1", 0)), "SQ26090001 Rev.01");
  assert.equal(writes, 1);
  assert.equal((audits[0].before as { revision: number; note: string }).revision, 0);
  assert.equal((audits[0].before as { note: string }).note, "เดิม");
  assert.equal((audits[0].after as { revision: number; items: unknown[] }).revision, 1);
  assert.equal((audits[0].after as { items: unknown[] }).items.length, 1);
  assert.match(failure(await saveQuotation({ ...changed, note: "ข้อมูลเก่า" }, "sq1", 0)), /Revision ใหม่/);
  assert.equal(writes, 1);
  quote.activeSale = { id: "sale1", saleNo: "SA26090001" };
  assert.match(failure(await saveQuotation({ ...changed, note: "แก้อีก" }, "sq1", 1)), /SA26090001/);
  assert.match((await cancelQuotation("sq1", "ทดสอบ")).error ?? "", /SA26090001/);
  assert.equal(writes, 1);
  permitted = false;
  assert.match(failure(await saveQuotation(data)), /ไม่มีสิทธิ์/);
  assert.equal(writes, 1);
});
