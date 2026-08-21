export const dynamic = "force-dynamic";
export const metadata = { title: "รับเงินมัดจำลูกค้า" };
import Link from "next/link";
import { Eye, Pencil, Plus } from "lucide-react";
import type { Prisma } from "@/lib/generated/prisma";
import { db } from "@/lib/db";
import { hasPermissionAccess } from "@/lib/access-control";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import DateRangeFilter from "@/components/shared/DateRangeFilter";
import Pagination from "@/components/shared/Pagination";
import SearchBar from "@/components/shared/SearchBar";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminFilterToolbar from "@/components/shared/AdminFilterToolbar";
import AdminTableSection from "@/components/shared/AdminTableSection";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import AdminActionGroup from "@/components/shared/AdminActionGroup";
import PrintFromListButton from "@/components/shared/PrintFromListButton";
import { getAdminDocumentRowClass } from "@/lib/admin-status-presentation";
import { formatDateThai, parseDateOnlyToEndOfDay, parseDateOnlyToStartOfDay } from "@/lib/th-date";
import CustomerAdvanceCancelButton from "./CustomerAdvanceCancelButton";
const PAGE_SIZE = 30;
export default async function CustomerAdvancesPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; from?: string; to?: string }> }) {
  await requirePermission("customer_advances.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canCreate = hasPermissionAccess(role, permissions, "customer_advances.create"); const canUpdate = hasPermissionAccess(role, permissions, "customer_advances.update"); const canCancel = hasPermissionAccess(role, permissions, "customer_advances.cancel");
  const params = await searchParams; const page = Math.max(1, parseInt(params.page ?? "1", 10)); const q = params.q?.trim(); const from = params.from ?? ""; const to = params.to ?? "";
  const where: Prisma.CustomerAdvanceWhereInput = {};
  if (from || to) where.advanceDate = { ...(from ? { gte: parseDateOnlyToStartOfDay(from) } : {}), ...(to ? { lte: parseDateOnlyToEndOfDay(to) } : {}) };
  if (q) where.OR = [{ advanceNo: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }, { note: { contains: q, mode: "insensitive" } }, { cashBankAccount: { name: { contains: q, mode: "insensitive" } } }];
  const [rows, count] = await Promise.all([db.customerAdvance.findMany({ where, orderBy: [{ advanceDate: "desc" }, { advanceNo: "desc" }], take: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE, include: { customer: { select: { name: true } }, cashBankAccount: { select: { name: true } }, _count: { select: { receiptItems: true } } } }), db.customerAdvance.count({ where })]);
  const pagination: Record<string, string> = {}; if (q) pagination.q = q; if (from) pagination.from = from; if (to) pagination.to = to;
  return <div className="space-y-4"><AdminPageHeader title="รับเงินมัดจำลูกค้า" description="รับ ติดตาม และนำเงินมัดจำลูกค้าไปหักผ่านใบเสร็จรับเงิน" actions={canCreate ? <Link href="/admin/customer-advances/new" className="inline-flex items-center gap-2 rounded-xl bg-[#f97316] px-4 py-2 text-sm font-medium text-white hover:bg-orange-600"><Plus size={16} /> สร้างเอกสารใหม่</Link> : null} />
    <AdminFilterToolbar summary={q ? <span className="text-slate-500 dark:text-slate-400">ผลการค้นหา “{q}”: {count} รายการ</span> : null}><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><DateRangeFilter from={from} to={to} /><SearchBar placeholder="ค้นหาเลขที่เอกสาร, ลูกค้า, บัญชีรับเงิน..." /></div></AdminFilterToolbar>
    <AdminTableSection><table className="w-full text-sm"><thead className="bg-slate-50 text-slate-500 dark:bg-white/5 dark:text-slate-300"><tr><th className="px-4 py-3 text-center">#</th><th className="px-4 py-3 text-left">เลขที่</th><th className="px-4 py-3 text-left">วันที่</th><th className="px-4 py-3 text-left">ลูกค้า</th><th className="px-4 py-3 text-left">บัญชีรับเงิน</th><th className="px-4 py-3 text-right">ยอดมัดจำ</th><th className="px-4 py-3 text-right">คงเหลือ</th><th className="px-4 py-3 text-right">ใบเสร็จอ้างอิง</th><th className="px-4 py-3 text-left">สถานะ</th><th /></tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={row.id} className={`border-t border-slate-100 dark:border-white/5 ${getAdminDocumentRowClass(row.status === "CANCELLED")}`}><td className="px-4 py-3 text-center text-xs text-slate-400">{(page - 1) * PAGE_SIZE + index + 1}</td><td className="px-4 py-3 font-mono font-medium text-[#1e3a5f] dark:text-sky-200">{row.advanceNo}</td><td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatDateThai(row.advanceDate)}</td><td className="px-4 py-3 text-slate-700 dark:text-slate-200">{row.customer.name}</td><td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.cashBankAccount?.name ?? "-"}</td><td className="px-4 py-3 text-right font-medium dark:text-slate-100">{Number(row.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td><td className="px-4 py-3 text-right font-medium text-amber-700 dark:text-amber-300">{Number(row.amountRemain).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td><td className="px-4 py-3 text-right dark:text-slate-300">{row._count.receiptItems} รายการ</td><td className="px-4 py-3"><AdminStatusBadge tone={row.status === "ACTIVE" ? "success" : "danger"}>{row.status === "ACTIVE" ? "ใช้งาน" : "ยกเลิกแล้ว"}</AdminStatusBadge></td><td className="px-4 py-3"><AdminActionGroup align="end"><PrintFromListButton href={`/admin/customer-advances/${row.id}`} /><Link href={`/admin/customer-advances/${row.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-[#1e3a5f] dark:text-sky-300"><Eye size={14} /> ดู</Link>{row.status === "ACTIVE" && canUpdate ? <Link href={`/admin/customer-advances/${row.id}/edit`} className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400"><Pencil size={14} /> แก้ไข</Link> : null}{row.status === "ACTIVE" && canCancel ? <CustomerAdvanceCancelButton advanceId={row.id} docNo={row.advanceNo} /> : null}</AdminActionGroup></td></tr>) : <tr><td colSpan={10} className="px-4 py-12 text-center text-slate-400 dark:text-slate-500">ยังไม่มีรายการรับเงินมัดจำลูกค้า</td></tr>}</tbody></table></AdminTableSection>
    <Pagination currentPage={page} totalPages={Math.ceil(count / PAGE_SIZE)} basePath="/admin/customer-advances" searchParams={pagination} /></div>;
}
