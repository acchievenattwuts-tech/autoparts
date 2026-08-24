export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { Eye, Pencil, Plus, WalletCards, BarChart3 } from "lucide-react";
import { FulfillmentType, SaleChannel, SalePaymentType, ShippingStatus } from "@/lib/generated/prisma";
import type { Prisma } from "@/lib/generated/prisma";
import SalesFilterBar from "./SalesFilterBar";
import SalesChannelTabs from "./SalesChannelTabs";
import SearchBar from "@/components/shared/SearchBar";
import SaleCancelButton from "./SaleCancelButton";
import Pagination from "@/components/shared/Pagination";
import PrintFromListButton from "@/components/shared/PrintFromListButton";
import DateRangeFilter from "@/components/shared/DateRangeFilter";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminFilterToolbar from "@/components/shared/AdminFilterToolbar";
import AdminTableSection from "@/components/shared/AdminTableSection";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import AdminActionGroup from "@/components/shared/AdminActionGroup";
import { hasPermissionAccess } from "@/lib/access-control";
import { getAdminDocumentRowClass } from "@/lib/admin-status-presentation";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { SHIPPING_STATUS_LABEL, SHIPPING_STATUS_TONE } from "@/lib/shipping";
import {
  formatDateThai,
  parseDateOnlyToEndOfDay,
  parseDateOnlyToStartOfDay,
} from "@/lib/th-date";

const PAGE_SIZE = 30;

const paymentMethodLabel: Record<string, string> = {
  CASH:     "เงินสด",
  TRANSFER: "โอนเงิน",
  CREDIT:   "เครดิต",
};

const fulfillmentLabel: Record<FulfillmentType, string> = {
  PICKUP:   "หน้าร้าน",
  DELIVERY: "จัดส่ง",
};
const fulfillmentTone = {
  PICKUP:   "neutral",
  DELIVERY: "pending",
} as const;

const paymentTypeLabel: Record<SalePaymentType, string> = {
  CASH_SALE:   "สด",
  CREDIT_SALE: "เชื่อ",
};
const paymentTypeTone = {
  CASH_SALE:   "success",
  CREDIT_SALE: "warning",
} as const;

type PaymentStatus = "PAID" | "OUTSTANDING";
const paymentStatusLabel: Record<PaymentStatus, string> = {
  PAID:        "ชำระแล้ว",
  OUTSTANDING: "ค้างชำระ",
};
const paymentStatusTone = {
  PAID:        "success",
  OUTSTANDING: "danger",
} as const;

function getPaymentStatus(paymentType: SalePaymentType, amountRemain: Prisma.Decimal): PaymentStatus {
  if (paymentType === SalePaymentType.CASH_SALE) return "PAID";
  return Number(amountRemain) === 0 ? "PAID" : "OUTSTANDING";
}

const channelLabel: Record<SaleChannel, string> = {
  STORE:  "หน้าร้าน",
  SHOPEE: "Shopee",
};
const channelTone = {
  STORE:  "neutral",
  SHOPEE: "info",
} as const;


