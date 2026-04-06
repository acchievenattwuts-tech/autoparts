export const dynamic = "force-dynamic";

import ExcelJS from "exceljs";
import { requirePermission } from "@/lib/require-auth";
import {
  parseReportQueryFilters,
  querySalesRows,
  queryPurchaseRows,
  queryCreditNoteRows,
  queryDailyReceiptRows,
  queryDailyPaymentRows,
  statusLabel,
  type SaleRow,
  type PurchaseRow,
  type CreditNoteRow,
  type DailyReceiptRow,
  type DailyPaymentRow,
} from "@/lib/report-queries";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1e3a5f" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
  size: 10,
};

function fmtDate(d: Date): string {
  return d.toLocaleDateString("th-TH-u-ca-gregory", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function styleHeader(sheet: ExcelJS.Worksheet) {
  const row = sheet.getRow(1);
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
    };
  });
  row.height = 22;
}

function addTotalRow(sheet: ExcelJS.Worksheet, label: string, colLabel: number, totals: { col: number; value: number }[]) {
  const totalRow = sheet.addRow([]);
  totalRow.getCell(colLabel).value = label;
  totalRow.getCell(colLabel).font = { bold: true };
  totalRow.getCell(colLabel).alignment = { horizontal: "right" };
  for (const { col, value } of totals) {
    totalRow.getCell(col).value = value;
    totalRow.getCell(col).font = { bold: true };
    totalRow.getCell(col).numFmt = "#,##0.00";
  }
  totalRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF3F4F6" },
  };
}

async function buildSalesExcel(rows: SaleRow[], title: string): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(title);

  ws.columns = [
    { header: "#", key: "rowNo", width: 6 },
    { header: "เลขที่เอกสาร", key: "docNo", width: 16 },
    { header: "วันที่", key: "docDate", width: 12 },
    { header: "ประเภท", key: "docType", width: 8 },
    { header: "การชำระ", key: "paymentType", width: 10 },
    { header: "รหัสลูกค้า", key: "customerCode", width: 12 },
    { header: "ชื่อลูกค้า", key: "customerName", width: 24 },
    { header: "หมายเหตุ", key: "note", width: 20 },
    { header: "สถานะ", key: "status", width: 10 },
    { header: "รหัสสินค้า", key: "productCode", width: 14 },
    { header: "ชื่อสินค้า", key: "productName", width: 28 },
    { header: "จำนวน", key: "qty", width: 8 },
    { header: "หน่วย", key: "unitName", width: 8 },
    { header: "ราคา/หน่วย", key: "unitPrice", width: 12 },
    { header: "ก่อน VAT", key: "subtotalAmount", width: 12 },
    { header: "VAT Type", key: "vatType", width: 12 },
    { header: "VAT", key: "vatAmount", width: 10 },
    { header: "รวม", key: "totalAmount", width: 12 },
  ];
  styleHeader(ws);

  for (const r of rows) {
    const row = ws.addRow({
      ...r,
      docDate: fmtDate(r.docDate),
      status: statusLabel(r.status),
    });
    if (r.status === "CANCELLED") row.font = { color: { argb: "FF9CA3AF" }, italic: true };
    (["unitPrice", "subtotalAmount", "vatAmount", "totalAmount"] as const).forEach((k) => {
      row.getCell(k).numFmt = "#,##0.00";
    });
    row.getCell("qty").numFmt = "#,##0.####";
  }

  addTotalRow(ws, "รวมทั้งสิ้น", 14, [
    { col: 15, value: rows.reduce((s, r) => s + r.subtotalAmount, 0) },
    { col: 17, value: rows.reduce((s, r) => s + r.vatAmount, 0) },
    { col: 18, value: rows.reduce((s, r) => s + r.totalAmount, 0) },
  ]);

  const buf = await wb.xlsx.writeBuffer(); return new Blob([buf]);
}

