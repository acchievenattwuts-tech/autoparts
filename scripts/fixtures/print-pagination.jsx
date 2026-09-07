// Browser-only, synthetic documents. Never queries or writes the application database.
import React from "react";
import { createRoot } from "react-dom/client";
import Sales from "@/app/admin/_components/SharedSalesDeliveryPrintDocument";
import Receipt from "@/app/admin/_components/SharedReceiptSettlementPrintDocument";
import Quotation from "@/app/admin/_components/QuotationPrintDocument";
import Advance from "@/app/admin/_components/CustomerAdvancePrintDocument";
import Refund from "@/app/admin/_components/CustomerAdvanceRefundPrintDocument";
import Claim from "@/app/admin/_components/WarrantyClaimPrintDocument";
import Root from "@/app/admin/_components/print/PrintDocumentRoot";
import Header from "@/app/admin/_components/print/PrintDocumentHeader";
import ExternalPrintShell from "@/components/liff/ExternalPrintShell";
import { PRINT_COPY_VISIBILITY_CSS } from "@/app/admin/_components/print/shared";

const params = new URLSearchParams(location.search);
const count = Number(params.get("rows") ?? 60);
const mode = params.get("mode") ?? "sale";
const date = new Date("2026-09-07T00:00:00Z");
const config = { shopName: "ร้านทดสอบ", shopAddress: "99 กรุงเทพมหานคร", printNoticeText: "กรุณาตรวจสอบสินค้า\nไม่รับคืนสินค้าที่ใช้งานแล้ว" };
const customer = { name: "บริษัท ทดสอบ จำกัด", address: "123 กรุงเทพมหานคร", phone: "0812345678" };
const items = Array.from({ length: count }, (_, index) => ({
  id: `i${index}`, product: { code: `ITEM-${index}`, name: "คอมเพรสเซอร์แอร์ Toyota Hilux Vigo", reportUnitName: "ลูก" },
  quantity: 1, showQty: 1, showUnitName: "ลูก", unitScale: 1, salePrice: 100, unitListPrice: 110, totalAmount: 100, lotItems: [],
  moreDetail: index === 0 && params.has("long") ? "รายละเอียดสินค้า ".repeat(700) : "รายละเอียดเพิ่มเติม",
}));
const quote = { quotationNo: "SQ26090001", revision: 1, quotationDate: date, customerName: customer.name, customerPhone: customer.phone, customerAddress: customer.address, creditTerm: 30, status: "ACTIVE", updatedByName: "ผู้บันทึก", discount: 0, totalAmount: count * 100, subtotalAmount: count * 100, vatAmount: 0, netAmount: count * 100, vatType: "NO_VAT", vatRate: 7, note: "หมายเหตุ", items };
const account = { name: "บริษัท ทดสอบ จำกัด", bankName: "ธนาคารทดสอบ", accountNo: "1234567890" };
const payments = items.map((item) => ({ accountName: item.product.code, accountType: "CASH", amount: 100 }));
const verify = params.has("verify") ? { verifyUrl: "https://example.test/verify/1", qrSvg: '<svg viewBox="0 0 84 84"><rect width="84" height="84"/></svg>' } : null;
function Document({ copy = false }) {
  const shared = { shopConfig: config, rootClassName: copy ? "print-slip-copy" : undefined, copyLabel: copy ? "สำเนา" : "ต้นฉบับ" };
  if (mode === "quotation") return <Quotation quote={quote} config={config} account={account} />;
  if (mode === "receipt") return <Receipt {...shared} receipt={{ receiptNo: "REC26090001", receiptDate: date, customer, totalAmount: count * 100, paymentMethod: "CASH", items: items.map((item) => ({ id: item.id, paidAmount: 100, sale: { saleNo: item.product.code, saleDate: date, netAmount: 100 } })) }} signerDisplayName="ผู้บันทึก" receivedTransferAccount={account} verify={verify} />;
  if (mode === "advance") return <Advance {...shared} advance={{ advanceNo: "SD26090001", advanceDate: date, totalAmount: 100, customer, note: "หมายเหตุ" }} payments={payments} />;
  if (mode === "refund") return <Refund {...shared} refund={{ refundNo: "CNSD26090001", refundDate: date, refundAmount: 100, customerAdvance: { advanceNo: "SD1", customer } }} payments={payments} />;
  if (mode === "claim") return <Claim {...shared} claim={{ claimNo: "WC26090001", claimDate: date, status: "DRAFT", claimType: "REPLACE_NOW", symptom: "อาการเสีย ".repeat(500), warranty: { unitSeq: 1, warrantyDays: 90, startDate: date, endDate: date, product: { code: "ITEM-0", name: "คอมเพรสเซอร์" }, sale: null } }} statusLabel={{ DRAFT: "รอส่ง" }} claimTypeLabel={{ REPLACE_NOW: "เปลี่ยนทันที" }} outcomeLabel={{}} />;
  if (mode === "report") return <Root><Header shopConfig={config} title="รายงาน" /><section><h2>หัวข้อรายงาน</h2><div><table><thead><tr><th>สินค้า</th><th>ราคา</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{item.product.code}</td><td>100</td></tr>)}</tbody></table></div></section></Root>;
  return <Sales {...shared} sale={{ saleNo: "SA26090001", saleDate: date, customerName: customer.name, customerPhone: customer.phone, customer, fulfillmentType: "PICKUP", paymentType: mode === "cash" ? "CASH_SALE" : "CREDIT_SALE", totalAmount: count * 100, discount: 0, netAmount: count * 100, items }} dueDate={date} signerDisplayName="ผู้บันทึก" transferPrimaryAccount={account} receivedTransferAccount={null} promptPayQrDataUrl={null} qrAmount={0} verify={verify} />;
}
document.documentElement.dataset.printCopies = params.has("copies") ? "2" : "1";
const documents = <><style>{`@media print{body *{visibility:hidden}#receipt,#receipt *{visibility:visible}#receipt{position:absolute;left:0;top:0;width:100%}.no-print{display:none!important}}${PRINT_COPY_VISIBILITY_CSS}`}</style><div id="receipt"><Document />{params.has("copyRoot") && <Document copy />}</div></>;
createRoot(document.getElementById("root")).render(params.has("external") ? <ExternalPrintShell buttonLabel="พิมพ์">{documents}</ExternalPrintShell> : <div className="admin-theme-root" data-admin-theme={params.has("dark") ? "dark" : "light"}>{documents}</div>);