const SalesPage = async ({
  searchParams,
}: {
  searchParams: Promise<{
    paymentType?: string;
    q?: string;
    page?: string;
    from?: string;
    to?: string;
    shippingStatus?: string;
    fulfillmentType?: string;
    paymentStatus?: string;
    customerId?: string;
    productId?: string;
    channel?: string;
  }>;
}) => {
  await requirePermission("sales.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canCreate = hasPermissionAccess(role, permissions, "sales.create");
  const canUpdate = hasPermissionAccess(role, permissions, "sales.update");
  const canCancel = hasPermissionAccess(role, permissions, "sales.cancel");
  const canManageShopee = hasPermissionAccess(role, permissions, "marketplace.manage");
  const canViewReports = hasPermissionAccess(role, permissions, "reports.view");

  const params = await searchParams;
  const paymentTypeFilter  = params.paymentType;
  const channelFilter = params.channel === SaleChannel.SHOPEE ? SaleChannel.SHOPEE : SaleChannel.STORE;
  const shippingStatusFilter = params.shippingStatus;
  const fulfillmentTypeFilter = params.fulfillmentType;
  const paymentStatusFilter = params.paymentStatus;
  const customerId = params.customerId;
  const productId = params.productId;
  const q = params.q;
  const pageNum = Math.max(1, parseInt(params.page ?? "1", 10));
  const from = params.from ?? "";
  const to   = params.to   ?? "";

  const where: Prisma.SaleWhereInput = {};
  if (from || to) {
    where.saleDate = {
      ...(from ? { gte: parseDateOnlyToStartOfDay(from) } : {}),
      ...(to   ? { lte: parseDateOnlyToEndOfDay(to) } : {}),
    };
  }
  if (paymentTypeFilter && paymentTypeFilter !== "ALL") {
    where.paymentType = paymentTypeFilter as SalePaymentType;
  }
  if (paymentStatusFilter === "PAID") {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      {
        OR: [
          { paymentType: SalePaymentType.CASH_SALE },
          { amountRemain: { equals: 0 } },
        ],
      },
    ];
  } else if (paymentStatusFilter === "OUTSTANDING") {
    where.paymentType = SalePaymentType.CREDIT_SALE;
    where.amountRemain = { not: 0 };
  }
  where.channel = channelFilter;
  if (customerId) {
    where.customerId = customerId;
  }
  if (productId) {
    where.items = { some: { productId } };
  }
  if (shippingStatusFilter && fulfillmentTypeFilter === "DELIVERY") {
    where.fulfillmentType = "DELIVERY";
    where.shippingStatus  = shippingStatusFilter as ShippingStatus;
  }
  if (q) {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      {
        OR: [
          { saleNo:       { contains: q, mode: "insensitive" } },
          { channelRefNo: { contains: q, mode: "insensitive" } },
          { customerName: { contains: q, mode: "insensitive" } },
          { customer:     { name: { contains: q, mode: "insensitive" } } },
        ],
      },
    ];
  }

  const whereClause = Object.keys(where).length > 0 ? where : undefined;

  const [sales, totalCount, selectedCustomer, selectedProduct] = await Promise.all([
    db.sale.findMany({
      where: whereClause,
      orderBy: [{ saleDate: "desc" }, { saleNo: "desc" }],
      take: PAGE_SIZE,
      skip: (pageNum - 1) * PAGE_SIZE,
      include: {
        _count: { select: { items: true } },
        customer: { select: { name: true } },
      },
    }),
    db.sale.count({ where: whereClause }),
    customerId
      ? db.customer.findUnique({
          where: { id: customerId },
          select: { id: true, name: true, code: true },
        })
      : Promise.resolve(null),
    productId
      ? db.product.findUnique({
          where: { id: productId },
          select: { id: true, name: true, code: true },
        })
      : Promise.resolve(null),
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const paginationParams: Record<string, string> = {};
  if (q)                    paginationParams.q              = q;
  if (paymentTypeFilter)    paginationParams.paymentType    = paymentTypeFilter;
  if (paymentStatusFilter)  paginationParams.paymentStatus  = paymentStatusFilter;
  paginationParams.channel = channelFilter;
  if (from)                 paginationParams.from           = from;
  if (to)                   paginationParams.to             = to;
  if (shippingStatusFilter) paginationParams.shippingStatus = shippingStatusFilter;
  if (fulfillmentTypeFilter) paginationParams.fulfillmentType = fulfillmentTypeFilter;
  if (customerId)           paginationParams.customerId      = customerId;
  if (productId)            paginationParams.productId       = productId;

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="บันทึกการขาย"
        description={channelFilter === SaleChannel.SHOPEE ? "ออเดอร์ Shopee ที่คีย์เมื่อตอนพร้อมจัดส่ง" : "ค้นหา ดูรายละเอียด และจัดการใบขายหน้าร้าน"}
        actions={
          canCreate && (channelFilter === SaleChannel.STORE || canManageShopee) ? (
            <Link
              href={channelFilter === SaleChannel.SHOPEE ? "/admin/sales/shopee/new" : "/admin/sales/new"}
              className="inline-flex items-center gap-2 rounded-xl bg-[#f97316] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
            >
              <Plus size={16} /> {channelFilter === SaleChannel.SHOPEE ? "บันทึกขาย Shopee" : "บันทึกการขายใหม่"}
            </Link>
          ) : null
        }
      />

      <div className="flex flex-wrap items-end gap-2 border-b border-slate-200 dark:border-white/10">
        <SalesChannelTabs currentChannel={channelFilter} />
        {channelFilter === SaleChannel.SHOPEE && canManageShopee ? <div className="ml-auto flex gap-2 pb-2">
          <Link href="/admin/sales/shopee/settlements" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"><WalletCards size={15}/> กระทบยอดรับเงิน</Link>
          {canViewReports ? <Link href="/admin/reports/shopee" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"><BarChart3 size={15}/> รายงาน Shopee</Link> : null}
        </div> : null}
      </div>

      <AdminFilterToolbar
        className="mb-0"
        summary={
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-700 dark:text-slate-200">กำลังแสดงผลของ:</span>
            {selectedCustomer ? (
              <AdminStatusBadge tone="info">
                ลูกค้า: {selectedCustomer.name} {selectedCustomer.code ? `(${selectedCustomer.code})` : ""}
              </AdminStatusBadge>
            ) : null}
            {selectedProduct ? (
              <AdminStatusBadge tone="info">
                สินค้า: {selectedProduct.name} {selectedProduct.code ? `(${selectedProduct.code})` : ""}
              </AdminStatusBadge>
            ) : null}
            {(selectedCustomer || selectedProduct) && (
              <Link href="/admin/sales" className="text-sm font-medium text-sky-700 underline-offset-2 hover:underline dark:text-sky-300">
                ล้าง filter drilldown
              </Link>
            )}
          </div>
        }
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <SalesFilterBar />
            <DateRangeFilter from={from} to={to} />
          </div>
          <SearchBar placeholder="ค้นหาเลขที่ใบขาย, ชื่อลูกค้า..." />
        </div>
      </AdminFilterToolbar>

      {q && <p className="text-sm text-slate-500 dark:text-slate-400">ผลการค้นหา &quot;{q}&quot;: {totalCount} รายการ</p>}

      <AdminTableSection>
        <table className="min-w-[1360px] w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 dark:bg-white/5 dark:text-slate-300">
            <tr>
              <th className="w-10 px-4 py-3 text-center font-medium">#</th>
              <th className="px-4 py-3 text-left font-medium">เลขที่ใบขาย</th>
              <th className="px-4 py-3 text-left font-medium">วันที่</th>
              <th className="w-[220px] px-4 py-3 text-left font-medium">ลูกค้า</th>
              <th className="px-4 py-3 text-left font-medium">ช่องทาง</th>
              <th className="px-4 py-3 text-left font-medium">ขายสด/เชื่อ</th>
              <th className="px-4 py-3 text-left font-medium">สถานะการชำระ</th>
              <th className="px-4 py-3 text-left font-medium">การจัดส่ง</th>
              <th className="px-4 py-3 text-left font-medium">สถานะส่ง</th>
              <th className="px-4 py-3 text-right font-medium">รายการ</th>
              <th className="px-4 py-3 text-right font-medium">ยอดสุทธิ</th>
              <th className="px-4 py-3 text-left font-medium">ช่องทางชำระ</th>
              <th className="px-4 py-3 text-left font-medium">สถานะ</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {sales.length === 0 ? (
              <tr>
                <td colSpan={14} className="px-4 py-12 text-center text-slate-400 dark:text-slate-500">
                  {q ? `ไม่พบรายการที่ตรงกับ "${q}"` : "ยังไม่มีรายการขาย"}
                </td>
              </tr>
            ) : (
              sales.map((s, idx) => {
                const paymentStatus = getPaymentStatus(s.paymentType, s.amountRemain);

                return (
                  <tr
                    key={s.id}
                    className={`border-t border-slate-100 transition-colors dark:border-white/5 ${
                      getAdminDocumentRowClass(s.status === "CANCELLED")
                    }`}
                  >
                    <td className="px-4 py-3 text-center text-xs tabular-nums text-slate-400 dark:text-slate-500">{(pageNum - 1) * PAGE_SIZE + idx + 1}</td>
                    <td className="px-4 py-3 font-mono font-medium text-[#1e3a5f] dark:text-sky-200">{s.saleNo}{s.channelRefNo ? <span className="mt-0.5 block font-sans text-xs font-normal text-slate-500 dark:text-slate-400">Shopee: {s.channelRefNo}</span> : null}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatDateThai(s.saleDate)}</td>
                    <td className="w-[220px] px-4 py-3 text-slate-600 dark:text-slate-300">{s.customer?.name ?? s.customerName ?? "-"}</td>
                    <td className="px-4 py-3"><AdminStatusBadge tone={channelTone[s.channel]}>{channelLabel[s.channel]}</AdminStatusBadge></td>
                    <td className="px-4 py-3"><AdminStatusBadge tone={paymentTypeTone[s.paymentType]}>{paymentTypeLabel[s.paymentType]}</AdminStatusBadge></td>
                    <td className="px-4 py-3"><AdminStatusBadge tone={paymentStatusTone[paymentStatus]}>{paymentStatusLabel[paymentStatus]}</AdminStatusBadge></td>
                    <td className="px-4 py-3"><AdminStatusBadge tone={fulfillmentTone[s.fulfillmentType]}>{fulfillmentLabel[s.fulfillmentType]}</AdminStatusBadge></td>
                    <td className="px-4 py-3">
                      {s.fulfillmentType === "DELIVERY" && s.status === "ACTIVE" ? (
                        <AdminStatusBadge tone={SHIPPING_STATUS_TONE[s.shippingStatus] ?? "neutral"}>{SHIPPING_STATUS_LABEL[s.shippingStatus]}</AdminStatusBadge>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">{s._count.items} รายการ</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-900 dark:text-slate-100">{Number(s.netAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{s.paymentMethod ? (paymentMethodLabel[s.paymentMethod] ?? s.paymentMethod) : "-"}</td>
                    <td className="px-4 py-3">
                      {s.status === "CANCELLED" ? (
                        <AdminStatusBadge tone="danger">ยกเลิกแล้ว</AdminStatusBadge>
                      ) : (
                        <AdminStatusBadge tone="success">ใช้งาน</AdminStatusBadge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <AdminActionGroup align="end">
                        <PrintFromListButton href={`/admin/sales/${s.id}`} />
                        <Link href={`/admin/sales/${s.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-[#1e3a5f] transition-colors hover:text-blue-700 dark:text-sky-300 dark:hover:text-sky-200">
                          <Eye size={14} /> ดู
                        </Link>
                        {s.status === "ACTIVE" ? (
                          <>
                            {canUpdate && s.channel !== SaleChannel.SHOPEE ? (
                              <Link href={`/admin/sales/${s.id}/edit`} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
                                <Pencil size={14} /> แก้ไข
                              </Link>
                            ) : null}
                            {canCancel ? <SaleCancelButton saleId={s.id} docNo={s.saleNo} /> : null}
                          </>
                        ) : null}
                      </AdminActionGroup>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </AdminTableSection>

      <Pagination currentPage={pageNum} totalPages={totalPages} basePath="/admin/sales" searchParams={paginationParams} />
    </div>
  );
};

export default SalesPage;