async function buildPurchasesExcel(rows: PurchaseRow[], title: string): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(title);

  ws.columns = [
    { header: "#", key: "rowNo", width: 6 },
    { header: "เลขที่เอกสาร", key: "docNo", width: 16 },
    { header: "วันที่", key: "docDate", width: 12 },
    { header: "รหัสซัพพลายเออร์", key: "supplierCode", width: 16 },
    { header: "ชื่อซัพพลายเออร์", key: "supplierName", width: 24 },
    { header: "เลขอ้างอิง", key: "referenceNo", width: 16 },
    { header: "สถานะ", key: "status", width: 10 },
    { header: "รหัสสินค้า", key: "productCode", width: 14 },
    { header: "ชื่อสินค้า", key: "productName", width: 28 },
    { header: "จำนวน", key: "qty", width: 8 },
    { header: "หน่วย", key: "unitName", width: 8 },
    { header: "ราคา/หน่วย", key: "unitPrice", width: 12 },
    { header: "ก่อน VAT", key: "subtotalAmount", width: 12 },
    { header: "VAT Type", key: "vatType", width: 12 },
    { header: "VAT", key: "vatAmount", width: 10 },
    { header: "รวม", key: "totalAmount", width: 12 },
  ];
  styleHeader(ws);

  for (const r of rows) {
    const row = ws.addRow({ ...r, docDate: fmtDate(r.docDate), status: statusLabel(r.status) });
    if (r.status === "CANCELLED") row.font = { color: { argb: "FF9CA3AF" }, italic: true };
    (["unitPrice", "subtotalAmount", "vatAmount", "totalAmount"] as const).forEach((k) => {
      row.getCell(k).numFmt = "#,##0.00";
    });
    row.getCell("qty").numFmt = "#,##0.####";
  }

  addTotalRow(ws, "รวมทั้งสิ้น", 12, [
    { col: 13, value: rows.reduce((s, r) => s + r.subtotalAmount, 0) },
    { col: 15, value: rows.reduce((s, r) => s + r.vatAmount, 0) },
    { col: 16, value: rows.reduce((s, r) => s + r.totalAmount, 0) },
  ]);

  const buf = await wb.xlsx.writeBuffer(); return new Blob([buf]);
}

async function buildCreditNotesExcel(rows: CreditNoteRow[], title: string): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(title);

  ws.columns = [
    { header: "#", key: "rowNo", width: 6 },
    { header: "เลขที่ CN", key: "docNo", width: 16 },
    { header: "วันที่", key: "docDate", width: 12 },
    { header: "อ้างอิงใบขาย", key: "refSaleNo", width: 16 },
    { header: "รหัสลูกค้า", key: "customerCode", width: 12 },
    { header: "ชื่อลูกค้า", key: "customerName", width: 24 },
    { header: "ประเภท CN", key: "cnType", width: 12 },
    { header: "การตั้งหนี้", key: "settlement", width: 12 },
    { header: "สถานะ", key: "status", width: 10 },
    { header: "รหัสสินค้า", key: "productCode", width: 14 },
    { header: "ชื่อสินค้า/รายละเอียด", key: "productName", width: 28 },
    { header: "จำนวน", key: "qty", width: 8 },
    { header: "ราคา/หน่วย", key: "unitPrice", width: 12 },
    { header: "ก่อน VAT", key: "subtotalAmount", width: 12 },
    { header: "VAT Type", key: "vatType", width: 12 },
    { header: "VAT", key: "vatAmount", width: 10 },
    { header: "รวม", key: "totalAmount", width: 12 },
  ];
  styleHeader(ws);

  for (const r of rows) {
    const row = ws.addRow({
      ...r,
      docDate: fmtDate(r.docDate),
      status: statusLabel(r.status),
      productName: r.productName || r.detail,
    });
    if (r.status === "CANCELLED") row.font = { color: { argb: "FF9CA3AF" }, italic: true };
    (["unitPrice", "subtotalAmount", "vatAmount", "totalAmount"] as const).forEach((k) => {
      row.getCell(k).numFmt = "#,##0.00";
    });
    row.getCell("qty").numFmt = "#,##0.####";
  }

  addTotalRow(ws, "รวมทั้งสิ้น", 13, [
    { col: 14, value: rows.reduce((s, r) => s + r.subtotalAmount, 0) },
    { col: 16, value: rows.reduce((s, r) => s + r.vatAmount, 0) },
    { col: 17, value: rows.reduce((s, r) => s + r.totalAmount, 0) },
  ]);

  const buf = await wb.xlsx.writeBuffer(); return new Blob([buf]);
}

