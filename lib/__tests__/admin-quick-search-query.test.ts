import assert from "node:assert/strict";
import test from "node:test";

import { buildQuickSearchGroups, type QuickSearchRow } from "@/lib/admin-quick-search-query";

test("quick-search union rows preserve existing labels, links and status suffixes", () => {
  const rows: QuickSearchRow[] = [
    { groupKey: "sales", id: "s1", label: "SO-1", secondary: "Alice", extra: null, status: "CANCELLED", isActive: null },
    { groupKey: "purchases", id: "p1", label: "PO-1", secondary: "Vendor", extra: "REF-1", status: "ACTIVE", isActive: null },
    { groupKey: "products", id: "x1", label: "P001 — Compressor", secondary: null, extra: null, status: null, isActive: false },
    { groupKey: "customers", id: "c1", label: "Bob", secondary: "C001", extra: "080", status: null, isActive: true },
    { groupKey: "customer_advances", id: "a1", label: "SD26080001", secondary: "Bob", extra: null, status: "ACTIVE", isActive: null },
    { groupKey: "customer_advance_refunds", id: "r1", label: "CNSD26080001", secondary: "Bob", extra: "SD26080001", status: "ACTIVE", isActive: null },
    { groupKey: "supplier_advance_refunds", id: "r2", label: "CNADV26080001", secondary: "Vendor", extra: "ADV26080001", status: "CANCELLED", isActive: null },
  ];

  assert.deepEqual(buildQuickSearchGroups(rows), [
    { key: "sales", label: "ใบขาย", items: [{ id: "sale:s1", label: "SO-1", sublabel: "Alice · (ยกเลิก)", href: "/admin/sales/s1" }] },
    { key: "purchases", label: "ใบซื้อ", items: [{ id: "purchase:p1", label: "PO-1", sublabel: "Vendor · REF-1", href: "/admin/purchases/p1" }] },
    { key: "customer_advances", label: "รับเงินมัดจำลูกค้า", items: [{ id: "customer-advance:a1", label: "SD26080001", sublabel: "Bob", href: "/admin/customer-advances/a1" }] },
    { key: "customer_advance_refunds", label: "คืนเงินมัดจำลูกค้า", items: [{ id: "customer-advance-refund:r1", label: "CNSD26080001", sublabel: "Bob · SD26080001", href: "/admin/customer-advance-refunds/r1" }] },
    { key: "supplier_advance_refunds", label: "รับคืนเงินมัดจำซัพพลายเออร์", items: [{ id: "supplier-advance-refund:r2", label: "CNADV26080001", sublabel: "Vendor · ADV26080001 · (ยกเลิก)", href: "/admin/supplier-advance-refunds/r2" }] },
    { key: "products", label: "สินค้า", items: [{ id: "product:x1", label: "P001 — Compressor", sublabel: "(ปิดการใช้งาน)", href: "/admin/products/x1/preview" }] },
    { key: "customers", label: "ลูกค้า", items: [{ id: "customer:c1", label: "Bob", sublabel: "C001 · 080", href: "/admin/customers/c1" }] },
  ]);
});
