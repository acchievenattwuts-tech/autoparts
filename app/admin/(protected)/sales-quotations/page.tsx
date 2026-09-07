import { formatQuotationReference } from "@/lib/sales-quotation-form";
import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission, getSessionPermissionContext } from "@/lib/require-auth";
import { hasPermissionAccess } from "@/lib/access-control";
import { formatDateThai, parseDateOnlyToStartOfDay, parseDateOnlyToEndOfDay } from "@/lib/th-date";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import PrintFromListButton from "@/components/shared/PrintFromListButton";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export default async function QuotationsPage({ searchParams }: { searchParams: Promise<{ q?: string; from?: string; to?: string; page?: string }> }) {
  await requirePermission("sales_quotations.view");
  const { role, permissions } = await getSessionPermissionContext();
  const params = await searchParams;
  const page = Math.max(1, Math.min(100000, Number.parseInt(params.page ?? "1", 10) || 1));
  const validDate = (s?: string) => s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
  const from = validDate(params.from), to = validDate(params.to);
  const rows = await db.salesQuotation.findMany({ where: {
    ...(params.q ? { OR: [{ quotationNo: { contains: params.q, mode: "insensitive" as const } }, { customerName: { contains: params.q, mode: "insensitive" as const } }] } : {}),
    ...(from || to ? { quotationDate: { ...(from ? { gte: parseDateOnlyToStartOfDay(from) } : {}), ...(to ? { lte: parseDateOnlyToEndOfDay(to) } : {}) } } : {}),
  }, select: { id: true, quotationNo: true, revision: true, quotationDate: true, customerName: true, netAmount: true, status: true, activeSale: { select: { id: true, saleNo: true } } }, orderBy: [{ quotationDate: "desc" }, { quotationNo: "desc" }], skip: (page - 1) * 50, take: 51 });
  const pageHref = (number: number) => `/admin/sales-quotations?${new URLSearchParams({ q: params.q ?? "", from: from ?? "", to: to ?? "", page: String(number) })}`;
  const input = "rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-white/20 dark:bg-slate-900";
  return <div className="space-y-5 text-gray-900 dark:text-slate-100">
    <div className="flex justify-between"><h1 className="text-2xl font-bold">ใบเสนอราคา</h1>{hasPermissionAccess(role, permissions, "sales_quotations.create") && <Link className="rounded-lg bg-orange-600 px-4 py-2 text-white" href="/admin/sales-quotations/new">+ เพิ่มใบเสนอราคา</Link>}</div>
    <AdminSearchForm action="/admin/sales-quotations" className="flex flex-wrap items-end gap-3">
      <label>ค้นหา<input name="q" defaultValue={params.q} placeholder="เลข SQ / ชื่อลูกค้า" className={input} /></label>
      <label>ตั้งแต่<input type="date" name="from" defaultValue={from} className={input} /></label>
      <label>ถึง<input type="date" name="to" defaultValue={to} className={input} /></label><AdminSearchSubmitButton />
    </AdminSearchForm>
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-white/15 dark:bg-slate-900"><table className="w-full text-left text-sm">
      <thead><tr>{["เลขที่", "วันที่", "ลูกค้า", "ยอดสุทธิ", "สถานะ", "อ้างอิงใบขาย", ""].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead>
      <tbody>{rows.slice(0, 50).map((row) => <tr key={row.id} className="border-t border-gray-100 dark:border-white/10">
        <td className="p-3"><Link href={`/admin/sales-quotations/${row.id}`}>{formatQuotationReference(row.quotationNo, row.revision)}</Link></td><td className="p-3">{formatDateThai(row.quotationDate)}</td><td className="p-3">{row.customerName}</td><td className="p-3">{Number(row.netAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td>
        <td className="p-3">{row.status === "CANCELLED" ? "ยกเลิกแล้ว" : row.activeSale ? "อ้างอิงแล้ว" : "ใช้งาน"}</td><td className="p-3">{row.activeSale ? <Link href={`/admin/sales/${row.activeSale.id}`}>{row.activeSale.saleNo}</Link> : "-"}</td>
        <td className="p-3"><div className="flex gap-3"><PrintFromListButton href={`/admin/sales-quotations/${row.id}`} /><Link href={`/admin/sales-quotations/${row.id}`}>ดู</Link>{row.status === "ACTIVE" && !row.activeSale && hasPermissionAccess(role, permissions, "sales_quotations.update") && <Link href={`/admin/sales-quotations/${row.id}/edit`}>แก้ไข</Link>}</div></td>
      </tr>)}{!rows.length && <tr><td colSpan={7} className="p-8 text-center">ไม่พบใบเสนอราคา</td></tr>}</tbody>
    </table></div><div className="flex gap-4">{page > 1 && <Link href={pageHref(page - 1)}>หน้าก่อน</Link>}<span>หน้า {page}</span>{rows.length > 50 && <Link href={pageHref(page + 1)}>หน้าถัดไป</Link>}</div>
  </div>;
}
