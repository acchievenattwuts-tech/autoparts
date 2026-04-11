import Image from "next/image";

type NumericLike = number | string | { toString(): string };

type SalePrintCustomer = {
  name?: string | null;
  phone?: string | null;
  address?: string | null;
};

type SalePrintProduct = {
  code: string;
  name: string;
  reportUnitName: string;
};

type SalePrintLotItem = {
  lotNo: string;
  qty: NumericLike;
};

type SalePrintItem = {
  id: string;
  quantity: NumericLike;
  salePrice: NumericLike;
  totalAmount: NumericLike;
  lotItems: SalePrintLotItem[];
  product: SalePrintProduct;
};

type SalePrintSale = {
  saleNo: string;
  saleDate: Date | string;
  customerName?: string | null;
  customerPhone?: string | null;
  shippingAddress?: string | null;
  totalAmount: NumericLike;
  discount: NumericLike;
  netAmount: NumericLike;
  shippingFee?: NumericLike | null;
  paymentType: "CASH_SALE" | "CREDIT_SALE";
  paymentMethod?: string | null;
  creditTerm?: number | null;
  note?: string | null;
  signerSignatureUrl?: string | null;
  customer?: SalePrintCustomer | null;
  items: SalePrintItem[];
};

type SalePrintShopConfig = {
  shopName?: string | null;
  shopAddress?: string | null;
  shopPhone?: string | null;
  shopWebsiteUrl?: string | null;
  shopLineId?: string | null;
  printNoticeText?: string | null;
};

type TransferAccount = {
  name: string;
  bankName?: string | null;
  accountNo?: string | null;
  promptPayId?: string | null;
};

type ReceivedTransferAccount = {
  name: string;
  bankName?: string | null;
  accountNo?: string | null;
} | null;

const PAYMENT_PRINT_LABELS: { key: string; label: string }[] = [
  { key: "CASH", label: "เงินสด" },
  { key: "TRANSFER", label: "เงินโอน" },
];

