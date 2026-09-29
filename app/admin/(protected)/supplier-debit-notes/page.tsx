import Link from "next/link";
import type { JSX } from "react";
import type { Prisma } from "@/lib/generated/prisma";
import { db } from "@/lib/db";
import { requirePermission, getSessionPermissionContext } from "@/lib/require-auth";
import { hasPermissionAccess } from "@/lib/access-control";
import { formatDateThai, isDateOnlyString, parseDateOnlyToStartOfDay, parseDateOnlyToEndOfDay } from "@/lib/th-date";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import Pagination from "@/components/shared/Pagination";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 30;
const loadDebitList = async ({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; from?: string; to?: string }> }) => {
  try {
  await requirePermission("supplier_debit_notes.view");
  const { role, permissions } = await getSessionPermissionContext();
  const { q = "", page, from: fromParam, to: toParam } = await searchParams;
  const from = isDateOnlyString(fromParam) ? fromParam : "";
  const to = isDateOnlyString(toParam) ? toParam : "";
  const pageNumber = Math.max(1, Math.min(100_000, Number.parseInt(page ?? "1", 10) || 1));
  const where: Prisma.SupplierDebitNoteWhereInput = q ? { OR: [{ debitNo: { contains: q, mode: "insensitive" as const } },
    { supplierReferenceNo: { contains: q, mode: "insensitive" as const } },
    { supplier: { name: { contains: q, mode: "insensitive" as const } } }] } : {};
  if (from || to) where.postingDate = {
    ...(from ? { gte: parseDateOnlyToStartOfDay(from) } : {}),
    ...(to ? { lte: parseDateOnlyToEndOfDay(to) } : {}),
  };
  const [rows, count] = await Promise.all([
    db.supplierDebitNote.findMany({ where, orderBy: { createdAt: "desc" }, take: PAGE_SIZE, skip: (pageNumber - 1) * PAGE_SIZE,
      select: { id: true, debitNo: true, supplierReferenceNo: true, postingDate: true, netAmount: true,
        amountRemain: true, inventoryAmount: true, varianceAmount: true, status: true, supplier: { select: { name: true } } } }),
    db.supplierDebitNote.count({ where }),
  ]);
  return { q, from, to, pageNumber, role, permissions, rows, count };
  } catch (error) { console.error("[supplier-DN list]", error); throw error; }
};

const DebitListPage = async ({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; from?: string; to?: string }> }): Promise<JSX.Element> => {
  const { q, from, to, pageNumber, role, permissions, rows, count } = await loadDebitList({ searchParams });
  const money = (value: unknown) => Number(value).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return <div className="space-y-4 text-slate-900 dark:text-slate-100">
    <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">ใบเพิ่มหนี้ผู้จำหน่าย</h1>
      {hasPermissionAccess(role, permissions, "supplier_debit_notes.create") && <Link href="/admin/supplier-debit-notes/new" className="rounded bg-sky-800 px-4 py-2 text-white">บันทึก DN</Link>}</div>
    <p className="text-sm text-slate-600 dark:text-slate-400">เพิ่มเจ้าหนี้และปรับมูลค่าต้นทุนโดยไม่เพิ่มจำนวนสินค้า · ส่วนที่ไม่เข้าสินค้าคงเหลือลงส่วนต่างต้นทุนงวด DN</p>
    <AdminSearchForm className="flex flex-wrap items-end gap-2">
      <input name="q" defaultValue={q} aria-label="ค้นหา DN" placeholder="เลข DN / เลข supplier / ชื่อ supplier" className="rounded border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900" />
      <label className="space-y-1 text-sm"><span className="block">วันที่ลงต้นทุน ตั้งแต่</span><input type="date" name="from" defaultValue={from} className="rounded border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900" /></label>
      <label className="space-y-1 text-sm"><span className="block">ถึง</span><input type="date" name="to" defaultValue={to} className="rounded border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900" /></label>
      <AdminSearchSubmitButton>ค้นหา</AdminSearchSubmitButton>
    </AdminSearchForm>
    <div className="overflow-x-auto rounded border border-slate-200 dark:border-slate-700"><table className="w-full text-sm"><thead className="bg-slate-100 dark:bg-slate-800"><tr>
      {['DN / เลข supplier', 'วันที่ลงต้นทุน', 'supplier', 'เจ้าหนี้เพิ่ม', 'เข้าสต็อก', 'ส่วนต่างต้นทุน', 'ค้างจ่าย', 'สถานะ'].map((label) => <th className="p-3 text-left" key={label}>{label}</th>)}
    </tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t border-slate-200 dark:border-slate-700">
      <td className="p-3"><Link href={`/admin/supplier-debit-notes/${row.id}`} className="text-sky-800 dark:text-sky-300">{row.debitNo}</Link><div className="text-xs">{row.supplierReferenceNo}</div></td>
      <td>{formatDateThai(row.postingDate)}</td><td>{row.supplier.name}</td><td>{money(row.netAmount)}</td><td>{money(row.inventoryAmount)}</td><td>{money(row.varianceAmount)}</td><td>{money(row.amountRemain)}</td><td>{row.status === "ACTIVE" ? "ใช้งาน" : "ยกเลิก"}</td>
    </tr>)}{rows.length === 0 && <tr><td colSpan={8} className="p-8 text-center">ไม่พบ DN</td></tr>}</tbody></table></div>
    <Pagination currentPage={pageNumber} totalPages={Math.max(1, Math.ceil(count / PAGE_SIZE))} basePath="/admin/supplier-debit-notes" searchParams={{ q, from, to }} />
  </div>;
};
export default DebitListPage;
