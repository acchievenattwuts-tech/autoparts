export const dynamic = "force-dynamic";

import ExcelJS from "exceljs";

import {
  getAuditActorFromSession,
  getRequestContextFromHeaders,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { db } from "@/lib/db";
import {
  AuditAction,
  DocStatus,
  FulfillmentType,
  SalePaymentType,
} from "@/lib/generated/prisma";
import type { Prisma } from "@/lib/generated/prisma";
import { requirePermission } from "@/lib/require-auth";
import { SHIPPING_STATUS_LABEL } from "@/lib/shipping";
import { getSiteConfig } from "@/lib/site-config";
import {
  formatDateThai,
  formatDateTimeThai,
  parseDateOnlyToEndOfDay,
  parseDateOnlyToStartOfDay,
} from "@/lib/th-date";

const MAX_EXPORT_ROWS = 10000;

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

function addTotalRow(
  sheet: ExcelJS.Worksheet,
  label: string,
  colLabel: number,
  totals: { col: number; value: number }[],
) {
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

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function paymentStatusLabel(
  paymentType: SalePaymentType,
  netAmount: number,
  amountRemain: number,
): string {
  if (paymentType === SalePaymentType.CASH_SALE) return "ชำระครบ";
  if (amountRemain <= 0) return "ชำระครบ";
  if (amountRemain >= netAmount) return "ยังไม่ชำระ";
  return "ชำระบางส่วน";
}

export async function GET(request: Request) {
  const session = await requirePermission("delivery_commissions.view");
  const requestContext = getRequestContextFromHeaders(request.headers);

  const { searchParams } = new URL(request.url);
  const rFrom = searchParams.get("rFrom") || "";
  const rTo = searchParams.get("rTo") || "";
  const customerId = searchParams.get("customerId") || "";
  const rStaffId = searchParams.get("rStaffId") || "";
  const unpaidOnly = searchParams.get("unpaidOnly") === "1";

  const where: Prisma.SaleWhereInput = {
    status: DocStatus.ACTIVE,
    fulfillmentType: FulfillmentType.DELIVERY,
  };
  if (rFrom || rTo) {
    const range: Prisma.DateTimeFilter = {};
    if (rFrom) range.gte = parseDateOnlyToStartOfDay(rFrom);
    if (rTo) range.lte = parseDateOnlyToEndOfDay(rTo);
    where.saleDate = range;
  }
  if (customerId) where.customerId = customerId;
  if (rStaffId) where.deliveryStaffId = rStaffId;
  if (unpaidOnly) where.amountRemain = { gt: 0 };

  const config = await getSiteConfig();
  const currentPercent = Number(config.deliveryCommissionPercent);

  const sales = await db.sale.findMany({
    where,
    orderBy: [{ saleDate: "desc" }, { saleNo: "desc" }],
    take: MAX_EXPORT_ROWS,
    select: {
      id: true,
      saleNo: true,
      saleDate: true,
      customerName: true,
      netAmount: true,
      amountRemain: true,
      shippingFee: true,
      paymentType: true,
      shippingStatus: true,
      deliveryStaff: { select: { name: true } },
      deliveryProofs: {
        orderBy: { capturedAt: "desc" },
        take: 1,
        select: { capturedAt: true },
      },
      deliveryCommissionItems: {
        where: { run: { status: DocStatus.ACTIVE } },
        take: 1,
        select: {
          commissionAmount: true,
          commissionPercent: true,
          run: { select: { runNo: true } },
        },
      },
    },
  });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("รายงานบิลจัดส่ง");

  ws.columns = [
    { header: "#", key: "rowNo", width: 6 },
    { header: "วันที่ขาย", key: "saleDate", width: 12 },
    { header: "วันที่ส่ง", key: "deliveredAt", width: 18 },
    { header: "เลขที่บิล", key: "saleNo", width: 16 },
    { header: "ลูกค้า", key: "customerName", width: 28 },
    { header: "พนักงานส่ง", key: "deliveryStaff", width: 18 },
    { header: "ยอดบิล", key: "netAmount", width: 14 },
    { header: "ค่าส่ง", key: "shippingFee", width: 12 },
    { header: "% ทำจ่าย", key: "commissionPercent", width: 10 },
    { header: "ยอดทำจ่าย", key: "commissionAmount", width: 14 },
    { header: "สถานะจัดส่ง", key: "shippingStatus", width: 14 },
    { header: "สถานะชำระเงิน", key: "paymentStatus", width: 14 },
    { header: "ทำจ่ายค่าส่ง", key: "payoutStatus", width: 14 },
    { header: "เลขที่ทำจ่าย", key: "runNo", width: 16 },
  ];
  styleHeader(ws);

  let shippingFeeTotal = 0;
  let commissionTotal = 0;
  let netAmountTotal = 0;

  sales.forEach((sale, index) => {
    const shippingFee = Number(sale.shippingFee ?? 0);
    const netAmount = Number(sale.netAmount);
    const amountRemain = Number(sale.amountRemain);
    const proof = sale.deliveryProofs[0];
    const paid = sale.deliveryCommissionItems[0];
    const percent = paid ? Number(paid.commissionPercent) : currentPercent;
    const commissionAmount = paid
      ? Number(paid.commissionAmount)
      : roundMoney((shippingFee * currentPercent) / 100);

    shippingFeeTotal += shippingFee;
    commissionTotal += commissionAmount;
    netAmountTotal += netAmount;

    const row = ws.addRow({
      rowNo: index + 1,
      saleDate: formatDateThai(sale.saleDate),
      deliveredAt: proof ? formatDateTimeThai(proof.capturedAt) : "-",
      saleNo: sale.saleNo,
      customerName: sale.customerName ?? "-",
      deliveryStaff: sale.deliveryStaff?.name ?? "-",
      netAmount,
      shippingFee,
      commissionPercent: percent,
      commissionAmount,
      shippingStatus: SHIPPING_STATUS_LABEL[sale.shippingStatus] ?? sale.shippingStatus,
      paymentStatus: paymentStatusLabel(sale.paymentType, netAmount, amountRemain),
      payoutStatus: paid ? "จ่ายแล้ว" : "ยังไม่จ่าย",
      runNo: paid ? paid.run.runNo : "-",
    });

    (["netAmount", "shippingFee", "commissionAmount"] as const).forEach((k) => {
      row.getCell(k).numFmt = "#,##0.00";
    });
    row.getCell("commissionPercent").numFmt = "0.00";
    if (!paid) {
      row.getCell("commissionAmount").font = { italic: true, color: { argb: "FF92400E" } };
    }
  });

  addTotalRow(ws, "รวมทั้งสิ้น", 6, [
    { col: 7, value: roundMoney(netAmountTotal) },
    { col: 8, value: roundMoney(shippingFeeTotal) },
    { col: 10, value: roundMoney(commissionTotal) },
  ]);

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf]);
  const dateRange = `${rFrom || "all"}-to-${rTo || "all"}`;
  const fileName = `delivery-commission-report-${dateRange}.xlsx`;

  await safeWriteAuditLog({
    ...getAuditActorFromSession(session),
    ...requestContext,
    action: AuditAction.EXPORT,
    entityType: "ReportExport",
    entityRef: "delivery-commission-report",
    meta: {
      format: "xlsx",
      fileName,
      rowCount: sales.length,
      filters: {
        rFrom: rFrom || null,
        rTo: rTo || null,
        customerId: customerId || null,
        rStaffId: rStaffId || null,
        unpaidOnly,
      },
    },
  });

  return new Response(blob, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
