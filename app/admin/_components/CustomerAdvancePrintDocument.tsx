import PrintDocumentHeader from "@/app/admin/_components/print/PrintDocumentHeader";
import PrintDocumentRoot from "@/app/admin/_components/print/PrintDocumentRoot";
import PrintDocumentStatusStamp from "@/app/admin/_components/print/PrintDocumentStatusStamp";
import PrintDocumentCopyWatermark from "@/app/admin/_components/print/PrintDocumentCopyWatermark";
import PrintSignatureGrid from "@/app/admin/_components/print/PrintSignatureGrid";
import { PRINT_SECTION_BORDER_CLASS, formatPrintDate, formatPrintNumber, formatThaiBahtText, getPrintNoticeLines, type PrintShopConfig } from "@/app/admin/_components/print/shared";

export default function CustomerAdvancePrintDocument({ advance, shopConfig, payments, copyLabel, rootClassName }: {
  advance: { advanceNo: string; advanceDate: Date | string; totalAmount: number; note?: string | null; status?: string; customer: { name: string; address?: string | null; phone?: string | null }; user?: { name?: string | null; signatureUrl?: string | null } | null };
  shopConfig: PrintShopConfig;
  payments: Array<{ accountName: string; accountType: "CASH" | "BANK"; bankName?: string | null; accountNo?: string | null; amount: number }>;
  copyLabel?: string | null;
  rootClassName?: string;
}) {
  const printNoticeLines = getPrintNoticeLines(shopConfig.printNoticeText);
  const documentDateText = formatPrintDate(advance.advanceDate);

  return <PrintDocumentRoot rootClassName={rootClassName ?? "mx-auto flex min-h-screen max-w-[900px] flex-col bg-white p-8 text-[13px] leading-snug"}>
    {copyLabel ? <PrintDocumentCopyWatermark label={copyLabel} /> : null}
    {advance.status === "CANCELLED" ? <PrintDocumentStatusStamp label="เอกสารถูกยกเลิกแล้ว" tone="cancelled" /> : null}
    <PrintDocumentHeader shopConfig={shopConfig} title="ใบรับเงินมัดจำ" />
    <div className="mb-4 grid grid-cols-2 gap-3 text-xs">
      <div className={`rounded ${PRINT_SECTION_BORDER_CLASS} p-3`}><p className="mb-1 font-semibold">ข้อมูลลูกค้า</p><p>{advance.customer.name}</p>{advance.customer.address ? <p>{advance.customer.address}</p> : null}{advance.customer.phone ? <p>โทร {advance.customer.phone}</p> : null}</div>
      <div className={`rounded ${PRINT_SECTION_BORDER_CLASS} p-3`}><p><span className="text-gray-700">เลขที่เอกสาร </span><span className="font-mono font-semibold">{advance.advanceNo}</span></p><p><span className="text-gray-700">วันที่ </span>{formatPrintDate(advance.advanceDate)}</p></div>
    </div>
    <div className={`mb-4 rounded ${PRINT_SECTION_BORDER_CLASS} p-5 text-center`}><p className="text-xs text-gray-700">ได้รับเงินมัดจำจำนวน</p><p className="my-2 text-3xl font-bold text-[#1e3a5f]">{formatPrintNumber(advance.totalAmount)} บาท</p><p>({formatThaiBahtText(advance.totalAmount)})</p></div>
    <div className={`mb-4 rounded ${PRINT_SECTION_BORDER_CLASS} p-3 text-xs`}><p className="mb-2 font-semibold">รายละเอียดการรับเงิน</p>{payments.map((payment, index) => <div key={`${payment.accountName}-${index}`} className="flex justify-between py-1"><span>{payment.accountName}{payment.bankName ? ` · ${payment.bankName}` : ""}{payment.accountNo ? ` · ${payment.accountNo}` : ""}</span><span className="font-medium">{formatPrintNumber(payment.amount)}</span></div>)}</div>
    <div className={`mb-8 min-h-16 rounded ${PRINT_SECTION_BORDER_CLASS} p-3 text-xs`}><p className="font-semibold">หมายเหตุ</p><p>{advance.note ?? "-"}</p></div>
    <div className="mt-auto">
      {printNoticeLines.length ? <div className={`mb-5 ${PRINT_SECTION_BORDER_CLASS} p-3`}><p className="mb-2 text-center text-xs font-semibold text-gray-900">โปรดทราบ</p><ol className="space-y-1 pl-4 text-[11px] leading-snug text-gray-700">{printNoticeLines.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ol></div> : null}
      <div className="receipt-footer"><PrintSignatureGrid columns={[{ label: "ผู้รับเงิน", dateText: `วันที่ ${documentDateText}`, nameText: advance.user?.name ?? "", showNameLine: true, signatureUrl: advance.user?.signatureUrl, signatureAlt: `ลายเซ็น ${advance.user?.name ?? "ผู้รับเงิน"}` }, { label: "ผู้จ่ายเงิน", dateText: "วันที่ ____/____/______", nameText: advance.customer.name, showNameLine: true }]} /></div>
    </div>
  </PrintDocumentRoot>;
}