const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("th-TH-u-ca-gregory", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

const fmtNum = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PRINT_HEADER_BORDER_CLASS = "border-gray-400";
const PRINT_BODY_BORDER_CLASS = "border-gray-300";
const PRINT_HEADER_CELL_CLASS = `border ${PRINT_HEADER_BORDER_CLASS} px-1.5 py-1.5`;
const PRINT_TABLE_CELL_CLASS = `border ${PRINT_BODY_BORDER_CLASS} px-1.5 py-1.5`;
const PRINT_SECTION_BORDER_CLASS = `border ${PRINT_BODY_BORDER_CLASS}`;
const PRINT_SECTION_BOTTOM_BORDER_CLASS = `border-b ${PRINT_BODY_BORDER_CLASS}`;
const PRINT_SECTION_TOP_BORDER_CLASS = `border-t ${PRINT_BODY_BORDER_CLASS}`;
const PRINT_GRID_COLUMN_STYLE = {
  gridTemplateColumns: "1.75rem 6rem minmax(0,1fr) 3rem 3rem 6rem 6rem",
} as const;
const PRINT_PROMPTPAY_CARD_SIZE = 140;
const PRINT_PROMPTPAY_QR_SIZE = 88;

const getPrintNoticeLines = (text?: string | null) =>
  (text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5);

export default function SalesDeliveryPrintDocument({
  sale,
  shopConfig,
  dueDate,
  signerDisplayName,
  transferPrimaryAccount,
  receivedTransferAccount,
  promptPayQrDataUrl,
  qrAmount,
  rootId,
  rootClassName,
}: {
  sale: SalePrintSale;
  shopConfig: SalePrintShopConfig;
  dueDate: Date;
  signerDisplayName: string;
  transferPrimaryAccount: TransferAccount | null;
  receivedTransferAccount: ReceivedTransferAccount;
  promptPayQrDataUrl: string | null;
  qrAmount: number;
  rootId?: string;
  rootClassName?: string;
}) {
  const customerName = sale.customer?.name ?? sale.customerName ?? "-";
  const customerPhone = sale.customer?.phone ?? sale.customerPhone ?? null;
  const printNoticeLines = getPrintNoticeLines(shopConfig.printNoticeText);
  const documentDateText = fmtDate(sale.saleDate);
  const hasPrintNotice = printNoticeLines.length > 0;
  const hasPrintSupportBlock = Boolean(transferPrimaryAccount) || sale.paymentType === "CASH_SALE";
  const shouldUsePromptPayCard = sale.paymentType === "CREDIT_SALE";

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
          {shopConfig.shopWebsiteUrl || shopConfig.shopLineId ? (
            <p>
              {[shopConfig.shopWebsiteUrl, shopConfig.shopLineId ? `Line: ${shopConfig.shopLineId}` : null]
                .filter(Boolean)
                .join("  |  ")}
            </p>
          ) : null}
        </div>
        <div className="text-right">
          <p className={`inline-block ${PRINT_SECTION_BORDER_CLASS} px-6 py-1.5 text-base font-bold`}>
            {sale.paymentType === "CREDIT_SALE" ? "ใบแจ้งหนี้ / ใบส่งของ" : "ใบเสร็จรับเงิน"}
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
          {sale.customer?.address ? (
            <p>
              <span className="text-gray-500">ที่อยู่: </span>
              {sale.customer.address}
            </p>
          ) : null}
          {customerPhone ? (
            <p>
              <span className="text-gray-500">โทร: </span>
              {customerPhone}
            </p>
          ) : null}
          {sale.paymentType === "CREDIT_SALE" && sale.shippingAddress ? (
            <p>
              <span className="text-gray-500">ที่อยู่จัดส่ง: </span>
              {sale.shippingAddress}
            </p>
          ) : null}
        </div>

        <div className={`rounded ${PRINT_SECTION_BORDER_CLASS} p-2`}>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">ข้อมูลเอกสาร</p>
          <table className="w-full text-xs">
            <tbody>
              <tr>
                <td className="whitespace-nowrap py-0.5 pr-2 text-gray-500">เลขที่เอกสาร</td>
                <td className="font-mono font-semibold">{sale.saleNo}</td>
              </tr>
              <tr>
                <td className="whitespace-nowrap py-0.5 pr-2 text-gray-500">วันที่เอกสาร</td>
                <td>{fmtDate(sale.saleDate)}</td>
              </tr>
              <tr>
                <td className="whitespace-nowrap py-0.5 pr-2 text-gray-500">เงื่อนไขชำระ</td>
                <td>{`${sale.creditTerm ?? 0} วัน`}</td>
              </tr>
              <tr>
                <td className="whitespace-nowrap py-0.5 pr-2 text-gray-500">วันครบกำหนด</td>
                <td>{fmtDate(dueDate)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-gray-100 text-gray-700">
            <th className={`w-7 ${PRINT_HEADER_CELL_CLASS} text-center`}>#</th>
            <th className={`w-24 ${PRINT_HEADER_CELL_CLASS} text-left`}>รหัสสินค้า</th>
            <th className={`${PRINT_HEADER_CELL_CLASS} text-left`}>รายละเอียด</th>
            <th className={`w-12 ${PRINT_HEADER_CELL_CLASS} text-center`}>จำนวน</th>
            <th className={`w-12 ${PRINT_HEADER_CELL_CLASS} text-center`}>หน่วย</th>
            <th className={`w-24 ${PRINT_HEADER_CELL_CLASS} text-right`}>ราคา/หน่วย</th>
            <th className={`w-24 ${PRINT_HEADER_CELL_CLASS} text-right`}>ยอดรวม</th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((item, idx) => (
            <tr key={item.id}>
              <td className={`${PRINT_TABLE_CELL_CLASS} text-center text-gray-500`}>{idx + 1}</td>
              <td className={`whitespace-nowrap ${PRINT_TABLE_CELL_CLASS} font-mono text-gray-500`}>{item.product.code}</td>
              <td className={PRINT_TABLE_CELL_CLASS}>
                <div className="font-medium text-gray-900">{item.product.name}</div>
                {item.lotItems.length > 0 ? (
                  <div className="mt-0.5 text-[11px] text-gray-400">
                    Lot: {item.lotItems.map((lot) => `${lot.lotNo} × ${Number(lot.qty)}`).join(", ")}
                  </div>
                ) : null}
              </td>
              <td className={`${PRINT_TABLE_CELL_CLASS} text-center`}>{Number(item.quantity)}</td>
              <td className={`${PRINT_TABLE_CELL_CLASS} text-center text-gray-500`}>{item.product.reportUnitName}</td>
              <td className={`${PRINT_TABLE_CELL_CLASS} text-right`}>{fmtNum(Number(item.salePrice))}</td>
              <td className={`${PRINT_TABLE_CELL_CLASS} text-right font-medium`}>{fmtNum(Number(item.totalAmount))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mb-4 grid text-xs" style={PRINT_GRID_COLUMN_STYLE}>
        <div className={`col-span-4 border-x border-b ${PRINT_BODY_BORDER_CLASS} p-2`}>
          <p className="mb-1 text-gray-400">หมายเหตุ:</p>
          <p className="min-h-[2rem] text-gray-700">{sale.note ?? ""}</p>
        </div>
        <div className={`col-span-3 border-r border-b ${PRINT_BODY_BORDER_CLASS} p-2`}>
          <div className="flex justify-between">
            <span className="text-gray-500">มูลค่ารวม</span>
            <span>{fmtNum(Number(sale.totalAmount))}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">ส่วนลด</span>
            <span>{fmtNum(Number(sale.discount))}</span>
          </div>
          {Number(sale.shippingFee) > 0 ? (
            <div className="flex justify-between">
              <span className="text-gray-500">ค่าจัดส่ง</span>
              <span>{fmtNum(Number(sale.shippingFee))}</span>
            </div>
          ) : null}
          <div className={`flex justify-between ${PRINT_SECTION_TOP_BORDER_CLASS} pt-1 font-bold text-gray-900`}>
            <span>ยอดสุทธิ</span>
            <span className="text-[#1e3a5f]">{fmtNum(Number(sale.netAmount))}</span>
          </div>
        </div>
      </div>

      <div className="mt-auto">
        {transferPrimaryAccount || sale.paymentType === "CASH_SALE" || hasPrintNotice ? (
          <div
            className={`mb-5 grid gap-4 ${hasPrintNotice && hasPrintSupportBlock ? "grid-cols-[minmax(0,6fr)_minmax(0,4fr)]" : "grid-cols-1"}`}
          >
            <div>
              {transferPrimaryAccount ? (
                <div className={`grid grid-cols-[1fr_140px] gap-4 ${PRINT_SECTION_BORDER_CLASS} p-3 text-xs`}>
                  <div className="space-y-1">
                    <p className="font-semibold text-gray-900">ข้อมูลบัญชีรับโอน</p>
                    <p className="text-gray-700">{transferPrimaryAccount.bankName || transferPrimaryAccount.name}</p>
                    <p className="font-mono text-sm text-[#1e3a5f]">{transferPrimaryAccount.accountNo || "-"}</p>
                    {transferPrimaryAccount.promptPayId ? (
                      <p className="text-gray-500">
                        PromptPay ID: <span className="font-mono">{transferPrimaryAccount.promptPayId}</span>
                      </p>
                    ) : (
                      <p className="text-gray-500">ยังไม่ได้ตั้ง PromptPay ID จึงแสดงเฉพาะข้อมูลบัญชีสำหรับโอน</p>
                    )}
                    <p className="text-gray-500">
                      ยอดสำหรับสแกน/โอน: <span className="font-semibold text-gray-900">{fmtNum(qrAmount)}</span>
                    </p>
                  </div>
                  <div className="flex items-center justify-center">
                    {promptPayQrDataUrl ? (
                      shouldUsePromptPayCard ? (
                        <div
                          className="overflow-hidden rounded-md border border-gray-400 bg-white"
                          style={{ width: PRINT_PROMPTPAY_CARD_SIZE }}
                        >
                          <div className="flex items-center gap-1 bg-[#1f4e78] px-2 py-1.5 text-white">
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-sm border border-white/70">
                              <span className="block h-2.5 w-2.5 rounded-[2px] border border-white/80" />
                            </span>
                            <div className="leading-none">
                              <div className="text-[8px] font-semibold tracking-[0.12em]">THAI QR</div>
                              <div className="text-[10px] font-bold tracking-[0.08em]">PAYMENT</div>
                            </div>
                          </div>
                          <div className="flex flex-col items-center px-2 py-2">
                            <div className="mb-1 text-center text-[8px] font-medium text-gray-500">สแกนเพื่อชำระเงิน</div>
                            <Image
                              src={promptPayQrDataUrl}
                              alt={`PromptPay QR ${sale.saleNo}`}
                              width={PRINT_PROMPTPAY_QR_SIZE}
                              height={PRINT_PROMPTPAY_QR_SIZE}
                            />
                            <div className="mt-1 text-center text-[8px] text-gray-500">{fmtNum(qrAmount)} บาท</div>
                          </div>
                        </div>
                      ) : (
                        <Image
                          src={promptPayQrDataUrl}
                          alt={`PromptPay QR ${sale.saleNo}`}
                          width={PRINT_PROMPTPAY_CARD_SIZE}
                          height={PRINT_PROMPTPAY_CARD_SIZE}
                        />
                      )
                    ) : (
                      <div
                        className={`flex items-center justify-center border border-dashed ${PRINT_BODY_BORDER_CLASS} p-4 text-center text-[11px] text-gray-400`}
                        style={{ height: PRINT_PROMPTPAY_CARD_SIZE, width: PRINT_PROMPTPAY_CARD_SIZE }}
                      >
                        QR จะแสดงเมื่อบัญชีหลักรับโอนมี PromptPay ID
                      </div>
                    )}
                  </div>
                </div>
              ) : null}

              {sale.paymentType === "CASH_SALE" ? (
                <div className={`${transferPrimaryAccount ? "mt-4" : ""} ${PRINT_SECTION_BORDER_CLASS} px-3 py-2 text-xs`}>
                  <div className="flex items-center gap-6">
                    <span className="whitespace-nowrap text-gray-500">ชำระโดย:</span>
                    {PAYMENT_PRINT_LABELS.map(({ key, label }) => (
                      <span key={key} className="flex items-center gap-1.5">
                        <span className={`inline-flex h-4 w-4 items-center justify-center ${PRINT_SECTION_BORDER_CLASS} text-[11px]`}>
                          {sale.paymentMethod === key ? "✓" : ""}
                        </span>
                        {label}
                      </span>
                    ))}
                  </div>
                  {sale.paymentMethod === "TRANSFER" && receivedTransferAccount ? (
                    <div className={`mt-2 ${PRINT_SECTION_TOP_BORDER_CLASS} pt-2 text-gray-700`}>
                      <p className="font-medium text-gray-900">รับชำระเข้าบัญชี</p>
                      <p>{receivedTransferAccount.bankName || receivedTransferAccount.name}</p>
                      <p className="font-mono text-[#1e3a5f]">{receivedTransferAccount.accountNo || "-"}</p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

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
        {sale.paymentType === "CREDIT_SALE" ? (
          <div className={`grid grid-cols-2 gap-0 ${PRINT_SECTION_BORDER_CLASS} text-center text-xs`}>
            {["ผู้ส่งของ", "ผู้รับของ"].map((label, i) => (
              <div key={label} className={i < 1 ? `border-r ${PRINT_BODY_BORDER_CLASS}` : ""}>
                <div className="h-16" />
                <div className={`${PRINT_SECTION_TOP_BORDER_CLASS} py-1.5 font-medium text-gray-700`}>{label}</div>
                <div className="px-4 pb-2 text-gray-400">วันที่ ................................................</div>
              </div>
            ))}
          </div>
        ) : (
          <div className={`grid grid-cols-2 gap-0 ${PRINT_SECTION_BORDER_CLASS} text-center text-xs`}>
            <div className={`border-r ${PRINT_BODY_BORDER_CLASS}`}>
              <div className="flex h-16 items-end justify-center px-4">
                {sale.signerSignatureUrl ? (
                  <img
                    src={sale.signerSignatureUrl}
                    alt={`ลายเซ็น ${signerDisplayName}`}
                    className="max-h-[64px] w-auto object-contain"
                  />
                ) : null}
              </div>
              <div className={`${PRINT_SECTION_TOP_BORDER_CLASS} py-1.5 font-medium text-gray-700`}>ผู้รับเงิน</div>
              <div className="px-4 pb-1 text-gray-700">{signerDisplayName}</div>
              <div className="px-4 pb-2 text-gray-400">วันที่ {documentDateText}</div>
            </div>
            <div>
              <div className="h-16" />
              <div className={`${PRINT_SECTION_TOP_BORDER_CLASS} py-1.5 font-medium text-gray-700`}>ผู้รับของ</div>
              <div className="px-4 pb-1 text-gray-700">&nbsp;</div>
              <div className="px-4 pb-2 text-gray-400">วันที่ {documentDateText}</div>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}


