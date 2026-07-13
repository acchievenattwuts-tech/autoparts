import { Prisma } from "@/lib/generated/prisma";

export type QuickSearchAccess = {
  sales: boolean;
  purchases: boolean;
  purchaseReturns: boolean;
  creditNotes: boolean;
  receipts: boolean;
  supplierAdvances: boolean;
  supplierPayments: boolean;
  expenses: boolean;
  warrantyClaims: boolean;
  products: boolean;
  customers: boolean;
  suppliers: boolean;
};

type QuickSearchGroupKey =
  | "sales" | "purchases" | "purchase_returns" | "credit_notes" | "receipts"
  | "supplier_advances" | "supplier_payments" | "expenses" | "warranty_claims"
  | "products" | "customers" | "suppliers";

export type QuickSearchRow = {
  groupKey: QuickSearchGroupKey;
  id: string;
  label: string;
  secondary: string | null;
  extra: string | null;
  status: string | null;
  isActive: boolean | null;
};

export type QuickSearchResultItem = { id: string; label: string; sublabel?: string; href: string };
export type QuickSearchResultGroup = { key: string; label: string; items: QuickSearchResultItem[] };

const cancelledSuffix = (status: string | null): string | null =>
  status === "CANCELLED" ? "(ยกเลิก)" : null;

const compactSublabel = (...parts: Array<string | null | undefined>): string | undefined =>
  parts.filter(Boolean).join(" · ") || undefined;

export function buildQuickSearchGroups(rows: QuickSearchRow[]): QuickSearchResultGroup[] {
  const configs: Array<{
    key: QuickSearchGroupKey;
    label: string;
    item: (row: QuickSearchRow) => QuickSearchResultItem;
  }> = [
    { key: "sales", label: "ใบขาย", item: (r) => ({ id: `sale:${r.id}`, label: r.label, sublabel: compactSublabel(r.secondary, cancelledSuffix(r.status)), href: `/admin/sales/${r.id}` }) },
    { key: "purchases", label: "ใบซื้อ", item: (r) => ({ id: `purchase:${r.id}`, label: r.label, sublabel: compactSublabel(r.secondary, r.extra, cancelledSuffix(r.status)), href: `/admin/purchases/${r.id}` }) },
    { key: "purchase_returns", label: "ใบคืนซื้อ", item: (r) => ({ id: `purchase-return:${r.id}`, label: r.label, sublabel: compactSublabel(r.secondary, cancelledSuffix(r.status)), href: `/admin/purchase-returns/${r.id}` }) },
    { key: "credit_notes", label: "CN ขาย", item: (r) => ({ id: `cn:${r.id}`, label: r.label, sublabel: r.secondary ?? undefined, href: `/admin/credit-notes/${r.id}` }) },
    { key: "receipts", label: "ใบเสร็จรับเงิน", item: (r) => ({ id: `receipt:${r.id}`, label: r.label, sublabel: compactSublabel(r.secondary, cancelledSuffix(r.status)), href: `/admin/receipts/${r.id}` }) },
    { key: "supplier_advances", label: "เงินมัดจำซัพพลายเออร์", item: (r) => ({ id: `advance:${r.id}`, label: r.label, sublabel: compactSublabel(r.secondary, cancelledSuffix(r.status)), href: `/admin/supplier-advances/${r.id}` }) },
    { key: "supplier_payments", label: "จ่ายชำระซัพพลายเออร์", item: (r) => ({ id: `payment:${r.id}`, label: r.label, sublabel: compactSublabel(r.secondary, cancelledSuffix(r.status)), href: `/admin/supplier-payments/${r.id}` }) },
    { key: "expenses", label: "ค่าใช้จ่าย", item: (r) => ({ id: `expense:${r.id}`, label: r.label, sublabel: compactSublabel(r.secondary, cancelledSuffix(r.status)), href: `/admin/expenses/${r.id}` }) },
    { key: "warranty_claims", label: "ใบเคลม", item: (r) => ({ id: `claim:${r.id}`, label: r.label, sublabel: r.secondary ?? undefined, href: `/admin/warranty-claims/${r.id}` }) },
    { key: "products", label: "สินค้า", item: (r) => ({ id: `product:${r.id}`, label: r.label, sublabel: r.isActive === false ? "(ปิดการใช้งาน)" : undefined, href: `/admin/products/${r.id}/preview` }) },
    { key: "customers", label: "ลูกค้า", item: (r) => ({ id: `customer:${r.id}`, label: r.label, sublabel: compactSublabel(r.secondary, r.extra, r.isActive === false ? "(ปิดการใช้งาน)" : null), href: `/admin/customers/${r.id}` }) },
    { key: "suppliers", label: "ซัพพลายเออร์", item: (r) => ({ id: `supplier:${r.id}`, label: r.label, sublabel: compactSublabel(r.secondary, r.isActive === false ? "(ปิดการใช้งาน)" : null), href: "/admin/master/suppliers" }) },
  ];

  return configs.flatMap((config) => {
    const items = rows.filter((row) => row.groupKey === config.key).map(config.item);
    return items.length > 0 ? [{ key: config.key, label: config.label, items }] : [];
  });
}

