type NumericLike = number | string | { toString(): string };

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

type ReceiptSettlementShopConfig = {
  shopName?: string | null;
  shopAddress?: string | null;
  shopPhone?: string | null;
  shopTaxId?: string | null;
};

const PAYMENT_PRINT_LABELS: { key: "CASH" | "TRANSFER" | "CREDIT"; label: string }[] = [
  { key: "CASH", label: "เงินสด" },
  { key: "TRANSFER", label: "เงินโอน" },
  { key: "CREDIT", label: "เครดิต" },
];

const PRINT_HEADER_BORDER_CLASS = "border-gray-400";
const PRINT_BODY_BORDER_CLASS = "border-gray-300";
const PRINT_HEADER_CELL_CLASS = `border ${PRINT_HEADER_BORDER_CLASS} px-1.5 py-1.5`;
const PRINT_TABLE_CELL_CLASS = `border ${PRINT_BODY_BORDER_CLASS} px-1.5 py-1.5`;
const PRINT_SECTION_BORDER_CLASS = `border ${PRINT_BODY_BORDER_CLASS}`;
const PRINT_SECTION_BOTTOM_BORDER_CLASS = `border-b ${PRINT_BODY_BORDER_CLASS}`;
const PRINT_SECTION_TOP_BORDER_CLASS = `border-t ${PRINT_BODY_BORDER_CLASS}`;

const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("th-TH-u-ca-gregory", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

const fmtNum = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ReceiptSettlementPrintDocument({
  receipt,
  shopConfig,
  signerDisplayName,
  receivedTransferAccount,
  rootId,
  rootClassName,
}: {
  receipt: ReceiptSettlementPrintReceipt;
  shopConfig: ReceiptSettlementShopConfig;
  signerDisplayName: string;
  receivedTransferAccount: TransferAccount;
  rootId?: string;
  rootClassName?: string;
}) {
  const customerName = receipt.customer?.name ?? receipt.customerName ?? "-";
  const customerPhone = receipt.customer?.phone ?? null;
  const receiptDateText = fmtDate(receipt.receiptDate);

  return (
    <div
      id={rootId}
      className={rootClassName ?? "mx-auto bg-white p-8 text-[13px] leading-snug"}
      style={{ maxWidth: "900px" }}
    >
      <div className={`mb-4 flex items-start justify-between ${PRINT_SECTION_BOTTOM_BORDER_CLASS} pb-3`}>
        <div className="space-y-0.5 text-xs text-gray-600">
          {shopConfig.shopName ? <p className="text-sm font-semibold text-gray-800">{shopConfig.shopName}</p> : null}
          {shopConfig.shopAddress ? <p>{shopConfig.shopAddress}</p> : null}
          {shopConfig.shopPhone ? <p>โทร: {shopConfig.shopPhone}</p> : null}
          {shopConfig.shopTaxId ? <p>เลขประจำตัวผู้เสียภาษี: {shopConfig.shopTaxId}</p> : null}
        </div>
        <div className="text-right">
          <p className={`inline-block ${PRINT_SECTION_BORDER_CLASS} px-6 py-1.5 text-base font-bold`}>
            ใบเสร็จรับเงิน
          </p>
          <p className="mt-1 text-xs text-gray-400">หน้า 1/1</p>
        </div>
      </div>

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
              <tr>
                <td className="whitespace-nowrap py-0.5 pr-2 text-gray-500">ช่องทางชำระ</td>
                <td>{PAYMENT_PRINT_LABELS.find((item) => item.key === receipt.paymentMethod)?.label ?? "-"}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <table className="w-full border-collapse text-xs">
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
                <td className={PRINT_TABLE_CELL_CLASS}>{documentDate ? fmtDate(documentDate) : "-"}</td>
                <td className={`${PRINT_TABLE_CELL_CLASS} text-right`}>{fmtNum(Number(documentAmount))}</td>
                <td className={`${PRINT_TABLE_CELL_CLASS} text-right font-medium ${isCreditNote ? "text-emerald-700" : "text-gray-900"}`}>
                  {isCreditNote ? "-" : ""}
                  {fmtNum(Number(item.paidAmount))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mb-4 grid grid-cols-[minmax(0,1fr)_260px] text-xs">
        <div className={`border-x border-b ${PRINT_BODY_BORDER_CLASS} p-2`}>
          <p className="mb-1 text-gray-400">หมายเหตุ:</p>
          <p className="min-h-[2rem] text-gray-700">{receipt.note ?? ""}</p>
        </div>
        <div className={`border-r border-b ${PRINT_BODY_BORDER_CLASS} p-2`}>
          <div className={`flex justify-between ${PRINT_SECTION_TOP_BORDER_CLASS} pt-1 font-bold text-gray-900`}>
            <span>ยอดรับชำระรวม</span>
            <span className="text-[#1e3a5f]">{fmtNum(Number(receipt.totalAmount))}</span>
          </div>
        </div>
      </div>

      <div className="mb-5">
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
          {receivedTransferAccount ? (
            <div className={`mt-2 ${PRINT_SECTION_TOP_BORDER_CLASS} pt-2 text-gray-700`}>
              <p className="font-medium text-gray-900">รับชำระเข้าบัญชี</p>
              <p>{receivedTransferAccount.bankName || receivedTransferAccount.name}</p>
              <p className="font-mono text-[#1e3a5f]">{receivedTransferAccount.accountNo || "-"}</p>
            </div>
          ) : null}
        </div>
      </div>

      <div className={`grid grid-cols-2 gap-0 ${PRINT_SECTION_BORDER_CLASS} text-center text-xs`}>
        <div className={`border-r ${PRINT_BODY_BORDER_CLASS}`}>
          <div className="flex h-16 items-end justify-center px-4">
            {receipt.signerSignatureUrl ? (
              <img
                src={receipt.signerSignatureUrl}
                alt={`ลายเซ็น ${signerDisplayName}`}
                className="max-h-[64px] w-auto object-contain"
              />
            ) : null}
          </div>
          <div className={`${PRINT_SECTION_TOP_BORDER_CLASS} py-1.5 font-medium text-gray-700`}>ผู้รับเงิน</div>
          <div className="px-4 pb-1 text-gray-700">{signerDisplayName}</div>
          <div className="px-4 pb-2 text-gray-400">วันที่ {receiptDateText}</div>
        </div>
        <div>
          <div className="h-16" />
          <div className={`${PRINT_SECTION_TOP_BORDER_CLASS} py-1.5 font-medium text-gray-700`}>ผู้ชำระเงิน</div>
          <div className="px-4 pb-1 text-gray-700">&nbsp;</div>
          <div className="px-4 pb-2 text-gray-400">วันที่ ................................................</div>
        </div>
      </div>
    </div>
  );
}
