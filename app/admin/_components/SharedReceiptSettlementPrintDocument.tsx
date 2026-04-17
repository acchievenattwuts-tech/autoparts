import PrintDocumentHeader from "@/app/admin/_components/print/PrintDocumentHeader";
import PrintDocumentRoot from "@/app/admin/_components/print/PrintDocumentRoot";
import PrintSignatureGrid from "@/app/admin/_components/print/PrintSignatureGrid";
import {
  PRINT_BODY_BORDER_CLASS,
  PRINT_HEADER_CELL_CLASS,
  PRINT_SECTION_BORDER_CLASS,
  PRINT_SECTION_TOP_BORDER_CLASS,
  PRINT_TABLE_CELL_CLASS,
  formatPrintDate,
  formatPrintNumber,
  formatThaiBahtText,
  getPrintNoticeLines,
  type NumericLike,
  type PrintShopConfig,
} from "@/app/admin/_components/print/shared";

type ReceiptSettlementItem = {
  id: string;
  paidAmount: NumericLike;
  saleId?: string | null;
  cnId?: string | null;
  sale?: {
    saleNo: string;
    saleDate: Date | string;
    netAmount: NumericLike;
  } | null;
  creditNote?: {
    cnNo: string;
    cnDate: Date | string;
    totalAmount: NumericLike;
  } | null;
};

type ReceiptSettlementPrintReceipt = {
  receiptNo: string;
  receiptDate: Date | string;
  customerName?: string | null;
  totalAmount: NumericLike;
  paymentMethod: "CASH" | "TRANSFER" | "CREDIT";
  note?: string | null;
  signerSignatureUrl?: string | null;
  items: ReceiptSettlementItem[];
  customer?: {
    name?: string | null;
    phone?: string | null;
    address?: string | null;
  } | null;
};

type TransferAccount = {
  name: string;
  bankName?: string | null;
  accountNo?: string | null;
} | null;

const PAYMENT_PRINT_LABELS: { key: "CASH" | "TRANSFER"; label: string }[] = [
  { key: "CASH", label: "เงินสด" },
  { key: "TRANSFER", label: "เงินโอน" },
];

const RECEIPT_SUMMARY_GRID_STYLE = {
  gridTemplateColumns: "10rem 7rem minmax(0,1fr) minmax(0,1fr)",
} as const;
const RECEIPT_FIXED_COLUMN_WIDTHS = ["10rem", "7rem"] as const;

