import PrintDocumentCopyWatermark from "@/app/admin/_components/print/PrintDocumentCopyWatermark";
import PrintDocumentHeader from "@/app/admin/_components/print/PrintDocumentHeader";
import PrintDocumentRoot from "@/app/admin/_components/print/PrintDocumentRoot";
import PrintDocumentStatusStamp from "@/app/admin/_components/print/PrintDocumentStatusStamp";
import PrintSignatureGrid from "@/app/admin/_components/print/PrintSignatureGrid";
import {
  PRINT_SECTION_BORDER_CLASS,
  formatPrintDate,
  formatPrintNumber,
  formatThaiBahtText,
  getPrintNoticeLines,
  type PrintShopConfig,
} from "@/app/admin/_components/print/shared";

export default function CustomerAdvanceRefundPrintDocument({
  refund,
  shopConfig,
  payments,
  copyLabel,
  rootClassName,
}: {
  refund: {
    refundNo: string;
    refundDate: Date | string;
    refundAmount: number;
    note?: string | null;
    status?: string;
    customerAdvance: {
      advanceNo: string;
      customer: {
        name: string;
        address?: string | null;
        phone?: string | null;
      };
    };
    user?: { name?: string | null; signatureUrl?: string | null } | null;
  };
  shopConfig: PrintShopConfig;
  payments: Array<{
    accountName: string;
    bankName?: string | null;
    accountNo?: string | null;
    amount: number;
  }>;
  copyLabel?: string | null;
  rootClassName?: string;
}) {
  const noticeLines = getPrintNoticeLines(shopConfig.printNoticeText);
  const dateText = formatPrintDate(refund.refundDate);
  return (
    <PrintDocumentRoot
      rootClassName={
        rootClassName ??
        "mx-auto flex min-h-screen max-w-[900px] flex-col bg-white p-8 text-[13px] leading-snug"
      }
    >
      {copyLabel ? <PrintDocumentCopyWatermark label={copyLabel} /> : null}
      {refund.status === "CANCELLED" ? (
        <PrintDocumentStatusStamp
          label="เอกสารถูกยกเลิกแล้ว"
          tone="cancelled"
        />
      ) : null}
      <PrintDocumentHeader shopConfig={shopConfig} title="ใบคืนเงินมัดจำ" />
      <div className="mb-4 grid grid-cols-2 gap-3 text-xs">
        <div className={`rounded ${PRINT_SECTION_BORDER_CLASS} p-3`}>
          <p className="mb-1 font-semibold">ข้อมูลลูกค้า</p>
          <p>{refund.customerAdvance.customer.name}</p>
          {refund.customerAdvance.customer.address ? (
            <p>{refund.customerAdvance.customer.address}</p>
          ) : null}
          {refund.customerAdvance.customer.phone ? (
            <p>โทร {refund.customerAdvance.customer.phone}</p>
          ) : null}
        </div>
        <div className={`rounded ${PRINT_SECTION_BORDER_CLASS} p-3`}>
          <p>
            <span className="text-gray-700">เลขที่เอกสาร </span>
            <span className="font-mono font-semibold">{refund.refundNo}</span>
          </p>
          <p>
            <span className="text-gray-700">วันที่ </span>
            {dateText}
          </p>
          <p>
            <span className="text-gray-700">อ้างอิงรับเงินมัดจำ </span>
            <span className="font-mono">
              {refund.customerAdvance.advanceNo}
            </span>
          </p>
        </div>
      </div>
      <div
        className={`mb-4 rounded ${PRINT_SECTION_BORDER_CLASS} p-5 text-center`}
      >
        <p className="text-xs text-gray-700">คืนเงินมัดจำจำนวน</p>
        <p className="my-2 text-3xl font-bold text-[#1e3a5f]">
          {formatPrintNumber(refund.refundAmount)} บาท
        </p>
        <p>({formatThaiBahtText(refund.refundAmount)})</p>
      </div>
      <div className={`mb-4 rounded ${PRINT_SECTION_BORDER_CLASS} p-3 text-xs`}>
        <p className="mb-2 font-semibold">รายละเอียดการคืนเงิน</p>
        {payments.map((payment, index) => (
          <div
            key={`${payment.accountName}-${index}`}
            className="flex justify-between py-1"
          >
            <span>
              {payment.accountName}
              {payment.bankName ? ` · ${payment.bankName}` : ""}
              {payment.accountNo ? ` · ${payment.accountNo}` : ""}
            </span>
            <span className="font-medium">
              {formatPrintNumber(payment.amount)}
            </span>
          </div>
        ))}
      </div>
      <div
        className={`mb-8 min-h-16 rounded ${PRINT_SECTION_BORDER_CLASS} p-3 text-xs`}
      >
        <p className="font-semibold">หมายเหตุ</p>
        <p>{refund.note ?? "-"}</p>
      </div>
      <div className="mt-auto">
        {noticeLines.length ? (
          <div className={`mb-5 ${PRINT_SECTION_BORDER_CLASS} p-3`}>
            <p className="mb-2 text-center text-xs font-semibold text-gray-900">
              โปรดทราบ
            </p>
            <ol className="space-y-1 pl-4 text-[11px] leading-snug text-gray-700">
              {noticeLines.map((line, index) => (
                <li key={`${index}-${line}`}>{line}</li>
              ))}
            </ol>
          </div>
        ) : null}
        <div className="receipt-footer">
          <PrintSignatureGrid
            columns={[
              {
                label: "ผู้จ่ายเงิน",
                dateText: `วันที่ ${dateText}`,
                nameText: refund.user?.name ?? "",
                showNameLine: true,
                signatureUrl: refund.user?.signatureUrl,
                signatureAlt: `ลายเซ็น ${refund.user?.name ?? "ผู้จ่ายเงิน"}`,
              },
              {
                label: "ผู้รับเงิน",
                dateText: "วันที่ ____/____/______",
                nameText: refund.customerAdvance.customer.name,
                showNameLine: true,
              },
            ]}
          />
        </div>
      </div>
    </PrintDocumentRoot>
  );
}
