import PrintDocumentCopyWatermark from "@/app/admin/_components/print/PrintDocumentCopyWatermark";
import PrintDocumentHeader from "@/app/admin/_components/print/PrintDocumentHeader";
import PrintDocumentRoot from "@/app/admin/_components/print/PrintDocumentRoot";
import PrintDocumentStatusStamp from "@/app/admin/_components/print/PrintDocumentStatusStamp";
import PrintDocumentVerifyMark from "@/app/admin/_components/print/PrintDocumentVerifyMark";
import PrintSignatureGrid from "@/app/admin/_components/print/PrintSignatureGrid";
import type { PrintDocumentVerifyBadge } from "@/lib/verify-token";
import {
  getDefaultMarketplaceShippingAddress,
  getMarketplaceChannelConfig,
  isManualMarketplaceChannel,
  type ManualMarketplaceChannel,
} from "@/lib/marketplace/config";
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
  unitListPrice?: NumericLike | null;
  lineDiscount?: NumericLike | null;
  totalAmount: NumericLike;
  showQty?: NumericLike | null;
  showUnitName?: string | null;
  showPricePerUnit?: NumericLike | null;
  unitScale?: NumericLike | null;
  moreDetail?: string | null;
  warrantyDays?: NumericLike | null;
  lotItems: SalePrintLotItem[];
  product: SalePrintProduct;
};

