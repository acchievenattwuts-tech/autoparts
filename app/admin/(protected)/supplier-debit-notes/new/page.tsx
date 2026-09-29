import Link from "next/link";
import type { JSX } from "react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import DebitForm, { type DebitPurchase } from "../DebitForm";

export const dynamic = "force-dynamic";
const loadNewDebit = async ({ searchParams }: { searchParams: Promise<{ q?: string; purchaseId?: string }> }) => {
  try {
  await requirePermission("supplier_debit_notes.create");
  const { q, purchaseId } = await searchParams;
  const purchases = await db.purchase.findMany({ where: { status: "ACTIVE", supplierId: { not: null },
    ...(q ? { OR: [{ purchaseNo: { contains: q, mode: "insensitive" } }, { referenceNo: { contains: q, mode: "insensitive" } },
      { supplier: { name: { contains: q, mode: "insensitive" } } }] } : {}),
  }, orderBy: { purchaseDate: "desc" }, take: 100,
    select: { id: true, purchaseNo: true, referenceNo: true, supplier: { select: { name: true } } } });
  const selected = purchaseId ? await db.purchase.findFirst({ where: { id: purchaseId, status: "ACTIVE", supplierId: { not: null } },
    select: { id: true, purchaseNo: true, vatType: true, vatRate: true, supplier: { select: { name: true } },
      items: { orderBy: { lineNo: "asc" }, select: { id: true, quantity: true, showQty: true,
        showUnitName: true, showPricePerUnit: true, costPrice: true, product: { select: { code: true, name: true } } } } },
  }) : null;
  const purchase: DebitPurchase | null = selected ? { id: selected.id, purchaseNo: selected.purchaseNo,
    supplierName: selected.supplier?.name ?? "", vatType: selected.vatType, vatRate: Number(selected.vatRate),
    items: selected.items.map((item) => ({ id: item.id, productName: item.product.name, productCode: item.product.code,
      quantity: Number(item.showQty ?? item.quantity), unitName: item.showUnitName ?? "หน่วยฐาน", price: Number(item.showPricePerUnit ?? item.costPrice) })) } : null;
  return { q, purchases, purchase };
  } catch (error) { console.error("[supplier-DN new]", error); throw error; }
};

const NewDebitPage = async ({ searchParams }: { searchParams: Promise<{ q?: string; purchaseId?: string }> }): Promise<JSX.Element> => {
  const { q, purchases, purchase } = await loadNewDebit({ searchParams });
  return <div className="space-y-4 text-slate-800 dark:text-slate-200">
    <Link href="/admin/supplier-debit-notes" className="text-sky-800 dark:text-sky-300">กลับรายการ DN</Link>
    <h1 className="text-2xl font-semibold">บันทึกใบเพิ่มหนี้ผู้จำหน่าย</h1>
    <AdminSearchForm className="flex flex-wrap gap-2"><input name="q" defaultValue={q} placeholder="ค้นเลขใบซื้อ / เลข supplier / ชื่อ supplier" className="rounded border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900" /><AdminSearchSubmitButton>ค้นหาใบซื้อ</AdminSearchSubmitButton></AdminSearchForm>
    <p className="text-sm">เลือกใบซื้อเดิมหนึ่งใบ รวมถึงใบซื้อสดหรือใบที่จ่ายครบแล้ว (แสดงล่าสุด 100 ใบ ใช้ค้นหาเพื่อเลือกใบเก่า)</p>
    <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded border border-slate-200 p-3 dark:border-slate-700">{purchases.map((item) =>
      <Link key={item.id} href={`/admin/supplier-debit-notes/new?purchaseId=${item.id}`} className="rounded p-2 text-sky-800 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-slate-800">{item.purchaseNo} · {item.supplier?.name} · {item.referenceNo}</Link>)}</div>
    {purchase ? <DebitForm key={purchase.id} purchase={purchase} /> : <p>เลือกใบซื้อเพื่อเริ่มกรอก DN</p>}
  </div>;
};
export default NewDebitPage;
