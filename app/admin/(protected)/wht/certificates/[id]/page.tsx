export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import NavLink from "@/components/shared/NavLink";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { getSiteConfig } from "@/lib/site-config";
import { formatDateThai } from "@/lib/th-date";
import PrintButton from "@/app/admin/(protected)/receipts/[id]/PrintButton";
import WhtCertificatePrintDocument, {
  type WhtCertificateCopyKind,
} from "@/app/admin/_components/WhtCertificatePrintDocument";

const PRINT_ROOT_CLASS =
  "print-slip mx-auto flex min-h-screen max-w-[900px] flex-col bg-white p-8 text-[13px] leading-snug";

const COPIES: WhtCertificateCopyKind[] = ["ORIGINAL_1", "ORIGINAL_2", "OFFICE_COPY"];

const joinAddress = (parts: (string | null | undefined)[]) =>
  parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ");

const WhtCertificateDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  await requirePermission("wht.view");
  const { id } = await params;

  const [certificate, config] = await Promise.all([
    db.whtCertificate.findUnique({
      where: { id },
      include: {
        lines: { orderBy: { lineNo: "asc" } },
        expense: { select: { id: true, expenseNo: true } },
        supplierPayment: { select: { id: true, paymentNo: true } },
        filing: { select: { id: true, filingNo: true } },
      },
    }),
    getSiteConfig(),
  ]);

  if (!certificate) notFound();

  const payer = {
    name: config.shopName,
    taxId: config.taxPayerId,
    branchNo: config.taxBranchNo,
    address: joinAddress([
      config.taxAddrNo,
      config.taxAddrRoad ? `ถนน${config.taxAddrRoad}` : null,
      config.taxAddrSubdistrict ? `ต./แขวง ${config.taxAddrSubdistrict}` : null,
      config.taxAddrDistrict ? `อ./เขต ${config.taxAddrDistrict}` : null,
      config.taxAddrProvince,
      config.taxAddrPostcode,
    ]) || config.shopAddress,
  };

  const printData = {
    certNo: certificate.certNo,
    certDate: certificate.certDate,
    formType: certificate.formType,
    status: certificate.status,
    payeeName: joinAddress([
      certificate.payeeTitleName,
      certificate.payeeFirstName,
      certificate.payeeLastName,
    ]) || certificate.payeeName,
    payeeTaxId13: certificate.payeeTaxId13,
    payeeBranchNo: certificate.payeeBranchNo,
    payeeAddress: joinAddress([
      certificate.payeeAddrNo,
      certificate.payeeAddrRoad ? `ถนน${certificate.payeeAddrRoad}` : null,
      certificate.payeeAddrSubdistrict ? `ต./แขวง ${certificate.payeeAddrSubdistrict}` : null,
      certificate.payeeAddrDistrict ? `อ./เขต ${certificate.payeeAddrDistrict}` : null,
      certificate.payeeAddrProvince,
      certificate.payeeAddrPostcode,
    ]),
    totalBaseAmount: Number(certificate.totalBaseAmount),
    totalTaxAmount: Number(certificate.totalTaxAmount),
    note: certificate.note,
    lines: certificate.lines.map((line) => ({
      lineNo: line.lineNo,
      incomeLabelSnapshot: line.incomeLabelSnapshot,
      payDate: line.payDate,
      baseAmount: Number(line.baseAmount),
      rate: Number(line.rate),
      taxAmount: Number(line.taxAmount),
      payCondition: line.payCondition,
    })),
  };

  const missingPayerTaxId = !config.taxPayerId;

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #wht-certificate, #wht-certificate * { visibility: visible; }
          #wht-certificate, #wht-certificate * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          #wht-certificate {
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
            href="/admin/wht/certificates"
            className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f] dark:text-slate-400 dark:hover:text-sky-300"
          >
            <ChevronLeft size={16} /> หนังสือรับรอง 50 ทวิ
          </NavLink>
          <span className="text-gray-300 dark:text-slate-600">/</span>
          <span className="font-mono text-sm font-medium text-gray-700 dark:text-slate-300">
            {certificate.certNo}
          </span>
        </div>
        <PrintButton />
      </div>

      {missingPayerTaxId && (
        <div className="no-print mb-4 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/5 dark:text-amber-300">
          ยังไม่ได้ตั้งค่าเลขประจำตัวผู้เสียภาษีของกิจการ — กรอกที่หน้าตั้งค่าข้อมูลกิจการก่อนพิมพ์ใช้งานจริง
        </div>
      )}

      <div className="no-print mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-white/10 dark:bg-slate-950/40">
          <p className="text-xs text-slate-500 dark:text-slate-400">เอกสารต้นทาง</p>
          <p className="mt-1 font-medium text-slate-800 dark:text-slate-100">
            {certificate.expense ? (
              <NavLink href={`/admin/expenses/${certificate.expense.id}`} className="hover:underline">
                {certificate.expense.expenseNo}
              </NavLink>
            ) : certificate.supplierPayment ? (
              <NavLink
                href={`/admin/supplier-payments/${certificate.supplierPayment.id}`}
                className="hover:underline"
              >
                {certificate.supplierPayment.paymentNo}
              </NavLink>
            ) : (
              "ออกเดี่ยว ไม่ผูกเอกสาร"
            )}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-white/10 dark:bg-slate-950/40">
          <p className="text-xs text-slate-500 dark:text-slate-400">เดือน/ปีภาษีที่ต้องนำส่ง</p>
          <p className="mt-1 font-medium text-slate-800 dark:text-slate-100">
            {String(certificate.taxMonth).padStart(2, "0")}/{certificate.taxYear}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-white/10 dark:bg-slate-950/40">
          <p className="text-xs text-slate-500 dark:text-slate-400">รอบยื่นแบบ</p>
          <p className="mt-1 font-medium text-slate-800 dark:text-slate-100">
            {certificate.filing ? certificate.filing.filingNo : "ยังไม่ได้นำไปยื่น"}
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            ออกเมื่อ {formatDateThai(certificate.certDate)}
          </p>
        </div>
      </div>

      {/* พิมพ์ครบชุดตามประกาศอธิบดีฯ ฉบับที่ 62: ฉบับที่ 1, ฉบับที่ 2 และสำเนาเก็บไว้เอง */}
      <div id="wht-certificate" className="min-w-0">
        {COPIES.map((copyKind) => (
          <WhtCertificatePrintDocument
            key={copyKind}
            certificate={printData}
            payer={payer}
            copyKind={copyKind}
            rootClassName={PRINT_ROOT_CLASS}
          />
        ))}
      </div>
    </>
  );
};

export default WhtCertificateDetailPage;
