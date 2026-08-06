export const dynamic = "force-dynamic";

import type { Prisma } from "@/lib/generated/prisma";
import { hasPermissionAccess } from "@/lib/access-control";
import { getSession } from "@/lib/auth-session";
import { db } from "@/lib/db";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { resolveDeliveryDateRange } from "@/lib/delivery-date-filter";
import MobileDeliveryQueue from "./MobileDeliveryQueue";

const VALID_STATUSES = ["PENDING", "OUT_FOR_DELIVERY", "DELIVERED"] as const;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 300;

type ShippingStatusFilter = (typeof VALID_STATUSES)[number];

const clampLimit = (value: string | undefined) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(20, Math.trunc(parsed)));
};

const DeliveryUpdatePage = async ({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; from?: string; to?: string; limit?: string }>;
}) => {
  await requirePermission("delivery.view");

  const params = await searchParams;
  const statusFilter: ShippingStatusFilter | undefined =
    params.status && (VALID_STATUSES as readonly string[]).includes(params.status)
      ? (params.status as ShippingStatusFilter)
      : undefined;

  const { fromKey, toKey, saleDateFilter, isDefaultFrom } = resolveDeliveryDateRange({
    status: statusFilter,
    from: params.from,
    to: params.to,
  });
  const limit = clampLimit(params.limit);
  const openStatuses: ShippingStatusFilter[] = ["PENDING", "OUT_FOR_DELIVERY"];

  const [{ role, permissions }, session] = await Promise.all([
    getSessionPermissionContext(),
    getSession(),
  ]);
  const canUpdate = hasPermissionAccess(role, permissions, "delivery.update");
  const canTrack = hasPermissionAccess(role, permissions, "delivery.update");

  const salesWhere: Prisma.SaleWhereInput = {
    fulfillmentType: "DELIVERY" as const,
    status: "ACTIVE" as const,
    ...(statusFilter
      ? { shippingStatus: statusFilter }
      : { shippingStatus: { in: openStatuses } }),
    ...(saleDateFilter ? { saleDate: saleDateFilter } : {}),
  };

  // Optimize: Use index hint for common query patterns
  // Note: Prisma doesn't support index hints directly, but proper indexes in schema help
  // Key indexes needed: (fulfillmentType, status, shippingStatus), (deliveryQueueOrder)

  const [sales, statusGroups] = await Promise.all([
    db.sale.findMany({
      where: salesWhere,
      orderBy:
        statusFilter === "DELIVERED"
          ? [{ updatedAt: "desc" }, { saleNo: "desc" }]
          : [
              { deliveryQueueOrder: { sort: "asc", nulls: "last" } },
              { saleDate: "desc" },
              { saleNo: "desc" },
            ],
      take: limit + 1,
      select: {
        id: true,
        saleNo: true,
        saleDate: true,
        customerName: true,
        customerId: true,
        customerPhone: true,
        shippingAddress: true,
        shippingStatus: true,
        shippingMethod: true,
        trackingNo: true,
        netAmount: true,
        paymentType: true,
        amountRemain: true,
        deliveryQueueOrder: true,
        deliveryStaffId: true,
        destLatitude: true,
        destLongitude: true,
        customer: { select: { name: true, phone: true } },
        deliveryStaff: { select: { name: true } },
        items: {
          select: {
            id: true,
            quantity: true,
            salePrice: true,
            totalAmount: true,
            product: { select: { code: true, name: true, saleUnitName: true } },
            lotItems: { orderBy: { id: "asc" }, select: { lotNo: true, qty: true } },
          },
          orderBy: [{ lineNo: "asc" }, { id: "asc" }],
        },
        _count: { select: { deliveryProofs: true } },
      },
    }),
    db.sale.groupBy({
      by: ["shippingStatus"],
      where: {
        fulfillmentType: "DELIVERY",
        status: "ACTIVE",
        shippingStatus: { in: openStatuses },
      },
      _count: { _all: true },
    }),
  ]);

  const hasMore = sales.length > limit;
  const visibleSales = hasMore ? sales.slice(0, limit) : sales;

  // Sales assigned to the current driver that are actively out for delivery
  const myOutForDeliveryIds = canTrack && session?.user?.id
    ? visibleSales
        .filter(
          (s) =>
            s.shippingStatus === "OUT_FOR_DELIVERY" &&
            (s.deliveryStaffId === session.user.id || s.deliveryStaffId === null),
        )
        .map((s) => s.id)
    : [];

  const counts = {
    PENDING: 0,
    OUT_FOR_DELIVERY: 0,
  };
  for (const group of statusGroups) {
    if (group.shippingStatus === "PENDING" || group.shippingStatus === "OUT_FOR_DELIVERY") {
      counts[group.shippingStatus] = group._count._all;
    }
  }

  const items = visibleSales.map((s) => ({
    saleId: s.id,
    saleNo: s.saleNo,
    saleDate: s.saleDate.toISOString(),
    customerId: s.customerId ?? null,
    customerName: s.customer?.name ?? s.customerName ?? "-",
    customerPhone: s.customer?.phone ?? s.customerPhone ?? null,
    shippingAddress: s.shippingAddress ?? null,
    shippingStatus: s.shippingStatus,
    shippingMethod: s.shippingMethod ?? "NONE",
    trackingNo: s.trackingNo ?? null,
    netAmount: Number(s.netAmount),
    paymentType: s.paymentType,
    amountRemain: Number(s.amountRemain),
    deliveryQueueOrder: s.deliveryQueueOrder,
    deliveryStaffId: s.deliveryStaffId,
    deliveryStaffName: s.deliveryStaff?.name ?? null,
    destLatitude: s.destLatitude ?? null,
    destLongitude: s.destLongitude ?? null,
    proofCount: s._count.deliveryProofs,
    items: s.items.map((item) => ({
      id: item.id,
      productCode: item.product.code,
      productName: item.product.name,
      unitName: item.product.saleUnitName,
      quantity: Number(item.quantity),
      salePrice: Number(item.salePrice),
      totalAmount: Number(item.totalAmount),
      lots: item.lotItems.map((lot) => ({
        lotNo: lot.lotNo,
        qty: Number(lot.qty),
      })),
    })),
  }));

  const canReorder = canUpdate && !statusFilter && !hasMore && items.length > 1;

  return (
    <MobileDeliveryQueue
      items={items}
      counts={counts}
      currentFilter={statusFilter ?? null}
      canUpdate={canUpdate}
      canReorder={canReorder}
      canTrack={canTrack}
      myOutForDeliveryIds={myOutForDeliveryIds}
      fromDate={fromKey}
      toDate={toKey}
      linkFromDate={isDefaultFrom ? "" : fromKey}
      currentLimit={limit}
      hasMore={hasMore}
    />
  );
};

export default DeliveryUpdatePage;
