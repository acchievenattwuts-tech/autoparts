export const dynamic = "force-dynamic";

import type { Prisma } from "@/lib/generated/prisma";
import { hasPermissionAccess } from "@/lib/access-control";
import { db } from "@/lib/db";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { getThailandDateKey, parseDateOnlyToEndOfDay, parseDateOnlyToStartOfDay } from "@/lib/th-date";
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
  searchParams: Promise<{ status?: string; deliveredDate?: string; limit?: string }>;
}) => {
  await requirePermission("delivery.view");

  const params = await searchParams;
  const statusFilter: ShippingStatusFilter | undefined =
    params.status && (VALID_STATUSES as readonly string[]).includes(params.status)
      ? (params.status as ShippingStatusFilter)
      : undefined;

  const deliveredDateKey = params.deliveredDate || getThailandDateKey();
  const limit = clampLimit(params.limit);
  const openStatuses: ShippingStatusFilter[] = ["PENDING", "OUT_FOR_DELIVERY"];
  const deliveredRange =
    statusFilter === "DELIVERED"
      ? {
          gte: parseDateOnlyToStartOfDay(deliveredDateKey),
          lte: parseDateOnlyToEndOfDay(deliveredDateKey),
        }
      : undefined;

  const { role, permissions } = await getSessionPermissionContext();
  const canUpdate = hasPermissionAccess(role, permissions, "delivery.update");

  const salesWhere: Prisma.SaleWhereInput = {
    fulfillmentType: "DELIVERY" as const,
    status: "ACTIVE" as const,
    ...(statusFilter
      ? statusFilter === "DELIVERED"
        ? {
            shippingStatus: "DELIVERED" as const,
            updatedAt: deliveredRange,
          }
        : { shippingStatus: statusFilter }
      : { shippingStatus: { in: openStatuses } }),
  };

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
        customer: { select: { name: true, phone: true } },
        deliveryStaff: { select: { name: true } },
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
    proofCount: s._count.deliveryProofs,
  }));

  const canReorder = canUpdate && !statusFilter && !hasMore && items.length > 1;

  return (
    <MobileDeliveryQueue
      items={items}
      counts={counts}
      currentFilter={statusFilter ?? null}
      canUpdate={canUpdate}
      canReorder={canReorder}
      deliveredDate={statusFilter === "DELIVERED" ? deliveredDateKey : null}
      deliveredDateLabel={statusFilter === "DELIVERED" ? deliveredDateKey : null}
      currentLimit={limit}
      hasMore={hasMore}
    />
  );
};

export default DeliveryUpdatePage;
