export const dynamic = "force-dynamic";

import Link from "next/link";
import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminFilterToolbar from "@/components/shared/AdminFilterToolbar";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import AdminTableSection from "@/components/shared/AdminTableSection";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import Pagination from "@/components/shared/Pagination";
import { getAdminDocumentRowClass } from "@/lib/admin-status-presentation";
import { requirePermission } from "@/lib/require-auth";
import {
  formatDateThai,
  parseDateOnlyToEndOfDay,
  parseDateOnlyToStartOfDay,
} from "@/lib/th-date";
import { toThaiTaxYear } from "@/lib/wht";

const PAGE_SIZE = 30;

const formatBaht = (value: number) => value.toLocaleString("th-TH", { minimumFractionDigits: 2 });

const FORM_LABELS: Record<string, string> = {
  PND1: "ภ.ง.ด.1",
  PND1A: "ภ.ง.ด.1ก",
  PND2: "ภ.ง.ด.2",
  PND3: "ภ.ง.ด.3",
  PND3A: "ภ.ง.ด.3ก",
  PND53: "ภ.ง.ด.53",
  PND54: "ภ.ง.ด.54",
};

interface PageProps {
  searchParams: Promise<{
    q?: string;
    form?: string;
    status?: string;
    year?: string;
    page?: string;
    from?: string;
    to?: string;
  }>;
}

