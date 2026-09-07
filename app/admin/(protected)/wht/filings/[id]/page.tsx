export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import NavLink from "@/components/shared/NavLink";
import { ChevronLeft, Download } from "lucide-react";
import { db } from "@/lib/db";
import { hasPermissionAccess } from "@/lib/access-control";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { getSiteConfig } from "@/lib/site-config";
import AdminExportLink from "@/components/shared/AdminExportLink";
import PrintButton from "@/app/admin/(protected)/receipts/[id]/PrintButton";
import WhtFilingPrintDocument from "@/app/admin/_components/WhtFilingPrintDocument";
import { toPayConditionCode } from "@/lib/wht-export";
import FilingStatusPanel from "./FilingStatusPanel";

const PRINT_ROOT_CLASS =
  "print-slip mx-auto flex min-h-screen max-w-[900px] flex-col bg-white p-8 text-[13px] leading-snug";

const joinAddress = (parts: (string | null | undefined)[]) =>
  parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ");

const WhtFilingDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  await requirePermission("wht_filings.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canManage = hasPermissionAccess(role, permissions, "wht_filings.manage");

  const { id } = await params;

  const [filing, config] = await Promise.all([
    db.whtFiling.findUnique({
      where: { id },
      include: {
        certificates: {
          where: { status: "ACTIVE" },
          orderBy: [{ payDate: "asc" }, { certNo: "asc" }],
          include: { lines: { orderBy: { lineNo: "asc" } } },
        },
      },
    }),
    getSiteConfig(),
  ]);

  if (!filing) notFound();
  if (filing.formType !== "PND3" && filing.formType !== "PND53") notFound();

  const payer = {
    name: config.shopName,
    taxId: config.taxPayerId,
    branchNo: config.taxBranchNo,
    address:
      joinAddress([
        config.taxAddrNo,
        config.taxAddrRoad ? `ถนน${config.taxAddrRoad}` : null,
        config.taxAddrSubdistrict ? `ต./แขวง ${config.taxAddrSubdistrict}` : null,
        config.taxAddrDistrict ? `อ./เขต ${config.taxAddrDistrict}` : null,
        config.taxAddrProvince,
        config.taxAddrPostcode,
      ]) || config.shopAddress,
  };

  const printData = {
    filingNo: filing.filingNo,
    formType: filing.formType,
    taxMonth: filing.taxMonth,
    taxYear: filing.taxYear,
    submissionType: filing.submissionType,
    additionalSeq: filing.additionalSeq,
    totalRecords: filing.totalRecords,
    totalBaseAmount: Number(filing.totalBaseAmount),
    totalTaxAmount: Number(filing.totalTaxAmount),
    surchargeAmount: Number(filing.surchargeAmount),
    grandTotalAmount: Number(filing.grandTotalAmount),
    status: filing.status,
    filedAt: filing.filedAt,
    payees: filing.certificates.map((certificate, index) => ({
      sequenceNo: index + 1,
      taxId13: certificate.payeeTaxId13,
      branchNo: certificate.payeeBranchNo,
      titleName: certificate.payeeTitleName,
      firstName: certificate.payeeFirstName,
      lastName: certificate.payeeLastName,
      address: joinAddress([
        certificate.payeeAddrNo,
        certificate.payeeAddrRoad ? `ถนน${certificate.payeeAddrRoad}` : null,
        certificate.payeeAddrSubdistrict ? `ต./แขวง ${certificate.payeeAddrSubdistrict}` : null,
        certificate.payeeAddrDistrict ? `อ./เขต ${certificate.payeeAddrDistrict}` : null,
        certificate.payeeAddrProvince,
        certificate.payeeAddrPostcode,
      ]),
      lines: certificate.lines.map((line) => ({
        incomeLabel: line.incomeLabelSnapshot,
        payDate: line.payDate,
        rate: Number(line.rate),
        baseAmount: Number(line.baseAmount),
        taxAmount: Number(line.taxAmount),
        payConditionCode: toPayConditionCode(line.payCondition),
      })),
    })),
  };

  const missingPayerTaxId = !config.taxPayerId;

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #wht-filing, #wht-filing * { visibility: visible; }
          #wht-filing, #wht-filing * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          #wht-filing {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <NavLink
            href="/admin/wht/filings"
            className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f] dark:text-slate-400 dark:hover:text-sky-300"
          >
            <ChevronLeft size={16} /> รอบยื่นแบบ ภ.ง.ด.
          </NavLink>
          <span className="text-gray-300 dark:text-slate-600">/</span>
          <span className="font-mono text-sm font-medium text-gray-700 dark:text-slate-300">
            {filing.filingNo}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AdminExportLink
            href={`/admin/wht/filings/${filing.id}/export?format=format20`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-[#1e3a5f] hover:text-[#1e3a5f] dark:border-white/10 dark:text-slate-300 dark:hover:border-sky-400 dark:hover:text-sky-300"
          >
            <Download size={14} /> ไฟล์ Format กลาง 2.0
          </AdminExportLink>
          <AdminExportLink
            href={`/admin/wht/filings/${filing.id}/export?format=rdprep`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-[#1e3a5f] hover:text-[#1e3a5f] dark:border-white/10 dark:text-slate-300 dark:hover:border-sky-400 dark:hover:text-sky-300"
          >
            <Download size={14} /> ไฟล์ RD Prep
          </AdminExportLink>
          <PrintButton />
        </div>
      </div>

      {missingPayerTaxId && (
        <div className="no-print mb-4 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/5 dark:text-amber-300">
          ยังไม่ได้ตั้งค่าเลขประจำตัวผู้เสียภาษีของกิจการ — สร้างไฟล์นำส่งไม่ได้จนกว่าจะกรอกที่หน้าตั้งค่าข้อมูลกิจการ
        </div>
      )}

      <div className="no-print mb-6">
        <FilingStatusPanel
          filingId={filing.id}
          status={filing.status}
          canManage={canManage}
        />
      </div>

      <div id="wht-filing" className="min-w-0">
        <WhtFilingPrintDocument
          filing={printData}
          payer={payer}
          rootClassName={PRINT_ROOT_CLASS}
        />
      </div>
    </>
  );
};

export default WhtFilingDetailPage;
