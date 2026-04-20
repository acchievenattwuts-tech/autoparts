export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { Plus, Eye, Pencil } from "lucide-react";
import { FulfillmentType, SalePaymentType, SaleType, ShippingStatus } from "@/lib/generated/prisma";
import type { Prisma } from "@/lib/generated/prisma";
import SalesFilterBar from "./SalesFilterBar";
import SearchBar from "@/components/shared/SearchBar";
import SaleCancelButton from "./SaleCancelButton";
import Pagination from "@/components/shared/Pagination";
import PrintFromListButton from "@/components/shared/PrintFromListButton";
import DateRangeFilter from "@/components/shared/DateRangeFilter";
import { hasPermissionAccess } from "@/lib/access-control";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { SHIPPING_STATUS_LABEL, SHIPPING_STATUS_BADGE } from "@/lib/shipping";
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

const saleTypeLabel: Record<SaleType, string> = {
  RETAIL:    "ปลีก",
  WHOLESALE: "ส่ง",
};

const saleTypeBadge: Record<SaleType, string> = {
  RETAIL:    "bg-green-100 text-green-700",
  WHOLESALE: "bg-blue-100 text-blue-700",
};

const fulfillmentLabel: Record<FulfillmentType, string> = {
  PICKUP:   "หน้าร้าน",
  DELIVERY: "จัดส่ง",
};

const fulfillmentBadge: Record<FulfillmentType, string> = {
  PICKUP:   "bg-gray-100 text-gray-600",
  DELIVERY: "bg-purple-100 text-purple-700",
};

