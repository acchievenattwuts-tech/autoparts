export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { Plus, Eye, Pencil } from "lucide-react";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import CancelExpenseButton from "./CancelExpenseButton";
import Pagination from "@/components/shared/Pagination";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminFilterToolbar from "@/components/shared/AdminFilterToolbar";
import AdminTableSection from "@/components/shared/AdminTableSection";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import AdminActionGroup from "@/components/shared/AdminActionGroup";
import { hasPermissionAccess } from "@/lib/access-control";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import {
  formatDateThai,
  parseDateOnlyToEndOfDay,
  parseDateOnlyToStartOfDay,
} from "@/lib/th-date";

const PAGE_SIZE = 30;

interface ExpensePageProps {
  searchParams: Promise<{ q?: string; status?: string; page?: string; from?: string; to?: string }>;
}

const ExpensePage = async ({ searchParams }: ExpensePageProps) => {
  await requirePermission("expenses.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canCreate = hasPermissionAccess(role, permissions, "expenses.create");
  const canUpdate = hasPermissionAccess(role, permissions, "expenses.update");
  const canCancel = hasPermissionAccess(role, permissions, "expenses.cancel");

  const { q, status, page, from: fromParam, to: toParam } = await searchParams;
  const pageNum = Math.max(1, parseInt(page ?? "1", 10));
  const from = fromParam ?? "";
  const to = toParam ?? "";

  const dateFilter = (from || to)
    ? {
        expenseDate: {
          ...(from ? { gte: parseDateOnlyToStartOfDay(from) } : {}),
          ...(to ? { lte: parseDateOnlyToEndOfDay(to) } : {}),
        },
      }
    : {};

  const whereCondition = {
    AND: [
      dateFilter,
      status ? { status: status as "ACTIVE" | "CANCELLED" } : {},
      q
        ? {
            OR: [
              { expenseNo: { contains: q, mode: "insensitive" as const } },
              { note: { contains: q, mode: "insensitive" as const } },
              { items: { some: { description: { contains: q, mode: "insensitive" as const } } } },
              { items: { some: { expenseCode: { name: { contains: q, mode: "insensitive" as const } } } } },
            ],
          }
        : {},
    ],
  };

  const [expenses, totalCount] = await Promise.all([
    db.expense.findMany({
      where: whereCondition,
      orderBy: [{ expenseDate: "desc" }, { expenseNo: "desc" }],
      take: PAGE_SIZE,
      skip: (pageNum - 1) * PAGE_SIZE,
      select: {
        id: true,
        expenseNo: true,
        expenseDate: true,
        totalAmount: true,
        subtotalAmount: true,
        vatAmount: true,
        vatType: true,
        vatRate: true,
        netAmount: true,
        note: true,
        status: true,
        cancelNote: true,
        items: {
          select: {
            id: true,
            amount: true,
            description: true,
            expenseCode: { select: { code: true, name: true } },
          },
        },
      },
    }),
    db.expense.count({ where: whereCondition }),
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const activeExpenses = expenses.filter((e) => e.status === "ACTIVE");
  const totalNet = activeExpenses.reduce((s, e) => s + Number(e.netAmount), 0);

  const paginationParams: Record<string, string> = {};
  if (q) paginationParams.q = q;
  if (status) paginationParams.status = status;
  if (from) paginationParams.from = from;
  if (to) paginationParams.to = to;

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="ค่าใช้จ่าย"
        description="ค้นหา ดูยอดรวม และจัดการรายการค่าใช้จ่าย"
        actions={
          canCreate ? (
            <Link
              href="/admin/expenses/new"
              className="inline-flex items-center gap-2 rounded-xl bg-[#f97316] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
            >
              <Plus size={16} /> บันทึกรายการใหม่
            </Link>
          ) : null
        }
      />

      <AdminFilterToolbar
        className="mb-0"
        summary={
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-700 dark:text-slate-200">
              ทั้งหมด <span className="font-semibold text-slate-900 dark:text-slate-100">{totalCount} เอกสาร</span>
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              ยอดสุทธิ (ACTIVE){" "}
              <span className="font-semibold text-[#1e3a5f] dark:text-sky-300">
                {totalNet.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท
              </span>
            </span>
          </div>
        }
      >
        <AdminSearchForm method="GET" className="flex flex-col gap-3 xl:flex-row xl:items-end">
          <div lang="en-GB" className="flex flex-wrap items-center gap-2 text-sm">
            <span className="whitespace-nowrap text-slate-500 dark:text-slate-400">ช่วงวันที่</span>
            <input
              type="date"
              name="from"
              defaultValue={from}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-400/20"
            />
            <span className="text-slate-400">–</span>
            <input
              type="date"
              name="to"
              defaultValue={to}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-400/20"
            />
          </div>
          <input
            type="text"
            name="q"
            defaultValue={q ?? ""}
            placeholder="ค้นหาเลขที่, รหัส, รายละเอียด..."
            className="min-w-48 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:ring-sky-400/20"
          />
          <select
            name="status"
            defaultValue={status ?? "ACTIVE"}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-400/20"
          >
            <option value="ACTIVE">เฉพาะที่ใช้งาน</option>
            <option value="CANCELLED">เฉพาะที่ยกเลิก</option>
            <option value="">ทั้งหมด</option>
          </select>
          <div className="flex flex-wrap items-center gap-2">
            <AdminSearchSubmitButton className="rounded-xl bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#163055]">
              ค้นหา
            </AdminSearchSubmitButton>
            {(q || from || to || (status && status !== "ACTIVE")) && (
              <Link
                href="/admin/expenses"
                className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-200 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
              >
                ล้าง
              </Link>
            )}
          </div>
        </AdminSearchForm>
      </AdminFilterToolbar>

      <AdminTableSection>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 dark:bg-white/5 dark:text-slate-300">
            <tr>
              <th className="w-10 px-4 py-3 text-center font-medium">#</th>
              <th className="px-4 py-3 text-left font-medium">เลขที่</th>
              <th className="px-4 py-3 text-left font-medium">วันที่</th>
              <th className="px-4 py-3 text-left font-medium">รายการ</th>
              <th className="px-4 py-3 text-right font-medium">ก่อน VAT</th>
              <th className="px-4 py-3 text-right font-medium">VAT</th>
              <th className="px-4 py-3 text-right font-medium">ยอดสุทธิ</th>
              <th className="px-4 py-3 text-center font-medium">สถานะ</th>
              <th className="w-20 px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {expenses.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-slate-400 dark:text-slate-500">
                  ไม่พบรายการค่าใช้จ่าย
                </td>
              </tr>
            ) : (
              expenses.map((exp, idx) => {
                const isCancelled = exp.status === "CANCELLED";
                return (
                  <tr
                    key={exp.id}
                    className={`border-t border-slate-100 transition-colors dark:border-white/5 ${isCancelled ? "bg-rose-50/60 opacity-70 dark:bg-rose-400/10" : "hover:bg-slate-50/70 dark:hover:bg-white/5"}`}
                  >
                    <td className="px-4 py-3 text-center text-xs tabular-nums text-slate-400 dark:text-slate-500">
                      {(pageNum - 1) * PAGE_SIZE + idx + 1}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs font-medium text-[#1e3a5f] dark:text-sky-200">
                      {exp.expenseNo}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600 dark:text-slate-300">
                      {formatDateThai(exp.expenseDate)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-0.5">
                        {exp.items.map((it) => (
                          <div key={it.id} className="flex items-center gap-1.5">
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-400 dark:bg-white/5">
                              {it.expenseCode.code}
                            </span>
                            <span className="text-xs text-slate-700 dark:text-slate-300">
                              {it.description ?? it.expenseCode.name}
                            </span>
                            <span className="ml-auto text-xs text-slate-400 dark:text-slate-500">
                              {Number(it.amount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                        ))}
                        {exp.note ? <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">({exp.note})</p> : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">
                      {Number(exp.vatAmount) > 0 ? Number(exp.subtotalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 }) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">
                      {Number(exp.vatAmount) > 0 ? Number(exp.vatAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 }) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900 dark:text-slate-100">
                      {Number(exp.netAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {isCancelled ? <AdminStatusBadge tone="danger">ยกเลิก</AdminStatusBadge> : <AdminStatusBadge tone="success">ใช้งาน</AdminStatusBadge>}
                    </td>
                    <td className="px-4 py-3">
                      <AdminActionGroup align="end">
                        <Link
                          href={`/admin/expenses/${exp.id}`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-[#1e3a5f] transition-colors hover:text-blue-700 dark:text-sky-300 dark:hover:text-sky-200"
                        >
                          <Eye size={14} /> ดู
                        </Link>
                        {!isCancelled ? (
                          <>
                            {canUpdate ? (
                              <Link
                                href={`/admin/expenses/${exp.id}/edit`}
                                className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                              >
                                <Pencil size={14} /> แก้ไข
                              </Link>
                            ) : null}
                            {canCancel ? <CancelExpenseButton id={exp.id} expenseNo={exp.expenseNo} /> : null}
                          </>
                        ) : null}
                      </AdminActionGroup>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot className="border-t-2 border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/5">
            <tr>
              <td colSpan={6} className="px-4 py-3 text-right text-sm font-semibold text-slate-700 dark:text-slate-200">
                รวมยอดสุทธิ (ACTIVE)
              </td>
              <td className="px-4 py-3 text-right font-bold text-slate-900 dark:text-slate-100">
                {totalNet.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                <span className="ml-1 text-xs font-normal text-slate-500">บาท</span>
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </AdminTableSection>

      <Pagination currentPage={pageNum} totalPages={totalPages} basePath="/admin/expenses" searchParams={paginationParams} />
    </div>
  );
};

export default ExpensePage;