async function buildDailyReceiptExcel(rows: DailyReceiptRow[], title: string): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(title);

  ws.columns = [
    { header: "#", key: "rowNo", width: 6 },
    { header: "เลขที่เอกสาร", key: "docNo", width: 16 },
    { header: "วันที่", key: "docDate", width: 12 },
    { header: "ประเภท", key: "docType", width: 14 },
    { header: "รหัสลูกค้า", key: "customerCode", width: 12 },
    { header: "ชื่อลูกค้า", key: "customerName", width: 28 },
    { header: "ช่องทางชำระ", key: "paymentMethod", width: 14 },
    { header: "หมายเหตุ", key: "note", width: 20 },
    { header: "สถานะ", key: "status", width: 10 },
    { header: "จำนวนเงิน", key: "amount", width: 14 },
  ];
  styleHeader(ws);

  for (const r of rows) {
    const row = ws.addRow({ ...r, docDate: fmtDate(r.docDate), status: statusLabel(r.status) });
    if (r.status === "CANCELLED") row.font = { color: { argb: "FF9CA3AF" }, italic: true };
    row.getCell("amount").numFmt = "#,##0.00";
  }

  addTotalRow(ws, "รวมทั้งสิ้น (เฉพาะที่ใช้งาน)", 9, [
    { col: 10, value: rows.filter(r => r.status === "ACTIVE").reduce((s, r) => s + r.amount, 0) },
  ]);

  const buf = await wb.xlsx.writeBuffer(); return new Blob([buf]);
}

async function buildDailyPaymentExcel(rows: DailyPaymentRow[], title: string): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(title);

  ws.columns = [
    { header: "#", key: "rowNo", width: 6 },
    { header: "เลขที่เอกสาร", key: "docNo", width: 16 },
    { header: "วันที่", key: "docDate", width: 12 },
    { header: "ประเภทรายการ", key: "docType", width: 16 },
    { header: "รหัสคู่ค้า", key: "partyCode", width: 12 },
    { header: "ชื่อคู่ค้า / รายละเอียด", key: "partyName", width: 28 },
    { header: "ช่องทางชำระ", key: "paymentMethod", width: 14 },
    { header: "หมายเหตุ", key: "note", width: 20 },
    { header: "สถานะ", key: "status", width: 10 },
    { header: "จำนวนเงิน", key: "amount", width: 14 },
  ];
  styleHeader(ws);

  for (const r of rows) {
    const row = ws.addRow({ ...r, docDate: fmtDate(r.docDate), status: statusLabel(r.status) });
    if (r.status === "CANCELLED") row.font = { color: { argb: "FF9CA3AF" }, italic: true };
    row.getCell("amount").numFmt = "#,##0.00";
  }

  addTotalRow(ws, "รวมทั้งสิ้น (เฉพาะที่ใช้งาน)", 9, [
    { col: 10, value: rows.filter(r => r.status === "ACTIVE").reduce((s, r) => s + r.amount, 0) },
  ]);

  const buf = await wb.xlsx.writeBuffer(); return new Blob([buf]);
}

export async function GET(request: Request) {
  await requirePermission("reports.view");

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") ?? "sales";

  const params: Record<string, string | undefined> = {
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    showCancelled: searchParams.get("showCancelled") ?? undefined,
    paymentType: searchParams.get("paymentType") ?? undefined,
    saleType: searchParams.get("saleType") ?? undefined,
    cnType: searchParams.get("cnType") ?? undefined,
    paymentMethod: searchParams.get("paymentMethod") ?? undefined,
    docType: searchParams.get("docType") ?? undefined,
  };

  const filters = parseReportQueryFilters(params);
  const dateRange = `${filters.fromStr}-to-${filters.toStr}`;

  let buffer: Blob;
  let fileName: string;

  switch (type) {
    case "purchases": {
      const rows = await queryPurchaseRows(filters);
      buffer = await buildPurchasesExcel(rows, "รายงานซื้อ");
      fileName = `purchase-report-${dateRange}.xlsx`;
      break;
    }
    case "credit-notes": {
      const rows = await queryCreditNoteRows(filters);
      buffer = await buildCreditNotesExcel(rows, "รายงานคืนขาย");
      fileName = `credit-note-report-${dateRange}.xlsx`;
      break;
    }
    case "daily-receipt": {
      const rows = await queryDailyReceiptRows(filters);
      buffer = await buildDailyReceiptExcel(rows, "รับเงินประจำวัน");
      fileName = `daily-receipt-${dateRange}.xlsx`;
      break;
    }
    case "daily-payment": {
      const rows = await queryDailyPaymentRows(filters);
      buffer = await buildDailyPaymentExcel(rows, "จ่ายเงินประจำวัน");
      fileName = `daily-payment-${dateRange}.xlsx`;
      break;
    }
    default: {
      const rows = await querySalesRows(filters);
      buffer = await buildSalesExcel(rows, "รายงานขาย");
      fileName = `sale-report-${dateRange}.xlsx`;
      break;
    }
  }

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
