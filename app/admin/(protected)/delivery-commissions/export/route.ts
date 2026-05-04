export const dynamic = "force-dynamic";

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

const BOM = "\uFEFF";
const MAX_EXPORT_ROWS = 10000;

function csvRow(cells: (string | number)[]): string {
  return cells
    .map((c) => {
      const s = String(c);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    })
    .join(",");
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

type PaymentStatus = "ชำระครบ" | "ชำระบางส่วน" | "ยังไม่ชำระ";
function paymentStatusLabel(
  paymentType: SalePaymentType,
  netAmount: number,
  amountRemain: number,
): PaymentStatus {
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
    },
  });

  const saleIds = sales.map((sale) => sale.id);
  const [latestProofs, activeCommissionItems] = await Promise.all([
    saleIds.length === 0
      ? Promise.resolve([])
      : db.deliveryProof.findMany({
          where: { saleId: { in: saleIds } },
          orderBy: [{ saleId: "asc" }, { capturedAt: "desc" }],
          distinct: ["saleId"],
          select: {
            saleId: true,
            capturedAt: true,
          },
        }),
    saleIds.length === 0
      ? Promise.resolve([])
      : db.deliveryCommissionItem.findMany({
          where: {
            saleId: { in: saleIds },
            run: { status: DocStatus.ACTIVE },
          },
          orderBy: [{ saleId: "asc" }, { createdAt: "desc" }],
          distinct: ["saleId"],
          select: {
            saleId: true,
            commissionAmount: true,
            commissionPercent: true,
            run: { select: { runNo: true } },
          },
        }),
  ]);
  const proofMap = new Map(latestProofs.map((proof) => [proof.saleId, proof]));
  const payoutMap = new Map(activeCommissionItems.map((item) => [item.saleId, item]));

  const header = csvRow([
    "ลำดับ",
    "วันที่ขาย",
    "วันที่ส่ง",
    "เลขที่บิล",
    "ลูกค้า",
    "พนักงานส่ง",
    "ยอดบิล",
    "ค่าส่ง",
    "% ทำจ่าย",
    "ยอดทำจ่าย",
    "สถานะจัดส่ง",
    "สถานะชำระเงิน",
    "ทำจ่ายค่าส่ง",
    "เลขที่ทำจ่าย",
  ]);

  const body = sales.map((sale, index) => {
    const shippingFee = Number(sale.shippingFee ?? 0);
    const netAmount = Number(sale.netAmount);
    const amountRemain = Number(sale.amountRemain);
    const proof = proofMap.get(sale.id);
    const paid = payoutMap.get(sale.id);
    const percent = paid ? Number(paid.commissionPercent) : currentPercent;
    const commissionAmount = paid
      ? Number(paid.commissionAmount)
      : roundMoney((shippingFee * currentPercent) / 100);
    return csvRow([
      index + 1,
      formatDateThai(sale.saleDate),
      proof ? formatDateTimeThai(proof.capturedAt) : "",
      sale.saleNo,
      sale.customerName ?? "",
      sale.deliveryStaff?.name ?? "",
      netAmount,
      shippingFee,
      percent,
      commissionAmount,
      SHIPPING_STATUS_LABEL[sale.shippingStatus] ?? sale.shippingStatus,
      paymentStatusLabel(sale.paymentType, netAmount, amountRemain),
      paid ? "จ่ายแล้ว" : "ยังไม่จ่าย",
      paid ? paid.run.runNo : "",
    ]);
  });

  const csv = BOM + [header, ...body].join("\r\n");
  const dateRange = `${rFrom || "all"}-to-${rTo || "all"}`;
  const fileName = `delivery-commission-report-${dateRange}.csv`;

  await safeWriteAuditLog({
    ...getAuditActorFromSession(session),
    ...requestContext,
    action: AuditAction.EXPORT,
    entityType: "ReportExport",
    entityRef: "delivery-commission-report",
    meta: {
      format: "csv",
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

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
