import Image from "next/image";
import { toPublicStorageCdnPath } from "@/lib/product-image-url";
import { formatQuotationReference } from "@/lib/sales-quotation-form";
import type { Prisma } from "@/lib/generated/prisma";
import PrintDocumentRoot from "./print/PrintDocumentRoot";
import PrintDocumentHeader from "./print/PrintDocumentHeader";
import { PRINT_BODY_BORDER_CLASS, PRINT_HEADER_CELL_CLASS, PRINT_TABLE_CELL_CLASS, PRINT_SECTION_BORDER_CLASS, PRINT_SECTION_TOP_BORDER_CLASS, formatPrintDate, formatPrintNumber, formatThaiBahtText, type PrintShopConfig } from "./print/shared";
import { addThailandDays } from "@/lib/th-date";
import { VAT_TYPE_LABELS } from "@/lib/vat";

/** คอลัมน์กล่องยอดรวมท้ายเอกสาร — กว้าง 15rem เท่ากับใบขายสินค้า (SharedSalesDeliveryPrintDocument) */
const PRINT_SUMMARY_GRID_STYLE = { gridTemplateColumns: "minmax(0,1fr) 15rem" } as const;

type Quote = Prisma.SalesQuotationGetPayload<{ include: { items: { include: { product: { select: { code: true; name: true } } } } } }>;
export default function QuotationPrintDocument({ quote, config, account }: { quote: Quote; config: PrintShopConfig; account: { name: string; bankName: string | null; accountNo: string | null } | null }) {
  const netAmountInWords = formatThaiBahtText(Number(quote.netAmount));
  /** ลายเซ็นที่ตรึงไว้กับเอกสาร (signerSignatureUrl) ไม่ใช่ค่าปัจจุบันของ User */
  const signatureSrc = toPublicStorageCdnPath(quote.signerSignatureUrl) ?? quote.signerSignatureUrl ?? "";
  /** ซ่อนแถวภาษีเมื่อเอกสารไม่คิด VAT — กันแถว 0.00 โผล่เหมือนเดิม */
  const hasVat = quote.vatType !== "NO_VAT" && Number(quote.vatRate) > 0;
  return <PrintDocumentRoot rootId="quotation-print" rootClassName="mx-auto flex max-w-[900px] flex-col bg-white p-8 text-[13px] leading-snug">
    <PrintDocumentHeader shopConfig={config} title="ใบเสนอราคา" pageLabel="" />
    {quote.status === "CANCELLED" && <p className="mb-3 text-center text-xl font-bold text-red-600">ยกเลิกเอกสาร</p>}
    <div data-print-role="header" className="mb-4 grid grid-cols-2 gap-3 text-xs">
      <div className={`${PRINT_SECTION_BORDER_CLASS} space-y-1 rounded p-2`}><p className="font-semibold">ข้อมูลลูกค้า</p><p>ชื่อ: {quote.customerName}</p>{quote.customerAddress && <p className="whitespace-pre-line">ที่อยู่: {quote.customerAddress}</p>}{quote.customerPhone && <p>โทร: {quote.customerPhone}</p>}</div>
      <div className={`${PRINT_SECTION_BORDER_CLASS} space-y-1 rounded p-2`}><p>เลขที่เอกสาร: <strong>{formatQuotationReference(quote.quotationNo, quote.revision)}</strong></p><p>วันที่เอกสาร: {formatPrintDate(quote.quotationDate)}</p><p>เครดิต: {quote.creditTerm} วัน</p><p>วันครบกำหนด: {formatPrintDate(addThailandDays(quote.quotationDate, quote.creditTerm))}</p></div>
    </div>
    <table className="w-full border-collapse text-xs"><thead><tr className="bg-gray-100">{["#", "รหัสสินค้า", "รายละเอียด", "จำนวน", "หน่วย", "ราคา/หน่วย", "ส่วนลด/หน่วย", "ยอดรวม"].map((label) => <th className={PRINT_HEADER_CELL_CLASS} key={label}>{label}</th>)}</tr></thead>
      <tbody>{quote.items.map((row, index) => <tr key={row.id} className="break-inside-avoid"><td className={PRINT_TABLE_CELL_CLASS}>{index + 1}</td><td className={PRINT_TABLE_CELL_CLASS}>{row.product.code}</td><td className={PRINT_TABLE_CELL_CLASS}>{row.product.name}{row.moreDetail ? <span className="font-normal text-gray-700"> {row.moreDetail}</span> : null}</td><td className={`${PRINT_TABLE_CELL_CLASS} text-right`}>{Number(row.showQty).toLocaleString("th-TH", { maximumFractionDigits: 4 })}</td><td className={PRINT_TABLE_CELL_CLASS}>{row.showUnitName}</td><td className={`${PRINT_TABLE_CELL_CLASS} text-right`}>{formatPrintNumber(Number(row.unitListPrice))}</td><td className={`${PRINT_TABLE_CELL_CLASS} text-right`}>{formatPrintNumber(Number(row.unitListPrice) - Number(row.salePrice))}</td><td className={`${PRINT_TABLE_CELL_CLASS} text-right`}>{formatPrintNumber(Number(row.totalAmount))}</td></tr>)}</tbody>
    </table>
    <div data-print-role="summary" className={`mb-4 grid break-inside-avoid text-xs ${PRINT_SECTION_TOP_BORDER_CLASS}`} style={PRINT_SUMMARY_GRID_STYLE}>
      <div className={`border-x border-b ${PRINT_BODY_BORDER_CLASS} p-2`}>
        <p className="mb-1 text-gray-700">หมายเหตุ:</p>
        <p className="min-h-[2rem] whitespace-pre-line text-gray-700">{quote.note ?? ""}</p>
        {hasVat ? <p className="pt-1 text-gray-700">{VAT_TYPE_LABELS[quote.vatType]}</p> : null}
      </div>
      <div className={`border-r border-b ${PRINT_BODY_BORDER_CLASS} p-2`}>
        <div className="flex justify-between"><span className="text-gray-700">มูลค่ารวม</span><span>{formatPrintNumber(Number(quote.totalAmount))}</span></div>
        <div className="flex justify-between"><span className="text-gray-700">ส่วนลด</span><span>{formatPrintNumber(Number(quote.discount))}</span></div>
        {hasVat ? (
          <>
            <div className="flex justify-between"><span className="text-gray-700">ยอดก่อนภาษี</span><span>{formatPrintNumber(Number(quote.subtotalAmount))}</span></div>
            <div className="flex justify-between"><span className="text-gray-700">VAT {Number(quote.vatRate)}%</span><span>{formatPrintNumber(Number(quote.vatAmount))}</span></div>
          </>
        ) : null}
        <div className={`flex justify-between ${PRINT_SECTION_TOP_BORDER_CLASS} pt-1 font-bold text-gray-900`}>
          <span>ยอดสุทธิ</span>
          <span className="text-[#1e3a5f]">{formatPrintNumber(Number(quote.netAmount))}</span>
        </div>
        <div className="pt-1 text-right text-[11px] text-gray-700">({netAmountInWords})</div>
      </div>
    </div>
    <div data-print-role="footer" className="mt-auto grid grid-cols-2 items-end gap-8 pt-12 break-inside-avoid">
      <div className="space-y-1 text-xs">{account && <><p className="font-semibold">ช่องทางการชำระเงิน</p><p>ชื่อบัญชี: {account.name}</p><p>ธนาคาร: {account.bankName ?? "-"}</p><p>เลขที่บัญชี: {account.accountNo ?? "-"}</p></>}</div>
      <div className="ml-auto w-60 space-y-2 text-center">
        <p>ขอแสดงความนับถือ</p>
        {/* ไม่มีลายเซ็น = ไม่แทรกกล่องเลย เส้นกลับไปใช้ pt-7 เดิม ระยะจึงไม่ขยับ
            mb-[-32px] ดึงลายเซ็นลงมาชิดเส้น: หักทั้ง space-y-2 (8px), ช่องว่างเหนือ
            glyph "_" ในกล่องบรรทัด (~17px) และพื้นที่โปร่งใต้ลายเส้นในไฟล์ PNG
            (~15px จาก 64px) เหลือระยะจริงจากปลายลายเซ็นถึงเส้นราว 9px */}
        {signatureSrc ? <div className="mb-[-32px] flex h-16 items-end justify-center"><Image src={signatureSrc} alt={`ลายเซ็น ${quote.signerName ?? quote.updatedByName}`} width={200} height={64} className="max-h-16 w-auto object-contain" loading="eager" unoptimized /></div> : null}
        <p className={signatureSrc ? "" : "pt-7"}>____________________________</p>
        <p>{quote.updatedByName}</p>
        <p>{formatPrintDate(quote.quotationDate)}</p>
      </div>
    </div>
  </PrintDocumentRoot>;
}