const paymentTypeLabel: Record<SalePaymentType, string> = {
  CASH_SALE:   "สด",
  CREDIT_SALE: "เชื่อ",
};
const paymentTypeBadge: Record<SalePaymentType, string> = {
  CASH_SALE:   "bg-emerald-100 text-emerald-700",
  CREDIT_SALE: "bg-orange-100 text-orange-700",
};


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
    customerId?: string;
    productId?: string;
  }>;
}) => {
  await requirePermission("sales.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canCreate = hasPermissionAccess(role, permissions, "sales.create");
  const canUpdate = hasPermissionAccess(role, permissions, "sales.update");
  const canCancel = hasPermissionAccess(role, permissions, "sales.cancel");

  const params = await searchParams;
  const paymentTypeFilter  = params.paymentType;
  const shippingStatusFilter = params.shippingStatus;
  const fulfillmentTypeFilter = params.fulfillmentType;
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
    where.OR = [
      { saleNo:       { contains: q, mode: "insensitive" } },
      { customerName: { contains: q, mode: "insensitive" } },
      { customer:     { name: { contains: q, mode: "insensitive" } } },
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
  if (from)                 paginationParams.from           = from;
  if (to)                   paginationParams.to             = to;
  if (shippingStatusFilter) paginationParams.shippingStatus = shippingStatusFilter;
  if (fulfillmentTypeFilter) paginationParams.fulfillmentType = fulfillmentTypeFilter;
  if (customerId)           paginationParams.customerId      = customerId;
  if (productId)            paginationParams.productId       = productId;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-kanit text-2xl font-bold text-gray-900">บันทึกการขาย</h1>
        {canCreate ? (
          <Link
            href="/admin/sales/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#f97316] hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus size={16} /> บันทึกการขายใหม่
          </Link>
        ) : null}
      </div>

      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        <div className="flex items-center gap-4 flex-wrap">
          <SalesFilterBar />
          <DateRangeFilter from={from} to={to} />
        </div>
        <SearchBar placeholder="ค้นหาเลขที่ใบขาย, ชื่อลูกค้า..." />
      </div>

      {q && (
        <p className="text-sm text-gray-500 mb-3">ผลการค้นหา &quot;{q}&quot;: {totalCount} รายการ</p>
      )}

      {(selectedCustomer || selectedProduct) && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <span className="font-medium">Filter-ready drilldown:</span>
          {selectedCustomer ? (
            <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-sky-900">
              ลูกค้า: {selectedCustomer.name} {selectedCustomer.code ? `(${selectedCustomer.code})` : ""}
            </span>
          ) : null}
          {selectedProduct ? (
            <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-sky-900">
              สินค้า: {selectedProduct.name} {selectedProduct.code ? `(${selectedProduct.code})` : ""}
            </span>
          ) : null}
          <Link
            href="/admin/sales"
            className="ml-auto text-xs font-medium text-sky-700 underline-offset-2 hover:underline"
          >
            ล้าง filter drilldown
          </Link>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-center py-3 px-4 font-medium text-gray-600 w-10">#</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">เลขที่ใบขาย</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">วันที่</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">ลูกค้า</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">ประเภท</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">ขายสด/เชื่อ</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">การจัดส่ง</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">สถานะส่ง</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">รายการ</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">ยอดสุทธิ</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">ช่องทางชำระ</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">สถานะ</th>
                <th className="py-3 px-4" />
              </tr>
            </thead>
            <tbody>
              {sales.length === 0 ? (
                <tr>
                  <td colSpan={13} className="text-center py-12 text-gray-400">
                    {q ? `ไม่พบรายการที่ตรงกับ "${q}"` : "ยังไม่มีรายการขาย"}
                  </td>
                </tr>
              ) : (
                sales.map((s, idx) => (
                  <tr key={s.id}
                    className={`border-t border-gray-50 transition-colors ${
                      s.status === "CANCELLED" ? "opacity-50 bg-red-50" : "hover:bg-gray-50"
                    }`}>
                    <td className="py-3 px-4 text-center text-gray-400 text-xs tabular-nums">{(pageNum - 1) * PAGE_SIZE + idx + 1}</td>
                    <td className="py-3 px-4 font-mono text-[#1e3a5f] font-medium">{s.saleNo}</td>
                    <td className="py-3 px-4 text-gray-600">
                    {formatDateThai(s.saleDate)}
                    </td>
                    <td className="py-3 px-4 text-gray-600">
                      {s.customer?.name ?? s.customerName ?? "-"}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${saleTypeBadge[s.saleType]}`}>
                        {saleTypeLabel[s.saleType]}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${paymentTypeBadge[s.paymentType]}`}>
                        {paymentTypeLabel[s.paymentType]}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${fulfillmentBadge[s.fulfillmentType]}`}>
                        {fulfillmentLabel[s.fulfillmentType]}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {s.fulfillmentType === "DELIVERY" && s.status === "ACTIVE" && (
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${SHIPPING_STATUS_BADGE[s.shippingStatus]}`}>
                          {SHIPPING_STATUS_LABEL[s.shippingStatus]}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right text-gray-600">{s._count.items} รายการ</td>
                    <td className="py-3 px-4 text-right font-medium text-gray-900">
                      {Number(s.netAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4 text-gray-600">
                      {s.paymentMethod ? (paymentMethodLabel[s.paymentMethod] ?? s.paymentMethod) : "-"}
                    </td>
                    <td className="py-3 px-4">
                      {s.status === "CANCELLED" ? (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                          ยกเลิกแล้ว
                        </span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                          ใช้งาน
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2 justify-end">
                        <PrintFromListButton href={`/admin/sales/${s.id}`} />
                        <Link href={`/admin/sales/${s.id}`}
                          className="inline-flex items-center gap-1 text-xs text-[#1e3a5f] hover:text-blue-700 transition-colors">
                          <Eye size={14} /> ดู
                        </Link>
                        {s.status === "ACTIVE" && (
                          <>
                            {canUpdate ? (
                              <Link href={`/admin/sales/${s.id}/edit`}
                                className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors">
                                <Pencil size={14} /> แก้ไข
                              </Link>
                            ) : null}
                            {canCancel ? <SaleCancelButton saleId={s.id} docNo={s.saleNo} /> : null}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination
        currentPage={pageNum}
        totalPages={totalPages}
        basePath="/admin/sales"
        searchParams={paginationParams}
      />
    </div>
  );
};

export default SalesPage;
