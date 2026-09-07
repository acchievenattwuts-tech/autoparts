export const dynamic = "force-dynamic";

import Link from "next/link";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminTableSection from "@/components/shared/AdminTableSection";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import Pagination from "@/components/shared/Pagination";
import { getAdminDocumentRowClass } from "@/lib/admin-status-presentation";
import { hasPermissionAccess } from "@/lib/access-control";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { formatDateThai } from "@/lib/th-date";

const PAGE_SIZE = 30;

const THAI_MONTHS = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
];

const FORM_LABELS: Record<string, string> = {
  PND1: "ภ.ง.ด.1",
  PND1A: "ภ.ง.ด.1ก",
  PND2: "ภ.ง.ด.2",
  PND3: "ภ.ง.ด.3",
  PND3A: "ภ.ง.ด.3ก",
  PND53: "ภ.ง.ด.53",
  PND54: "ภ.ง.ด.54",
};

const CHANNEL_LABELS: Record<string, string> = {
  PAPER: "ยื่นกระดาษ",
  RD_PREP: "RD Prep",
  SWC: "ฝากไฟล์ SWC",
  EFILING: "e-Filing",
};

const formatBaht = (value: number) => value.toLocaleString("th-TH", { minimumFractionDigits: 2 });

const WhtFilingsPage = async ({ searchParams }: { searchParams: Promise<{ page?: string }> }) => {
  await requirePermission("wht_filings.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canManage = hasPermissionAccess(role, permissions, "wht_filings.manage");

  const { page } = await searchParams;
  const pageNum = Math.max(1, parseInt(page ?? "1", 10));

  const [filings, totalCount, pendingCertificates] = await Promise.all([
    db.whtFiling.findMany({
      orderBy: [{ taxYear: "desc" }, { taxMonth: "desc" }, { filingNo: "desc" }],
      take: PAGE_SIZE,
      skip: (pageNum - 1) * PAGE_SIZE,
      select: {
        id: true,
        filingNo: true,
        formType: true,
        taxMonth: true,
        taxYear: true,
        submissionType: true,
        additionalSeq: true,
        totalRecords: true,
        totalBaseAmount: true,
        totalTaxAmount: true,
        grandTotalAmount: true,
        status: true,
        filedAt: true,
        filedChannel: true,
      },
    }),
    db.whtFiling.count(),
    db.whtCertificate.count({ where: { status: "ACTIVE", filingId: null } }),
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="รอบยื่นแบบ ภ.ง.ด."
        description="รวมหนังสือรับรอง 50 ทวิ เข้ารอบยื่นรายเดือน พิมพ์ใบปะหน้า + ใบแนบ และสร้างไฟล์นำส่งกรมสรรพากร"
        actions={
          canManage ? (
            <Link
              href="/admin/wht/filings/new"
              className="inline-flex items-center gap-2 rounded-xl bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163055]"
            >
              <Plus size={16} /> สร้างรอบยื่น
            </Link>
          ) : null
        }
      />

      {pendingCertificates > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/5 dark:text-amber-300">
          มีหนังสือรับรอง <span className="font-semibold">{pendingCertificates}</span> ฉบับที่ยังไม่ได้เข้ารอบยื่น —
          นำส่งภายใน 7 วันนับแต่วันสิ้นเดือนของเดือนที่จ่ายเงิน
        </div>
      )}

      <AdminTableSection>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 dark:bg-white/5 dark:text-slate-300">
            <tr>
              <th className="px-4 py-3 text-left font-medium">เลขที่รอบ</th>
              <th className="px-4 py-3 text-left font-medium">แบบ</th>
              <th className="px-4 py-3 text-left font-medium">เดือนภาษี</th>
              <th className="px-4 py-3 text-left font-medium">ประเภทการยื่น</th>
              <th className="px-4 py-3 text-right font-medium">จำนวนราย</th>
              <th className="px-4 py-3 text-right font-medium">ภาษีนำส่ง</th>
              <th className="px-4 py-3 text-center font-medium">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {filings.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400 dark:text-slate-500">
                  ยังไม่มีรอบยื่นแบบ
                </td>
              </tr>
            ) : (
              filings.map((filing) => (
                <tr key={filing.id} className={getAdminDocumentRowClass(filing.status === "CANCELLED")}>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/wht/filings/${filing.id}`}
                      className="font-mono font-medium text-[#1e3a5f] hover:underline dark:text-sky-300"
                    >
                      {filing.filingNo}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                    {FORM_LABELS[filing.formType] ?? filing.formType}
                  </td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                    {THAI_MONTHS[filing.taxMonth - 1]} {filing.taxYear}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {filing.submissionType === "ADDITIONAL"
                      ? `ยื่นเพิ่มเติมครั้งที่ ${filing.additionalSeq}`
                      : "ยื่นปกติ"}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700 dark:text-slate-200">
                    {filing.totalRecords}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-[#1e3a5f] dark:text-sky-300">
                    {formatBaht(Number(filing.grandTotalAmount))}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {filing.status === "CANCELLED" ? (
                      <AdminStatusBadge tone="danger">ยกเลิก</AdminStatusBadge>
                    ) : filing.status === "FILED" ? (
                      <>
                        <AdminStatusBadge tone="success">ยื่นแล้ว</AdminStatusBadge>
                        <span className="mt-0.5 block text-xs text-slate-400 dark:text-slate-500">
                          {filing.filedAt ? formatDateThai(filing.filedAt) : ""}
                          {filing.filedChannel ? ` · ${CHANNEL_LABELS[filing.filedChannel]}` : ""}
                        </span>
                      </>
                    ) : (
                      <AdminStatusBadge tone="warning">ร่าง</AdminStatusBadge>
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
          basePath="/admin/wht/filings"
          searchParams={{}}
        />
      )}
    </div>
  );
};

export default WhtFilingsPage;