type SalePrintSale = {
  saleNo: string;
  saleDate: Date | string;
  /** ช่องทางขาย — ใบขาย marketplace ซ่อนข้อมูลการชำระเงินของร้าน */
  channel?: string | null;
  /** เลขคำสั่งซื้อของแพลตฟอร์ม ใช้จับคู่ตอนแพ็คของ */
  channelRefNo?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  shippingAddress?: string | null;
  totalAmount: NumericLike;
  discount: NumericLike;
  netAmount: NumericLike;
  shippingFee?: NumericLike | null;
  amountRemain?: NumericLike | null;
  paymentType: "CASH_SALE" | "CREDIT_SALE";
  paymentMethod?: string | null;
  status?: string | null;
  creditTerm?: number | null;
  note?: string | null;
  signerSignatureUrl?: string | null;
  customer?: SalePrintCustomer | null;
  items: SalePrintItem[];
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

type SalePrintPayment = {
  accountName: string;
  accountType: "CASH" | "BANK";
  bankName?: string | null;
  accountNo?: string | null;
  amount: NumericLike;
};

const PAYMENT_PRINT_LABELS: { key: string; label: string }[] = [
  { key: "CASH", label: "เงินสด" },
  { key: "TRANSFER", label: "เงินโอน" },
];

const PRINT_GRID_COLUMN_STYLE = {
  gridTemplateColumns: "1.75rem 6rem minmax(0,1fr) 3rem 3rem 6rem 6rem",
} as const;
const PRINT_PROMPTPAY_CARD_SIZE = 140;
const PRINT_PROMPTPAY_QR_SIZE = 92;
const PRINT_THAI_QR_LOGO_WIDTH = 70;
const PRINT_THAI_QR_LOGO_HEIGHT = 21;
const PRINT_PROMPTPAY_LOGO_WIDTH = 58;
const PRINT_PROMPTPAY_LOGO_HEIGHT = 20;

const SharedSalesDeliveryPrintDocument = ({
  sale,
  shopConfig,
  dueDate,
  signerDisplayName,
  transferPrimaryAccount,
  receivedTransferAccount,
  payments,
  promptPayQrDataUrl,
  qrAmount,
  verify,
  copyLabel,
  rootId,
  rootClassName,
}: {
  sale: SalePrintSale;
  shopConfig: PrintShopConfig;
  dueDate: Date;
  signerDisplayName: string;
  transferPrimaryAccount: TransferAccount | null;
  receivedTransferAccount: ReceivedTransferAccount;
  payments?: SalePrintPayment[];
  promptPayQrDataUrl: string | null;
  qrAmount: number;
  verify?: PrintDocumentVerifyBadge | null;
  /** ข้อความลายน้ำกลางหน้า เช่น "ต้นฉบับ" / "สำเนา" — ไม่ส่งมา = ไม่มีลายน้ำ */
  copyLabel?: string | null;
  rootId?: string;
  rootClassName?: string;
}) => {
  // ใบขาย marketplace: ลูกค้าจ่ายเงินให้แพลตฟอร์มไปแล้ว เอกสารนี้เป็นใบเสร็จที่แนบไป
  // ในกล่องให้ลูกค้า จึงไม่พิมพ์เลขบัญชี/QR/ช่องทางรับเงินของร้าน และไม่มีช่องลายเซ็น
  const isMarketplaceSale = isManualMarketplaceChannel(sale.channel ?? "");
  const marketplaceLabel = isMarketplaceSale
    ? getMarketplaceChannelConfig(sale.channel as ManualMarketplaceChannel).label
    : null;
  // ใบเสร็จในกล่องเป็นจุดเดียวที่ลูกค้า marketplace เห็นช่องทางติดต่อร้านโดยตรง
  const shopContactLines = [
    shopConfig.shopPhone ? `โทร ${shopConfig.shopPhone}` : null,
    shopConfig.shopLineId ? `LINE ${shopConfig.shopLineId}` : null,
    shopConfig.shopWebsiteUrl,
  ].filter((line): line is string => Boolean(line));
  const hasPaymentBreakdown = Boolean(payments && payments.length > 0);
  const paymentsTotal = payments?.reduce((sum, payment) => sum + Number(payment.amount), 0) ?? 0;
  const hasCash = hasPaymentBreakdown
    ? payments!.some((payment) => payment.accountType === "CASH")
    : sale.paymentMethod === "CASH";
  const hasTransfer = hasPaymentBreakdown
    ? payments!.some((payment) => payment.accountType === "BANK")
    : sale.paymentMethod === "TRANSFER";
  // ใบขาย marketplace ผูกกับ "ลูกค้ากลาง" ของช่องทางเพื่อให้บัญชีเดินได้ แต่ใบเสร็จที่
  // แนบไปในกล่องต้องเป็นชื่อผู้ซื้อจริงที่แอดมินคีย์ไว้ ไม่ใช่ชื่อลูกค้ากลาง
  const customerName = isMarketplaceSale
    ? sale.customerName?.trim() || sale.customer?.name || "-"
    : sale.customer?.name ?? sale.customerName ?? "-";
  const customerPhone = isMarketplaceSale
    ? sale.customerPhone?.trim() || null
    : sale.customer?.phone ?? sale.customerPhone ?? null;
  // ที่อยู่ของลูกค้ากลางไม่ใช่ที่อยู่ผู้ซื้อ ใบ marketplace จึงใช้ที่อยู่ที่คีย์ไว้กับใบขายแทน
  // และถ้ายังเป็นข้อความตั้งต้นของช่องทาง แปลว่าไม่ได้คีย์ที่อยู่จริง — ซ่อนแถวไปเลย
  const marketplaceAddress = isMarketplaceSale ? sale.shippingAddress?.trim() || null : null;
  const customerAddress = isMarketplaceSale
    ? marketplaceAddress &&
      marketplaceAddress !==
        getDefaultMarketplaceShippingAddress(sale.channel as ManualMarketplaceChannel)
      ? marketplaceAddress
      : null
    : sale.customer?.address ?? null;
  const printNoticeLines = getPrintNoticeLines(shopConfig.printNoticeText);
  const documentDateText = formatPrintDate(sale.saleDate);
  const netAmountInWords = formatThaiBahtText(Number(sale.netAmount));
  const hasPrintNotice = printNoticeLines.length > 0;
  const hasPrintSupportBlock =
    !isMarketplaceSale && (Boolean(transferPrimaryAccount) || sale.paymentType === "CASH_SALE");
  const shouldUsePromptPayCard = sale.paymentType === "CREDIT_SALE";
  const transferSlipLineId = shopConfig.shopLineId?.trim() || null;
  const isCancelled = sale.status === "CANCELLED";
  const isPaidCreditSale =
    !isCancelled &&
    sale.paymentType === "CREDIT_SALE" &&
    sale.amountRemain != null &&
    Number(sale.amountRemain) <= 0;

  return (
    <PrintDocumentRoot rootId={rootId} rootClassName={rootClassName}>
      {copyLabel ? <PrintDocumentCopyWatermark label={copyLabel} /> : null}
      {verify ? <PrintDocumentVerifyMark verify={verify} /> : null}

      {isCancelled ? (
        <PrintDocumentStatusStamp label="เอกสารถูกยกเลิกแล้ว" tone="cancelled" />
      ) : isPaidCreditSale ? (
        <PrintDocumentStatusStamp label="ชำระเงินแล้ว" tone="paid" />
      ) : null}

      <PrintDocumentHeader
        shopConfig={shopConfig}
        title={
          isMarketplaceSale
            ? "ใบเสร็จรับเงิน / ใบส่งสินค้า"
            : sale.paymentType === "CREDIT_SALE"
              ? "ใบแจ้งหนี้ / ใบส่งของ"
              : "ใบเสร็จรับเงิน"
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 text-xs">
        <div className={`space-y-0.5 rounded ${PRINT_SECTION_BORDER_CLASS} p-2`}>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-700">ข้อมูลลูกค้า</p>
          <p>
            <span className="text-gray-700">ชื่อ: </span>
            <span className="font-semibold">{customerName}</span>
          </p>
          {customerAddress ? (
            <p>
              <span className="text-gray-700">ที่อยู่: </span>
              {customerAddress}
            </p>
          ) : null}
          {customerPhone ? (
            <p>
              <span className="text-gray-700">โทร: </span>
              {customerPhone}
            </p>
          ) : null}
          {sale.paymentType === "CREDIT_SALE" && sale.shippingAddress ? (
            <p>
              <span className="text-gray-700">ที่อยู่จัดส่ง: </span>
              {sale.shippingAddress}
            </p>
          ) : null}
        </div>

        <div className={`rounded ${PRINT_SECTION_BORDER_CLASS} p-2`}>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-700">ข้อมูลเอกสาร</p>
          <table className="w-full text-xs">
            <tbody>
              <tr>
                <td className="whitespace-nowrap py-0.5 pr-2 text-gray-700">เลขที่เอกสาร</td>
                <td className="font-mono font-semibold">{sale.saleNo}</td>
              </tr>
              {isMarketplaceSale ? (
                <tr>
                  <td className="whitespace-nowrap py-0.5 pr-2 text-gray-700">
                    เลขคำสั่งซื้อ {marketplaceLabel}
                  </td>
                  <td className="font-mono font-semibold">{sale.channelRefNo ?? "-"}</td>
                </tr>
              ) : null}
              <tr>
                <td className="whitespace-nowrap py-0.5 pr-2 text-gray-700">วันที่เอกสาร</td>
                <td>{formatPrintDate(sale.saleDate)}</td>
              </tr>
              {isMarketplaceSale ? null : (
                <>
                  <tr>
                    <td className="whitespace-nowrap py-0.5 pr-2 text-gray-700">เงื่อนไขชำระ</td>
                    <td>{`${sale.creditTerm ?? 0} วัน`}</td>
                  </tr>
                  <tr>
                    <td className="whitespace-nowrap py-0.5 pr-2 text-gray-700">วันครบกำหนด</td>
                    <td>{formatPrintDate(dueDate)}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-gray-100 text-gray-900">
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
          {sale.items.map((item, idx) => {
            const displayScale = Number(item.unitScale ?? 1) || 1;
            const displayQty = item.showQty != null ? Number(item.showQty) : Number(item.quantity);
            const displayUnitName = item.showUnitName ?? item.product.reportUnitName;
            const displayPrice = item.showPricePerUnit != null ? Number(item.showPricePerUnit) : Number(item.salePrice);
            const listPrice = item.unitListPrice != null ? Number(item.unitListPrice) : 0;
            const hasLineDiscount = listPrice - displayPrice > 0.009;
            const warrantyDays = item.warrantyDays != null ? Number(item.warrantyDays) : 0;

            return (
              <tr key={item.id}>
                <td className={`${PRINT_TABLE_CELL_CLASS} text-center text-gray-700`}>{idx + 1}</td>
                <td className={`whitespace-nowrap ${PRINT_TABLE_CELL_CLASS} font-mono text-gray-700`}>{item.product.code}</td>
                <td className={PRINT_TABLE_CELL_CLASS}>
                  <div className="font-medium text-gray-900">
                    {item.product.name}
                    {warrantyDays > 0 ? (
                      <span className="font-normal text-gray-700"> (รับประกัน {warrantyDays.toLocaleString("th-TH")} วัน)</span>
                    ) : null}
                    {item.moreDetail ? <span className="font-normal text-gray-700"> {item.moreDetail}</span> : null}
                  </div>
                  {item.lotItems.length > 0 ? (
                    <div className="mt-0.5 text-[11px] text-gray-600">
                      Lot: {item.lotItems.map((lot) => `${lot.lotNo} × ${(Number(lot.qty) / displayScale).toLocaleString("th-TH")}`).join(", ")}
                    </div>
                  ) : null}
                </td>
                <td className={`${PRINT_TABLE_CELL_CLASS} text-center`}>{displayQty.toLocaleString("th-TH")}</td>
                <td className={`${PRINT_TABLE_CELL_CLASS} text-center text-gray-700`}>{displayUnitName}</td>
                <td className={`${PRINT_TABLE_CELL_CLASS} text-right`}>
                  {hasLineDiscount ? (
                    <span className="block text-[10px] text-gray-500 line-through">{formatPrintNumber(listPrice)}</span>
                  ) : null}
                  <span className={hasLineDiscount ? "block font-medium" : undefined}>{formatPrintNumber(displayPrice)}</span>
                </td>
                <td className={`${PRINT_TABLE_CELL_CLASS} text-right font-medium`}>{formatPrintNumber(Number(item.totalAmount))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mb-4 grid text-xs" style={PRINT_GRID_COLUMN_STYLE}>
        <div className={`col-span-4 border-x border-b ${PRINT_BODY_BORDER_CLASS} p-2`}>
          <p className="mb-1 text-gray-700">หมายเหตุ:</p>
          <p className="min-h-[2rem] text-gray-700">{sale.note ?? ""}</p>
        </div>
        <div className={`col-span-3 border-r border-b ${PRINT_BODY_BORDER_CLASS} p-2`}>
          <div className="flex justify-between">
            <span className="text-gray-700">มูลค่ารวม</span>
            <span>{formatPrintNumber(Number(sale.totalAmount))}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-700">ส่วนลด</span>
            <span>{formatPrintNumber(Number(sale.discount))}</span>
          </div>
          {Number(sale.shippingFee) > 0 ? (
            <div className="flex justify-between">
              <span className="text-gray-700">ค่าจัดส่ง</span>
              <span>{formatPrintNumber(Number(sale.shippingFee))}</span>
            </div>
          ) : null}
          <div className={`flex justify-between ${PRINT_SECTION_TOP_BORDER_CLASS} pt-1 font-bold text-gray-900`}>
            <span>ยอดสุทธิ</span>
            <span className="text-[#1e3a5f]">{formatPrintNumber(Number(sale.netAmount))}</span>
          </div>
          <div className="pt-1 text-right text-[11px] text-gray-700">({netAmountInWords})</div>
        </div>
      </div>

      <div className="mt-auto">
        {isMarketplaceSale ? (
          <div className={`mb-5 ${PRINT_SECTION_BORDER_CLASS} px-3 py-2.5 text-xs`}>
            <p className="font-semibold text-gray-900">
              ขอบคุณที่อุดหนุน{shopConfig.shopName ? ` ${shopConfig.shopName}` : "ร้านของเรา"} ค่ะ
            </p>
            <p className="mt-1 text-gray-700">
              สินค้ามีปัญหาหรือสอบถามอะไหล่เพิ่มเติม ติดต่อร้านได้โดยตรง ยินดีให้คำแนะนำ
            </p>
            {shopContactLines.length > 0 ? (
              <p className="mt-1 font-medium text-gray-900">{shopContactLines.join("  |  ")}</p>
            ) : null}
          </div>
        ) : null}
        {hasPrintSupportBlock || hasPrintNotice ? (
          <div
            className={`mb-5 grid gap-4 ${hasPrintNotice && hasPrintSupportBlock ? "grid-cols-[minmax(0,6fr)_minmax(0,4fr)]" : "grid-cols-1"}`}
          >
            {hasPrintSupportBlock ? (
            <div>
              {transferPrimaryAccount ? (
                <div className={`grid grid-cols-[1fr_140px] gap-4 ${PRINT_SECTION_BORDER_CLASS} p-3 text-xs`}>
                  <div className="space-y-1">
                    <p className="font-semibold text-gray-900">ข้อมูลบัญชีรับโอน</p>
                    <p className="text-gray-700">{transferPrimaryAccount.bankName || transferPrimaryAccount.name}</p>
                    <p className="font-mono text-sm text-[#1e3a5f]">{transferPrimaryAccount.accountNo || "-"}</p>
                    <p className="text-gray-700">
                      ชื่อบัญชี: <span className="font-semibold text-gray-900">{transferPrimaryAccount.name}</span>
                    </p>
                    {transferPrimaryAccount.promptPayId ? (
                      <p className="text-gray-700">
                        PromptPay ID: <span className="font-mono">{transferPrimaryAccount.promptPayId}</span>
                      </p>
                    ) : (
                      <p className="text-gray-700">ยังไม่ได้ตั้ง PromptPay ID จึงแสดงเฉพาะข้อมูลบัญชีสำหรับโอน</p>
                    )}
                    <p className="text-gray-700">
                      ยอดสำหรับสแกน/โอน: <span className="font-semibold text-gray-900">{formatPrintNumber(qrAmount)}</span>
                    </p>
                    <div className={`mt-2 rounded border ${PRINT_BODY_BORDER_CLASS} bg-gray-50 px-2.5 py-2 text-[11px] leading-snug text-gray-700`}>
                      กรุณาส่งหลักฐานสลิปการโอนเงินมาที่{" "}
                      <span className="font-semibold text-gray-900">
                        Line ID : {transferSlipLineId ?? "-"}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-center">
                    {promptPayQrDataUrl ? (
                      shouldUsePromptPayCard ? (
                        <div
                          className="overflow-hidden border border-gray-400 bg-white"
                          style={{ width: PRINT_PROMPTPAY_CARD_SIZE }}
                        >
                          <div className="flex items-center justify-center bg-[#00427a] px-2 py-1">
                            <img
                              src="/Thai_QR_Logo_white.svg"
                              alt="Thai QR Payment"
                              width={PRINT_THAI_QR_LOGO_WIDTH}
                              height={PRINT_THAI_QR_LOGO_HEIGHT}
                            />
                          </div>
                          <div className="flex flex-col items-center px-2 pb-1 pt-0.5">
                            <img
                              src="/PromptPay-logo-trim.png"
                              alt="PromptPay"
                              width={PRINT_PROMPTPAY_LOGO_WIDTH}
                              height={PRINT_PROMPTPAY_LOGO_HEIGHT}
                            />
                            <img
                              src={promptPayQrDataUrl}
                              alt={`PromptPay QR ${sale.saleNo}`}
                              width={PRINT_PROMPTPAY_QR_SIZE}
                              height={PRINT_PROMPTPAY_QR_SIZE}
                              className="mt-0.5"
                            />
                            <div className="text-center text-[8px] font-medium leading-tight text-gray-700">สแกนเพื่อชำระเงิน</div>
                            <div className="text-center text-[11px] font-semibold leading-tight text-gray-900">
                              {formatPrintNumber(qrAmount)} บาท
                            </div>
                          </div>
                        </div>
                      ) : (
                        <img
                          src={promptPayQrDataUrl}
                          alt={`PromptPay QR ${sale.saleNo}`}
                          width={PRINT_PROMPTPAY_CARD_SIZE}
                          height={PRINT_PROMPTPAY_CARD_SIZE}
                        />
                      )
                    ) : (
                      <div
                        className={`flex items-center justify-center border border-dashed ${PRINT_BODY_BORDER_CLASS} p-4 text-center text-[11px] text-gray-600`}
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
                    <span className="whitespace-nowrap text-gray-700">ชำระโดย:</span>
                    {PAYMENT_PRINT_LABELS.map(({ key, label }) => (
                      <span key={key} className="flex items-center gap-1.5">
                        <span className={`inline-flex h-4 w-4 items-center justify-center ${PRINT_SECTION_BORDER_CLASS} text-[11px]`}>
                          {(key === "CASH" ? hasCash : hasTransfer) ? "✓" : ""}
                        </span>
                        {label}
                      </span>
                    ))}
                  </div>
                  {hasPaymentBreakdown ? (
                    <div className={`mt-2 ${PRINT_SECTION_TOP_BORDER_CLASS} pt-2 text-gray-700`}>
                      <p className="mb-1 font-medium text-gray-900">รายละเอียดการรับชำระ</p>
                      <table className="w-full text-[11px]">
                        <tbody>
                          {payments!.map((payment, index) => (
                            <tr key={index}>
                              <td className="py-0.5 pr-2 align-top">
                                {payment.accountType === "CASH"
                                  ? `เงินสด — ${payment.accountName}`
                                  : `${payment.bankName || "เงินโอน"}${
                                      payment.accountNo ? ` เลขที่ ${payment.accountNo}` : ""
                                    } — ${payment.accountName}`}
                              </td>
                              <td className="whitespace-nowrap py-0.5 text-right font-mono text-[#1e3a5f]">
                                {formatPrintNumber(Number(payment.amount))}
                              </td>
                            </tr>
                          ))}
                          {payments!.length > 1 ? (
                            <tr className={PRINT_SECTION_TOP_BORDER_CLASS}>
                              <td className="py-0.5 pr-2 font-medium text-gray-900">รวมรับชำระ</td>
                              <td className="whitespace-nowrap py-0.5 text-right font-mono font-bold text-[#1e3a5f]">
                                {formatPrintNumber(paymentsTotal)}
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  ) : sale.paymentMethod === "TRANSFER" && receivedTransferAccount ? (
                    <div className={`mt-2 ${PRINT_SECTION_TOP_BORDER_CLASS} pt-2 text-gray-700`}>
                      <p className="font-medium text-gray-900">รับชำระเข้าบัญชี</p>
                      <p>{receivedTransferAccount.bankName || receivedTransferAccount.name}</p>
                      <p className="font-mono text-[#1e3a5f]">{receivedTransferAccount.accountNo || "-"}</p>
                      <p>
                        ชื่อบัญชี: <span className="font-medium text-gray-900">{receivedTransferAccount.name}</span>
                      </p>
                    </div>
                  ) : null}
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
          {isMarketplaceSale ? null : sale.paymentType === "CREDIT_SALE" ? (
            <PrintSignatureGrid
              reserveVerifySpace={Boolean(verify)}
              columns={[
                {
                  label: "ผู้ส่งของ",
                  dateText: "วันที่ ................................................",
                },
                {
                  label: "ผู้รับของ",
                  dateText: "วันที่ ................................................",
                },
              ]}
            />
          ) : (
            <PrintSignatureGrid
              reserveVerifySpace={Boolean(verify)}
              columns={[
                {
                  label: "ผู้รับเงิน",
                  nameText: signerDisplayName,
                  showNameLine: true,
                  dateText: `วันที่ ${documentDateText}`,
                  signatureUrl: sale.signerSignatureUrl,
                  signatureAlt: `ลายเซ็น ${signerDisplayName}`,
                },
                {
                  label: "ผู้รับของ",
                  nameText: "\u00A0",
                  showNameLine: true,
                  dateText: "วันที่ ................................................",
                },
              ]}
            />
          )}
        </div>
      </div>
    </PrintDocumentRoot>
  );
};

export default SharedSalesDeliveryPrintDocument;
