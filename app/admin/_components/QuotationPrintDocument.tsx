import { formatQuotationReference } from "@/lib/sales-quotation-form";
import type { Prisma } from "@/lib/generated/prisma";
import PrintDocumentRoot from "./print/PrintDocumentRoot";
import PrintDocumentHeader from "./print/PrintDocumentHeader";
import { PRINT_HEADER_CELL_CLASS, PRINT_TABLE_CELL_CLASS, PRINT_SECTION_BORDER_CLASS, formatPrintDate, formatPrintNumber, formatThaiBahtText, type PrintShopConfig } from "./print/shared";
import { addThailandDays } from "@/lib/th-date";
import { VAT_TYPE_LABELS } from "@/lib/vat";

type Quote = Prisma.SalesQuotationGetPayload<{ include: { items: { include: { product: { select: { code: true; name: true } } } } } }>;
export default function QuotationPrintDocument({ quote, config, account }: { quote: Quote; config: PrintShopConfig; account: { name: string; bankName: string | null; accountNo: string | null } | null }) {
  return <PrintDocumentRoot rootId="quotation-print" rootClassName="mx-auto min-h-[1050px] max-w-[900px] bg-white p-8 text-[13px] leading-snug flex flex-col">
    <PrintDocumentHeader shopConfig={config} title="ใบเสนอราคา" pageLabel="" />
    {quote.status === "CANCELLED" && <p className="mb-3 text-center text-xl font-bold text-red-600">ยกเลิกเอกสาร</p>}
    <div data-print-role="header" className="mb-4 grid grid-cols-2 gap-3 text-xs">
      <div className={`${PRINT_SECTION_BORDER_CLASS} space-y-1 rounded p-2`}><p className="font-semibold">ข้อมูลลูกค้า</p><p>ชื่อ: {quote.customerName}</p>{quote.customerAddress && <p className="whitespace-pre-line">ที่อยู่: {quote.customerAddress}</p>}{quote.customerPhone && <p>โทร: {quote.customerPhone}</p>}</div>
      <div className={`${PRINT_SECTION_BORDER_CLASS} space-y-1 rounded p-2`}><p>เลขที่เอกสาร: <strong>{formatQuotationReference(quote.quotationNo, quote.revision)}</strong></p><p>วันที่เอกสาร: {formatPrintDate(quote.quotationDate)}</p><p>เครดิต: {quote.creditTerm} วัน</p><p>วันครบกำหนด: {formatPrintDate(addThailandDays(quote.quotationDate, quote.creditTerm))}</p></div>
    </div>
    <table className="w-full border-collapse text-xs"><thead><tr className="bg-gray-100">{["#", "รหัสสินค้า", "รายละเอียด", "จำนวน", "หน่วย", "ราคา/หน่วย", "ส่วนลด/หน่วย", "ยอดรวม"].map((label) => <th className={PRINT_HEADER_CELL_CLASS} key={label}>{label}</th>)}</tr></thead>
      <tbody>{quote.items.map((row, index) => <tr key={row.id} className="break-inside-avoid"><td className={PRINT_TABLE_CELL_CLASS}>{index + 1}</td><td className={PRINT_TABLE_CELL_CLASS}>{row.product.code}</td><td className={PRINT_TABLE_CELL_CLASS}>{row.product.name}{row.moreDetail && <p className="whitespace-pre-line text-gray-600">{row.moreDetail}</p>}</td><td className={`${PRINT_TABLE_CELL_CLASS} text-right`}>{Number(row.showQty).toLocaleString("th-TH", { maximumFractionDigits: 4 })}</td><td className={PRINT_TABLE_CELL_CLASS}>{row.showUnitName}</td><td className={`${PRINT_TABLE_CELL_CLASS} text-right`}>{formatPrintNumber(Number(row.unitListPrice))}</td><td className={`${PRINT_TABLE_CELL_CLASS} text-right`}>{formatPrintNumber(Number(row.unitListPrice) - Number(row.salePrice))}</td><td className={`${PRINT_TABLE_CELL_CLASS} text-right`}>{formatPrintNumber(Number(row.totalAmount))}</td></tr>)}</tbody>
    </table>
    <div data-print-role="summary" className="mt-4 grid grid-cols-2 gap-6 break-inside-avoid">
      <div>{quote.note && <p className="whitespace-pre-line">หมายเหตุ: {quote.note}</p>}<p className="mt-3">{VAT_TYPE_LABELS[quote.vatType]}</p><p className="mt-3">{formatThaiBahtText(Number(quote.netAmount))}</p></div>
      <dl className="grid grid-cols-2 gap-2 text-right"><dt>รวมสินค้า</dt><dd>{formatPrintNumber(Number(quote.totalAmount))}</dd><dt>ส่วนลดท้ายบิล</dt><dd>{formatPrintNumber(Number(quote.discount))}</dd><dt>ยอดก่อนภาษี</dt><dd>{formatPrintNumber(Number(quote.subtotalAmount))}</dd><dt>VAT {Number(quote.vatRate)}%</dt><dd>{formatPrintNumber(Number(quote.vatAmount))}</dd><dt className="font-bold">ยอดสุทธิ</dt><dd className="font-bold">{formatPrintNumber(Number(quote.netAmount))}</dd></dl>
    </div>
    <div data-print-role="footer" className="mt-auto grid grid-cols-2 items-end gap-8 pt-12 break-inside-avoid">
      <div className="space-y-1 text-xs">{account && <><p className="font-semibold">ช่องทางการชำระเงิน</p><p>ชื่อบัญชี: {account.name}</p><p>ธนาคาร: {account.bankName ?? "-"}</p><p>เลขที่บัญชี: {account.accountNo ?? "-"}</p></>}</div>
      <div className="ml-auto w-60 space-y-2 text-center"><p>ขอแสดงความนับถือ</p><p className="pt-7">____________________________</p><p>{quote.updatedByName}</p><p>{formatPrintDate(quote.quotationDate)}</p></div>
    </div>
  </PrintDocumentRoot>;
}
