export const dynamic = "force-dynamic";

import ExcelJS from "exceljs";
import {
  getAuditActorFromSession,
  getRequestContextFromHeaders,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { AuditAction } from "@/lib/generated/prisma";
import { saleChannelLabel } from "@/lib/report-queries";
import { requirePermission } from "@/lib/require-auth";
import {
  parseSalesLineProfitFilters,
  querySalesLineProfitData,
  SALES_LINE_PROFIT_EXPORT_LIMIT,
  salesLineProfitFileDateRange,
} from "@/lib/sales-line-profit-report";
import { formatDateThai } from "@/lib/th-date";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1E3A5F" },
};

function styleSheet(sheet: ExcelJS.Worksheet) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: sheet.getRow(1).getCell(sheet.columnCount).address };
  sheet.getRow(1).eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
}

function styleMoneyColumns(sheet: ExcelJS.Worksheet, keys: string[]) {
  for (const key of keys) sheet.getColumn(key).numFmt = "#,##0.00;[Red]-#,##0.00";
}

export async function GET(request: Request) {
  const session = await requirePermission("reports.view");
  const searchParams = new URL(request.url).searchParams;
  const params: Record<string, string | undefined> = {
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    channel: searchParams.get("channel") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    customerIds: searchParams.get("customerIds") ?? undefined,
    categoryId: searchParams.get("categoryId") ?? undefined,
    productCodeFrom: searchParams.get("productCodeFrom") ?? undefined,
    productCodeTo: searchParams.get("productCodeTo") ?? undefined,
    productIds: searchParams.get("productIds") ?? undefined,
    includeReturns: searchParams.get("includeReturns") ?? undefined,
  };
  const filters = parseSalesLineProfitFilters(params);
  const data = await querySalesLineProfitData(filters, {
    detailLimit: SALES_LINE_PROFIT_EXPORT_LIMIT,
    billLimit: SALES_LINE_PROFIT_EXPORT_LIMIT,
    mode: "EXPORT",
  });

  if (data.billRowsTruncated || data.lineRowsTruncated) {
    return new Response(
      `ข้อมูลเกิน ${SALES_LINE_PROFIT_EXPORT_LIMIT.toLocaleString("th-TH")} รายการ กรุณากรองช่วงวันที่ ลูกค้า หรือสินค้าให้แคบลงก่อน Export`,
      {
        status: 422,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "private, no-store",
        },
      },
    );
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Autoparts ERP";
  workbook.created = new Date();

  const billSheet = workbook.addWorksheet("กำไรต่อบิล");
  billSheet.columns = [
    { header: "วันที่", key: "date", width: 14 },
    { header: "ประเภท", key: "type", width: 12 },
    { header: "เลขที่เอกสาร", key: "docNo", width: 18 },
    { header: "อ้างอิงบิลขาย", key: "referenceDocNo", width: 18 },
    { header: "ลูกค้า", key: "customer", width: 28 },
    { header: "ช่องทาง", key: "channel", width: 14 },
    { header: "จำนวน", key: "quantity", width: 12 },
    { header: "ส่วนลดท้ายบิล", key: "billDiscount", width: 16 },
    { header: "ยอดสุทธิรวม VAT", key: "netIncVat", width: 18 },
    { header: "ยอดสุทธิไม่รวม VAT", key: "netExVat", width: 20 },
    { header: "ต้นทุน", key: "cost", width: 16 },
    { header: "กำไรขั้นต้น", key: "grossProfit", width: 16 },
    { header: "GP%", key: "marginPct", width: 12 },
  ];
  styleSheet(billSheet);
  for (const bill of data.bills) {
    billSheet.addRow({
      date: formatDateThai(bill.docDate),
      type: bill.sourceType === "SALE" ? "ขาย" : "คืนสินค้า",
      docNo: bill.docNo,
      referenceDocNo: bill.referenceDocNo ?? "",
      customer: bill.customerName,
      channel: saleChannelLabel(bill.channel),
      quantity: bill.quantity,
      billDiscount: bill.billDiscount,
      netIncVat: bill.netSalesIncVat,
      netExVat: bill.netSalesExVat,
      cost: bill.costAmount,
      grossProfit: bill.grossProfit,
      marginPct: bill.marginPct / 100,
    });
  }
  styleMoneyColumns(billSheet, ["billDiscount", "netIncVat", "netExVat", "cost", "grossProfit"]);
  billSheet.getColumn("quantity").numFmt = "#,##0.####;[Red]-#,##0.####";
  billSheet.getColumn("marginPct").numFmt = "0.00%";

  const lineSheet = workbook.addWorksheet("กำไรต่อสินค้า");
  lineSheet.columns = [
    { header: "วันที่", key: "date", width: 14 },
    { header: "ประเภท", key: "type", width: 12 },
    { header: "เลขที่เอกสาร", key: "docNo", width: 18 },
    { header: "อ้างอิงบิลขาย", key: "referenceDocNo", width: 18 },
    { header: "ลูกค้า", key: "customer", width: 28 },
    { header: "ช่องทาง", key: "channel", width: 14 },
    { header: "รหัสสินค้า", key: "productCode", width: 18 },
    { header: "ชื่อสินค้า", key: "productName", width: 34 },
    { header: "จำนวน", key: "quantity", width: 12 },
    { header: "หน่วย", key: "unitName", width: 10 },
    { header: "ราคาตั้ง/หน่วย", key: "unitListPrice", width: 18 },
    { header: "ยอดก่อนส่วนลด", key: "beforeDiscount", width: 18 },
    { header: "ส่วนลดรายการ", key: "lineDiscount", width: 16 },
    { header: "ยอดหลังส่วนลดรายการ", key: "afterLineDiscount", width: 22 },
    { header: "ส่วนลดท้ายบิลที่ปัน", key: "allocatedBillDiscount", width: 22 },
    { header: "ยอดสุทธิรวม VAT", key: "netIncVat", width: 18 },
    { header: "ยอดสุทธิไม่รวม VAT", key: "netExVat", width: 20 },
    { header: "ต้นทุน", key: "cost", width: 16 },
    { header: "กำไรขั้นต้น", key: "grossProfit", width: 16 },
    { header: "GP%", key: "marginPct", width: 12 },
  ];
  styleSheet(lineSheet);
  for (const line of data.lines) {
    lineSheet.addRow({
      date: formatDateThai(line.docDate),
      type: line.sourceType === "SALE" ? "ขาย" : "คืนสินค้า",
      docNo: line.docNo,
      referenceDocNo: line.referenceDocNo ?? "",
      customer: line.customerName,
      channel: saleChannelLabel(line.channel),
      productCode: line.productCode,
      productName: line.productName,
      quantity: line.quantity,
      unitName: line.unitName,
      unitListPrice: line.unitListPrice,
      beforeDiscount: line.amountBeforeLineDiscount,
      lineDiscount: line.lineDiscount,
      afterLineDiscount: line.amountAfterLineDiscount,
      allocatedBillDiscount: line.allocatedBillDiscount,
      netIncVat: line.netSalesIncVat,
      netExVat: line.netSalesExVat,
      cost: line.costAmount,
      grossProfit: line.grossProfit,
      marginPct: line.marginPct / 100,
    });
  }
  styleMoneyColumns(lineSheet, [
    "unitListPrice",
    "beforeDiscount",
    "lineDiscount",
    "afterLineDiscount",
    "allocatedBillDiscount",
    "netIncVat",
    "netExVat",
    "cost",
    "grossProfit",
  ]);
  lineSheet.getColumn("quantity").numFmt = "#,##0.####;[Red]-#,##0.####";
  lineSheet.getColumn("marginPct").numFmt = "0.00%";

  const fileName = `sales-line-profit-${salesLineProfitFileDateRange(filters)}.xlsx`;
  await safeWriteAuditLog({
    ...getAuditActorFromSession(session),
    ...getRequestContextFromHeaders(request.headers),
    action: AuditAction.EXPORT,
    entityType: "ReportExport",
    entityRef: "sales-line-profit",
    meta: {
      format: "xlsx",
      fileName,
      filters: params,
      billCount: data.bills.length,
      lineCount: data.lines.length,
      truncated: data.billRowsTruncated || data.lineRowsTruncated,
    },
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(new Blob([buffer]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