const WhtCertificatesPage = async ({ searchParams }: PageProps) => {
  await requirePermission("wht.view");

  const { q, form, status, year, page, from: fromParam, to: toParam } = await searchParams;
  const pageNum = Math.max(1, parseInt(page ?? "1", 10));
  const from = fromParam ?? "";
  const to = toParam ?? "";
  const statusFilter = status ?? "ACTIVE";
  const formFilter = form ?? "";
  const currentTaxYear = toThaiTaxYear(new Date());
  const selectedYear = Number(year) || currentTaxYear;

  const dateFilter: Prisma.WhtCertificateWhereInput =
    from || to
      ? {
          payDate: {
            ...(from ? { gte: parseDateOnlyToStartOfDay(from) } : {}),
            ...(to ? { lte: parseDateOnlyToEndOfDay(to) } : {}),
          },
        }
      : {};

  const whereCondition: Prisma.WhtCertificateWhereInput = {
    AND: [
      dateFilter,
      statusFilter ? { status: statusFilter as "ACTIVE" | "CANCELLED" } : {},
      formFilter ? { formType: formFilter as Prisma.EnumWhtFormTypeFilter["equals"] } : {},
      q
        ? {
            OR: [
              { certNo: { contains: q, mode: "insensitive" as const } },
              { payeeName: { contains: q, mode: "insensitive" as const } },
              { payeeTaxId13: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {},
    ],
  };

  const [rows, totalCount, yearTotals, unfiledCount] = await Promise.all([
    db.whtCertificate.findMany({
      where: whereCondition,
      orderBy: [{ payDate: "desc" }, { certNo: "desc" }],
      take: PAGE_SIZE,
      skip: (pageNum - 1) * PAGE_SIZE,
      select: {
        id: true,
        certNo: true,
        certDate: true,
        payDate: true,
        formType: true,
        payeeName: true,
        payeeTaxId13: true,
        totalBaseAmount: true,
        totalTaxAmount: true,
        taxMonth: true,
        taxYear: true,
        filingId: true,
        status: true,
        expense: { select: { id: true, expenseNo: true } },
      },
    }),
    db.whtCertificate.count({ where: whereCondition }),
    db.whtCertificate.aggregate({
      where: { status: "ACTIVE", taxYear: selectedYear },
      _sum: { totalTaxAmount: true },
      _count: true,
    }),
    db.whtCertificate.count({ where: { status: "ACTIVE", filingId: null } }),
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const paginationParams: Record<string, string> = {};
  if (q) paginationParams.q = q;
  if (formFilter) paginationParams.form = formFilter;
  if (status) paginationParams.status = status;
  if (year) paginationParams.year = year;
  if (from) paginationParams.from = from;
  if (to) paginationParams.to = to;

  const hasFilters = Boolean(q) || Boolean(from) || Boolean(to) || Boolean(formFilter) || statusFilter !== "ACTIVE";

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ)"
        description="ใบที่เราออกให้ผู้รับเงิน — ระบบออกให้อัตโนมัติจากใบค่าใช้จ่ายที่มีการหักภาษี"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/admin/wht/certificates/new"
              className="inline-flex items-center gap-2 rounded-xl bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163055]"
            >
              ออกใบเดี่ยว
            </Link>
            <Link
              href="/admin/wht/payees"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-[#1e3a5f] hover:text-[#1e3a5f] dark:border-white/10 dark:text-slate-300 dark:hover:border-sky-400 dark:hover:text-sky-300"
            >
              ข้อมูลภาษีผู้ถูกหัก
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950/40">
          <p className="text-xs text-slate-500 dark:text-slate-400">ภาษีที่หักไว้ทั้งปีภาษี {selectedYear}</p>
          <p className="mt-1 font-kanit text-xl font-semibold text-[#1e3a5f] dark:text-sky-300">
            {formatBaht(Number(yearTotals._sum.totalTaxAmount ?? 0))} บาท
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500">{yearTotals._count} ฉบับ</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-400/20 dark:bg-amber-500/5">
          <p className="text-xs text-amber-700 dark:text-amber-300">ยังไม่ได้นำไปยื่นแบบ ภ.ง.ด.</p>
          <p className="mt-1 font-kanit text-xl font-semibold text-amber-700 dark:text-amber-300">
            {unfiledCount} ฉบับ
          </p>
          <p className="text-xs text-amber-600/80 dark:text-amber-400/80">
            นำส่งภายใน 7 วันนับแต่วันสิ้นเดือนของเดือนที่จ่ายเงิน
          </p>
        </div>
      </div>

      <AdminFilterToolbar
        className="mb-0"
        summary={
          <span className="font-medium text-slate-700 dark:text-slate-200">
            ทั้งหมด <span className="font-semibold text-slate-900 dark:text-slate-100">{totalCount} ฉบับ</span>
          </span>
        }
      >
        <AdminSearchForm method="GET" className="flex flex-col gap-3 xl:flex-row xl:items-end">
          <div lang="en-GB" className="flex flex-wrap items-center gap-2 text-sm">
            <span className="whitespace-nowrap text-slate-500 dark:text-slate-400">ช่วงวันที่จ่าย</span>
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
            placeholder="ค้นหาเลขที่, ผู้ถูกหัก, เลขผู้เสียภาษี..."
            className="min-w-48 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:ring-sky-400/20"
          />
          <select
            name="form"
            defaultValue={formFilter}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-400/20"
          >
            <option value="">ทุกแบบ</option>
            <option value="PND3">ภ.ง.ด.3 (ผู้รับเป็นบุคคลธรรมดา)</option>
            <option value="PND53">ภ.ง.ด.53 (ผู้รับเป็นนิติบุคคล)</option>
          </select>
          <select
            name="status"
            defaultValue={statusFilter}
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
            {hasFilters && (
              <Link
                href="/admin/wht/certificates"
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
              <th className="px-4 py-3 text-left font-medium">เลขที่ 50 ทวิ</th>
              <th className="px-4 py-3 text-left font-medium">วันที่จ่าย</th>
              <th className="px-4 py-3 text-left font-medium">ผู้ถูกหักภาษี</th>
              <th className="px-4 py-3 text-left font-medium">แบบยื่น</th>
              <th className="px-4 py-3 text-right font-medium">เงินได้</th>
              <th className="px-4 py-3 text-right font-medium">ภาษีที่หัก</th>
              <th className="px-4 py-3 text-center font-medium">ยื่นแบบแล้ว</th>
              <th className="px-4 py-3 text-center font-medium">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400 dark:text-slate-500">
                  ยังไม่มีหนังสือรับรองหัก ณ ที่จ่าย — ระบบจะออกให้เมื่อบันทึกใบค่าใช้จ่ายที่มีการหักภาษี
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className={getAdminDocumentRowClass(row.status === "CANCELLED")}>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/wht/certificates/${row.id}`}
                      className="font-mono font-medium text-[#1e3a5f] hover:underline dark:text-sky-300"
                    >
                      {row.certNo}
                    </Link>
                    {row.expense ? (
                      <span className="mt-0.5 block text-xs text-slate-400 dark:text-slate-500">
                        จาก {row.expense.expenseNo}
                      </span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-700 dark:text-slate-200">
                    {formatDateThai(row.payDate)}
                  </td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                    {row.payeeName}
                    <span className="mt-0.5 block font-mono text-xs text-slate-400 dark:text-slate-500">
                      {row.payeeTaxId13}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {FORM_LABELS[row.formType] ?? row.formType}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">
                    {formatBaht(Number(row.totalBaseAmount))}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-[#1e3a5f] dark:text-sky-300">
                    {formatBaht(Number(row.totalTaxAmount))}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {row.filingId ? (
                      <AdminStatusBadge tone="success">ยื่นแล้ว</AdminStatusBadge>
                    ) : (
                      <AdminStatusBadge tone="warning">ยังไม่ยื่น</AdminStatusBadge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {row.status === "CANCELLED" ? (
                      <AdminStatusBadge tone="danger">ยกเลิก</AdminStatusBadge>
                    ) : (
                      <AdminStatusBadge tone="success">ใช้งาน</AdminStatusBadge>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </AdminTableSection>

      {totalPages > 1 && (
        <Pagination
          currentPage={pageNum}
          totalPages={totalPages}
          basePath="/admin/wht/certificates"
          searchParams={paginationParams}
        />
      )}
    </div>
  );
};

export default WhtCertificatesPage;