export async function queryAdminQuickSearchRows(input: {
  query: string;
  docOnly: boolean;
  access: QuickSearchAccess;
  take: number;
}): Promise<QuickSearchRow[]> {
  const pattern = `%${input.query}%`;
  const branches: Prisma.Sql[] = [];
  const add = (enabled: boolean, sql: Prisma.Sql) => { if (enabled) branches.push(sql); };

  add(input.access.sales, Prisma.sql`(SELECT 10 AS group_order, 'sales'::text AS "groupKey", s.id, s."saleNo" AS label, s."customerName" AS secondary, NULL::text AS extra, s.status::text AS status, NULL::boolean AS "isActive", s."saleDate" AS sort_date, NULL::text AS sort_name FROM "Sale" s WHERE s."saleNo" ILIKE ${pattern} ${input.docOnly ? Prisma.empty : Prisma.sql`OR s."customerName" ILIKE ${pattern} OR s."customerPhone" ILIKE ${pattern}`} ORDER BY s."saleDate" DESC LIMIT ${input.take})`);
  add(input.access.purchases, Prisma.sql`(SELECT 20, 'purchases'::text, p.id, p."purchaseNo", s.name, p."referenceNo", p.status::text, NULL::boolean, p."purchaseDate", NULL::text FROM "Purchase" p LEFT JOIN "Supplier" s ON s.id=p."supplierId" WHERE p."purchaseNo" ILIKE ${pattern} ${input.docOnly ? Prisma.empty : Prisma.sql`OR p."referenceNo" ILIKE ${pattern} OR s.name ILIKE ${pattern}`} ORDER BY p."purchaseDate" DESC LIMIT ${input.take})`);
  add(input.access.purchaseReturns, Prisma.sql`(SELECT 30, 'purchase_returns'::text, r.id, r."returnNo", s.name, NULL::text, r.status::text, NULL::boolean, r."returnDate", NULL::text FROM "PurchaseReturn" r LEFT JOIN "Supplier" s ON s.id=r."supplierId" WHERE r."returnNo" ILIKE ${pattern} ${input.docOnly ? Prisma.empty : Prisma.sql`OR s.name ILIKE ${pattern}`} ORDER BY r."returnDate" DESC LIMIT ${input.take})`);
  add(input.access.creditNotes, Prisma.sql`(SELECT 40, 'credit_notes'::text, c.id, c."cnNo", c."customerName", NULL::text, NULL::text, NULL::boolean, c."cnDate", NULL::text FROM "CreditNote" c WHERE c."cnNo" ILIKE ${pattern} ${input.docOnly ? Prisma.empty : Prisma.sql`OR c."customerName" ILIKE ${pattern}`} ORDER BY c."cnDate" DESC LIMIT ${input.take})`);
  add(input.access.receipts, Prisma.sql`(SELECT 50, 'receipts'::text, r.id, r."receiptNo", r."customerName", NULL::text, r.status::text, NULL::boolean, r."receiptDate", NULL::text FROM "Receipt" r WHERE r."receiptNo" ILIKE ${pattern} ${input.docOnly ? Prisma.empty : Prisma.sql`OR r."customerName" ILIKE ${pattern}`} ORDER BY r."receiptDate" DESC LIMIT ${input.take})`);
  add(input.access.supplierAdvances, Prisma.sql`(SELECT 60, 'supplier_advances'::text, a.id, a."advanceNo", s.name, NULL::text, a.status::text, NULL::boolean, a."advanceDate", NULL::text FROM "SupplierAdvance" a LEFT JOIN "Supplier" s ON s.id=a."supplierId" WHERE a."advanceNo" ILIKE ${pattern} ${input.docOnly ? Prisma.empty : Prisma.sql`OR s.name ILIKE ${pattern}`} ORDER BY a."advanceDate" DESC LIMIT ${input.take})`);
  add(input.access.supplierPayments, Prisma.sql`(SELECT 70, 'supplier_payments'::text, p.id, p."paymentNo", s.name, NULL::text, p.status::text, NULL::boolean, p."paymentDate", NULL::text FROM "SupplierPayment" p LEFT JOIN "Supplier" s ON s.id=p."supplierId" WHERE p."paymentNo" ILIKE ${pattern} ${input.docOnly ? Prisma.empty : Prisma.sql`OR s.name ILIKE ${pattern}`} ORDER BY p."paymentDate" DESC LIMIT ${input.take})`);
  add(input.access.expenses, Prisma.sql`(SELECT 80, 'expenses'::text, e.id, e."expenseNo", e.note, NULL::text, e.status::text, NULL::boolean, e."expenseDate", NULL::text FROM "Expense" e WHERE e."expenseNo" ILIKE ${pattern} ${input.docOnly ? Prisma.empty : Prisma.sql`OR e.note ILIKE ${pattern}`} ORDER BY e."expenseDate" DESC LIMIT ${input.take})`);
  add(input.access.warrantyClaims, Prisma.sql`(SELECT 90, 'warranty_claims'::text, w.id, w."claimNo", w."supplierName", NULL::text, w.status::text, NULL::boolean, w."claimDate", NULL::text FROM "WarrantyClaim" w WHERE w."claimNo" ILIKE ${pattern} ${input.docOnly ? Prisma.empty : Prisma.sql`OR w."supplierName" ILIKE ${pattern}`} ORDER BY w."claimDate" DESC LIMIT ${input.take})`);
  add(!input.docOnly && input.access.products, Prisma.sql`(SELECT 100, 'products'::text, p.id, p.code || ' — ' || p.name, NULL::text, NULL::text, NULL::text, p."isActive", p."createdAt", NULL::text FROM "Product" p WHERE p.code ILIKE ${pattern} OR p.name ILIKE ${pattern} OR EXISTS (SELECT 1 FROM "ProductAlias" pa WHERE pa."productId"=p.id AND pa.alias ILIKE ${pattern}) ORDER BY p."createdAt" DESC LIMIT ${input.take})`);
  add(!input.docOnly && input.access.customers, Prisma.sql`(SELECT 110, 'customers'::text, c.id, c.name, c.code, c.phone, NULL::text, c."isActive", NULL::timestamptz, c.name FROM "Customer" c WHERE c.code ILIKE ${pattern} OR c.name ILIKE ${pattern} OR c.phone ILIKE ${pattern} ORDER BY c.name ASC LIMIT ${input.take})`);
  add(!input.docOnly && input.access.suppliers, Prisma.sql`(SELECT 120, 'suppliers'::text, s.id, s.name, s.code, NULL::text, NULL::text, s."isActive", NULL::timestamptz, s.name FROM "Supplier" s WHERE s.code ILIKE ${pattern} OR s.name ILIKE ${pattern} ORDER BY s.name ASC LIMIT ${input.take})`);

  if (branches.length === 0) return [];
  const { db } = await import("@/lib/db");
  return db.$queryRaw<QuickSearchRow[]>(Prisma.sql`
    SELECT "groupKey", id, label, secondary, extra, status, "isActive"
    FROM (${Prisma.join(branches, " UNION ALL ")}) quick_search
    ORDER BY group_order, sort_date DESC NULLS LAST, sort_name ASC NULLS LAST
  `);
}
