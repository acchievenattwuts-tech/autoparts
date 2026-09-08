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
import { hasPermissionAccess } from "@/lib/access-control";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import {
  formatDateOnlyForInput,
  formatDateThai,
  parseDateOnlyToEndOfDay,
  parseDateOnlyToStartOfDay,
} from "@/lib/th-date";
import { toThaiTaxYear } from "@/lib/wht";
import WhtCertificateCell from "./WhtCertificateCell";
import WhtAttachmentCell from "./WhtAttachmentCell";

const PAGE_SIZE = 30;
/* Filter row tokens copied from the products filter (ProductFilterForm) — see the
   note on the row markup below for why the row must be an inner div. */
const FILTER_CONTROL = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] dark:border-white/20 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500";
const FILTER_SUBMIT = "shrink-0 inline-flex justify-center rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163055]";
const FILTER_CLEAR = "shrink-0 inline-flex items-center justify-center gap-1.5 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15";

const formatBaht = (value: number) => value.toLocaleString("th-TH", { minimumFractionDigits: 2 });

interface WhtPageProps {
  searchParams: Promise<{
    q?: string;
    cert?: string;
    year?: string;
    status?: string;
    page?: string;
    from?: string;
    to?: string;
  }>;
}

const WhtReceivedPage = async ({ searchParams }: WhtPageProps) => {
  await requirePermission("wht.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canUpdate = hasPermissionAccess(role, permissions, "wht.update");

  const {
    q,
    cert,
    year,
    status,
    page,
    from: fromParam,
    to: toParam,
  } = await searchParams;

  const pageNum = Math.max(1, parseInt(page ?? "1", 10));
  const from = fromParam ?? "";
  const to = toParam ?? "";
  const statusFilter = status ?? "ACTIVE";
  const certFilter = cert ?? "";
  const currentTaxYear = toThaiTaxYear(new Date());
  const selectedYear = Number(year) || currentTaxYear;

  const dateFilter: Prisma.WhtReceivedWhereInput =
    from || to
      ? {
          payDate: {
            ...(from ? { gte: parseDateOnlyToStartOfDay(from) } : {}),
            ...(to ? { lte: parseDateOnlyToEndOfDay(to) } : {}),
          },
        }
      : {};

  const whereCondition: Prisma.WhtReceivedWhereInput = {
    AND: [
      dateFilter,
      statusFilter ? { status: statusFilter as "ACTIVE" | "CANCELLED" } : {},
      certFilter === "PENDING"
        ? { certReceivedAt: null }
        : certFilter === "RECEIVED"
          ? { certReceivedAt: { not: null } }
          : {},
      q
        ? {
            OR: [
              { customerNameSnapshot: { contains: q, mode: "insensitive" as const } },
              { certNo: { contains: q, mode: "insensitive" as const } },
              { receipt: { receiptNo: { contains: q, mode: "insensitive" as const } } },
              { sale: { saleNo: { contains: q, mode: "insensitive" as const } } },
            ],
          }
        : {},
    ],
  };

  const yearFilter: Prisma.WhtReceivedWhereInput = { status: "ACTIVE", taxYear: selectedYear };

  const [rows, totalCount, yearTotals, firstHalfTotals, pendingTotals, years] = await Promise.all([
    db.whtReceived.findMany({
      where: whereCondition,
      orderBy: [{ payDate: "desc" }, { createdAt: "desc" }],
      take: PAGE_SIZE,
      skip: (pageNum - 1) * PAGE_SIZE,
      select: {
        id: true,
        payDate: true,
        customerNameSnapshot: true,
        incomeLabelSnapshot: true,
        baseAmount: true,
        rate: true,
        taxAmount: true,
        certNo: true,
        certDate: true,
        certReceivedAt: true,
        taxYear: true,
        taxHalf: true,
        status: true,
        receipt: { select: { id: true, receiptNo: true } },
        sale: { select: { id: true, saleNo: true } },
        attachments: {
          orderBy: { createdAt: "asc" },
          select: { id: true, url: true, fileName: true },
        },
      },
    }),
    db.whtReceived.count({ where: whereCondition }),
    db.whtReceived.aggregate({ where: yearFilter, _sum: { taxAmount: true }, _count: true }),
    db.whtReceived.aggregate({
      where: { ...yearFilter, taxHalf: 1 },
      _sum: { taxAmount: true },
      _count: true,
    }),
    db.whtReceived.aggregate({
      where: { ...yearFilter, certReceivedAt: null },
      _sum: { taxAmount: true },
      _count: true,
    }),
    db.whtReceived.findMany({
      where: { status: "ACTIVE" },
      distinct: ["taxYear"],
      orderBy: { taxYear: "desc" },
      select: { taxYear: true },
    }),
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const yearOptions = years.map((row) => row.taxYear);
  if (!yearOptions.includes(currentTaxYear)) yearOptions.unshift(currentTaxYear);
  if (!yearOptions.includes(selectedYear)) yearOptions.unshift(selectedYear);

  const paginationParams: Record<string, string> = {};
  if (q) paginationParams.q = q;
  if (certFilter) paginationParams.cert = certFilter;
  if (year) paginationParams.year = year;
  if (status) paginationParams.status = status;
  if (from) paginationParams.from = from;
  if (to) paginationParams.to = to;

  const hasFilters =
    Boolean(q) || Boolean(from) || Boolean(to) || Boolean(certFilter) || statusFilter !== "ACTIVE";

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="ภาษีถูกหัก ณ ที่จ่าย"
        description="ยอดที่ลูกค้าหักไว้ตอนจ่ายเงิน สำหรับใช้เครดิตใน ภ.ง.ด.94 และ ภ.ง.ด.90 พร้อมติดตามหนังสือรับรอง 50 ทวิ"
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950/40">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            ครึ่งปีแรก ปีภาษี {selectedYear} (ใช้กับ ภ.ง.ด.94)
          </p>
          <p className="mt-1 font-kanit text-xl font-semibold text-[#1e3a5f] dark:text-sky-300">
            {formatBaht(Number(firstHalfTotals._sum.taxAmount ?? 0))} บาท
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500">{firstHalfTotals._count} รายการ</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950/40">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            ทั้งปีภาษี {selectedYear} (ใช้กับ ภ.ง.ด.90)
          </p>
          <p className="mt-1 font-kanit text-xl font-semibold text-[#1e3a5f] dark:text-sky-300">
            {formatBaht(Number(yearTotals._sum.taxAmount ?? 0))} บาท
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500">{yearTotals._count} รายการ</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-400/20 dark:bg-amber-500/5">
          <p className="text-xs text-amber-700 dark:text-amber-300">ยังไม่ได้รับหนังสือรับรอง 50 ทวิ</p>
          <p className="mt-1 font-kanit text-xl font-semibold text-amber-700 dark:text-amber-300">
            {formatBaht(Number(pendingTotals._sum.taxAmount ?? 0))} บาท
          </p>
          <p className="text-xs text-amber-600/80 dark:text-amber-400/80">
            {pendingTotals._count} รายการ — ไม่มีใบ = เครดิตภาษีไม่ได้
          </p>
        </div>
      </div>

      <AdminFilterToolbar
        className="mb-0"
        summary={
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-700 dark:text-slate-200">
              ทั้งหมด <span className="font-semibold text-slate-900 dark:text-slate-100">{totalCount} รายการ</span>
            </span>
          </div>
        }
      >
        {/* The row is an inner div, never the <form>: AdminSearchForm always applies
            space-y-*, and on a flex row that margin-top knocks every child after the
            first out of line. A breakpoint here would also strand the button on its
            own line, because the lg sidebar leaves less content width than xl. */}
        <AdminSearchForm method="GET" className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[200px] flex-1">
              <input
                type="text"
                name="q"
                defaultValue={q ?? ""}
                placeholder="ค้นหาลูกค้า, เลขที่เอกสาร, เลขที่ 50 ทวิ..."
                className={`w-full ${FILTER_CONTROL}`}
              />
            </div>
            <div lang="en-GB" className="flex shrink-0 items-center gap-2">
              <span className="whitespace-nowrap text-sm text-gray-500 dark:text-slate-400">ช่วงวันที่จ่าย</span>
              <input type="date" name="from" defaultValue={from} className={`w-[150px] ${FILTER_CONTROL}`} />
              <span className="text-gray-400 dark:text-slate-500">–</span>
              <input type="date" name="to" defaultValue={to} className={`w-[150px] ${FILTER_CONTROL}`} />
            </div>
            <select name="year" defaultValue={String(selectedYear)} className={`shrink-0 ${FILTER_CONTROL}`}>
              {yearOptions.map((taxYear) => (
                <option key={taxYear} value={taxYear}>
                  ปีภาษี {taxYear}
                </option>
              ))}
            </select>
            <select name="cert" defaultValue={certFilter} className={`shrink-0 ${FILTER_CONTROL}`}>
              <option value="">ใบ 50 ทวิ ทั้งหมด</option>
              <option value="PENDING">ยังไม่ได้รับใบ</option>
              <option value="RECEIVED">ได้รับใบแล้ว</option>
            </select>
            <select name="status" defaultValue={statusFilter} className={`shrink-0 ${FILTER_CONTROL}`}>
              <option value="ACTIVE">เฉพาะที่ใช้งาน</option>
              <option value="CANCELLED">เฉพาะที่ยกเลิก</option>
              <option value="">ทั้งหมด</option>
            </select>
            <AdminSearchSubmitButton className={FILTER_SUBMIT}>ค้นหา</AdminSearchSubmitButton>
            {hasFilters && (
              <Link href="/admin/wht" className={FILTER_CLEAR}>
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
              <th className="px-4 py-3 text-left font-medium">วันที่จ่าย</th>
              <th className="px-4 py-3 text-left font-medium">เอกสาร</th>
              <th className="px-4 py-3 text-left font-medium">ลูกค้า</th>
              <th className="px-4 py-3 text-left font-medium">ประเภทเงินได้</th>
              <th className="px-4 py-3 text-right font-medium">ฐานภาษี</th>
              <th className="px-4 py-3 text-right font-medium">อัตรา</th>
              <th className="px-4 py-3 text-right font-medium">ภาษีที่ถูกหัก</th>
              <th className="w-56 px-4 py-3 text-left font-medium">หนังสือรับรอง 50 ทวิ</th>
              <th className="w-40 px-4 py-3 text-left font-medium">ไฟล์แนบ</th>
              <th className="px-4 py-3 text-center font-medium">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center text-sm text-slate-400 dark:text-slate-500">
                  ไม่พบรายการภาษีถูกหัก ณ ที่จ่าย
                </td>
              </tr>
            ) : (
              rows.map((row, index) => {
                const docNo = row.receipt?.receiptNo ?? row.sale?.saleNo ?? "-";
                const docHref = row.receipt
                  ? `/admin/receipts/${row.receipt.id}`
                  : row.sale
                    ? `/admin/sales/${row.sale.id}`
                    : null;

                return (
                  <tr key={row.id} className={getAdminDocumentRowClass(row.status === "CANCELLED")}>
                    <td className="px-4 py-3 text-center text-slate-400 dark:text-slate-500">
                      {(pageNum - 1) * PAGE_SIZE + index + 1}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700 dark:text-slate-200">
                      {formatDateThai(row.payDate)}
                    </td>
                    <td className="px-4 py-3">
                      {docHref ? (
                        <Link
                          href={docHref}
                          className="font-medium text-[#1e3a5f] hover:underline dark:text-sky-300"
                        >
                          {docNo}
                        </Link>
                      ) : (
                        <span className="text-slate-700 dark:text-slate-200">{docNo}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                      {row.customerNameSnapshot}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {row.incomeLabelSnapshot}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">
                      {formatBaht(Number(row.baseAmount))}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">
                      {Number(row.rate).toLocaleString("th-TH", { minimumFractionDigits: 2 })}%
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-[#1e3a5f] dark:text-sky-300">
                      {formatBaht(Number(row.taxAmount))}
                    </td>
                    <td className="px-4 py-3">
                      <WhtCertificateCell
                        id={row.id}
                        certNo={row.certNo ?? ""}
                        certDate={row.certDate ? formatDateOnlyForInput(row.certDate) : ""}
                        received={row.certReceivedAt !== null}
                        canEdit={canUpdate && row.status === "ACTIVE"}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <WhtAttachmentCell
                        whtReceivedId={row.id}
                        attachments={row.attachments}
                        canEdit={canUpdate && row.status === "ACTIVE"}
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
                      {row.status === "CANCELLED" ? (
                        <AdminStatusBadge tone="danger">ยกเลิก</AdminStatusBadge>
                      ) : (
                        <AdminStatusBadge tone="success">ใช้งาน</AdminStatusBadge>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </AdminTableSection>

      {totalPages > 1 && (
        <Pagination
          currentPage={pageNum}
          totalPages={totalPages}
          basePath="/admin/wht"
          searchParams={paginationParams}
        />
      )}
    </div>
  );
};

export default WhtReceivedPage;