const SharedReceiptSettlementPrintDocument = ({
  receipt,
  shopConfig,
  signerDisplayName,
  receivedTransferAccount,
  rootId,
  rootClassName,
}: {
  receipt: ReceiptSettlementPrintReceipt;
  shopConfig: PrintShopConfig;
  signerDisplayName: string;
  receivedTransferAccount: TransferAccount;
  rootId?: string;
  rootClassName?: string;
}) => {
  const customerName = receipt.customer?.name ?? receipt.customerName ?? "-";
  const customerPhone = receipt.customer?.phone ?? null;
  const receiptDateText = formatPrintDate(receipt.receiptDate);
  const totalAmountInWords = formatThaiBahtText(Number(receipt.totalAmount));
  const printNoticeLines = getPrintNoticeLines(shopConfig.printNoticeText);
  const hasPrintNotice = printNoticeLines.length > 0;
  const hasSupportBlock = receipt.paymentMethod === "CASH" || receipt.paymentMethod === "TRANSFER" || Boolean(receivedTransferAccount);

  return (
    <PrintDocumentRoot
      rootId={rootId}
      rootClassName={rootClassName ?? "mx-auto flex min-h-screen max-w-[900px] flex-col bg-white p-8 text-[13px] leading-snug"}
      rootStyle={undefined}
    >
      <PrintDocumentHeader shopConfig={shopConfig} title="ใบเสร็จรับเงิน" />

      <div className="mb-4 grid grid-cols-2 gap-3 text-xs">
        <div className={`space-y-0.5 rounded ${PRINT_SECTION_BORDER_CLASS} p-2`}>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">ข้อมูลลูกค้า</p>
          <p>
            <span className="text-gray-500">ชื่อ: </span>
            <span className="font-semibold">{customerName}</span>
          </p>
          {receipt.customer?.address ? (
            <p>
              <span className="text-gray-500">ที่อยู่: </span>
              {receipt.customer.address}
            </p>
          ) : null}
          {customerPhone ? (
            <p>
              <span className="text-gray-500">โทร: </span>
              {customerPhone}
            </p>
          ) : null}
        </div>

        <div className={`rounded ${PRINT_SECTION_BORDER_CLASS} p-2`}>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">ข้อมูลเอกสาร</p>
          <table className="w-full text-xs">
            <tbody>
              <tr>
                <td className="whitespace-nowrap py-0.5 pr-2 text-gray-500">เลขที่เอกสาร</td>
                <td className="font-mono font-semibold">{receipt.receiptNo}</td>
              </tr>
              <tr>
                <td className="whitespace-nowrap py-0.5 pr-2 text-gray-500">วันที่เอกสาร</td>
                <td>{receiptDateText}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <table className="w-full table-fixed border-collapse text-xs">
        <colgroup>
          <col style={{ width: RECEIPT_FIXED_COLUMN_WIDTHS[0] }} />
          <col style={{ width: RECEIPT_FIXED_COLUMN_WIDTHS[1] }} />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr className="bg-gray-100 text-gray-700">
            <th className={`w-40 ${PRINT_HEADER_CELL_CLASS} text-left`}>เลขที่เอกสารอ้างอิง</th>
            <th className={`w-28 ${PRINT_HEADER_CELL_CLASS} text-left`}>วันที่เอกสาร</th>
            <th className={`${PRINT_HEADER_CELL_CLASS} text-right`}>ยอดเอกสาร</th>
            <th className={`${PRINT_HEADER_CELL_CLASS} text-right`}>ยอดรับชำระ</th>
          </tr>
        </thead>
        <tbody>
          {receipt.items.map((item) => {
            const isCreditNote = Boolean(item.cnId);
            const documentNo = item.sale?.saleNo ?? item.creditNote?.cnNo ?? "-";
            const documentDate = item.sale?.saleDate ?? item.creditNote?.cnDate ?? null;
            const documentAmount = item.sale?.netAmount ?? item.creditNote?.totalAmount ?? 0;

            return (
              <tr key={item.id}>
                <td className={`${PRINT_TABLE_CELL_CLASS} font-mono ${isCreditNote ? "text-emerald-700" : "text-gray-700"}`}>
                  {documentNo}
                  {isCreditNote ? " (เครดิต CN)" : ""}
                </td>
                <td className={PRINT_TABLE_CELL_CLASS}>{documentDate ? formatPrintDate(documentDate) : "-"}</td>
                <td className={`${PRINT_TABLE_CELL_CLASS} text-right`}>{formatPrintNumber(Number(documentAmount))}</td>
                <td className={`${PRINT_TABLE_CELL_CLASS} text-right font-medium ${isCreditNote ? "text-emerald-700" : "text-gray-900"}`}>
                  {isCreditNote ? "-" : ""}
                  {formatPrintNumber(Number(item.paidAmount))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mb-4 grid text-xs" style={RECEIPT_SUMMARY_GRID_STYLE}>
        <div className={`col-span-2 border-b border-l ${PRINT_BODY_BORDER_CLASS} p-2`}>
          <p className="mb-1 text-gray-400">หมายเหตุ:</p>
          <p className="min-h-[2rem] text-gray-700">{receipt.note ?? ""}</p>
        </div>
        <div className={`relative col-span-2 border-r border-b ${PRINT_BODY_BORDER_CLASS} p-2 pb-1`}>
          <div className={`pointer-events-none absolute inset-y-0 left-1/2 border-r ${PRINT_BODY_BORDER_CLASS}`} />
          <div className="flex h-full flex-col justify-end gap-1 pl-[calc(50%+0.5rem)] text-xs">
            <div className="flex items-end justify-between gap-3">
              <div className="font-bold text-gray-900">ยอดรับชำระรวม</div>
              <div className="text-right font-bold text-[#1e3a5f]">{formatPrintNumber(Number(receipt.totalAmount))}</div>
            </div>
            <div className="text-right text-[11px] text-gray-500">({totalAmountInWords})</div>
          </div>
        </div>
      </div>

      <div className="mt-auto">
        {hasSupportBlock || hasPrintNotice ? (
          <div
            className={`mb-5 grid gap-4 ${hasSupportBlock && hasPrintNotice ? "grid-cols-[minmax(0,6fr)_minmax(0,4fr)]" : "grid-cols-1"}`}
          >
            {hasSupportBlock ? (
              <div className={`${PRINT_SECTION_BORDER_CLASS} px-3 py-2 text-xs`}>
                <div className="flex items-center gap-6">
                  <span className="whitespace-nowrap text-gray-500">ชำระโดย:</span>
                  {PAYMENT_PRINT_LABELS.map(({ key, label }) => (
                    <span key={key} className="flex items-center gap-1.5">
                      <span className={`inline-flex h-4 w-4 items-center justify-center ${PRINT_SECTION_BORDER_CLASS} text-[11px]`}>
                        {receipt.paymentMethod === key ? "✓" : ""}
                      </span>
                      {label}
                    </span>
                  ))}
                </div>
                {receipt.paymentMethod === "TRANSFER" && receivedTransferAccount ? (
                  <div className={`mt-2 ${PRINT_SECTION_TOP_BORDER_CLASS} pt-2 text-gray-700`}>
                    <p className="font-medium text-gray-900">รับชำระเข้าบัญชี</p>
                    <p>{receivedTransferAccount.bankName || receivedTransferAccount.name}</p>
                    <p className="font-mono text-[#1e3a5f]">{receivedTransferAccount.accountNo || "-"}</p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {hasPrintNotice ? (
              <div className={`${PRINT_SECTION_BORDER_CLASS} p-3`}>
                <p className="mb-2 text-center text-xs font-semibold text-gray-900">โปรดทราบ</p>
                <ol className="space-y-1 pl-4 text-[11px] leading-snug text-gray-700">
                  {printNoticeLines.map((line, index) => (
                    <li key={`${index}-${line}`}>{line}</li>
                  ))}
                </ol>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="receipt-footer">
          <PrintSignatureGrid
            columns={[
              {
                label: "ผู้รับเงิน",
                nameText: signerDisplayName,
                showNameLine: true,
                dateText: `วันที่ ${receiptDateText}`,
                signatureUrl: receipt.signerSignatureUrl,
                signatureAlt: `ลายเซ็น ${signerDisplayName}`,
              },
              {
                label: "ผู้ชำระเงิน",
                nameText: "\u00A0",
                showNameLine: true,
                dateText: "วันที่ ................................................",
              },
            ]}
          />
        </div>
      </div>
    </PrintDocumentRoot>
  );
};

export default SharedReceiptSettlementPrintDocument;
