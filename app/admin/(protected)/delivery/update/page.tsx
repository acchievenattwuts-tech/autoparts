export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import MobileDeliveryQueue from "./MobileDeliveryQueue";

const VALID_STATUSES = ["PENDING", "OUT_FOR_DELIVERY", "DELIVERED"] as const;

type ShippingStatusFilter = (typeof VALID_STATUSES)[number];

const DeliveryUpdatePage = async ({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) => {
  await requirePermission("delivery.view");

  const { status } = await searchParams;
  const statusFilter: ShippingStatusFilter | undefined =
    status && (VALID_STATUSES as readonly string[]).includes(status)
      ? (status as ShippingStatusFilter)
      : undefined;

  const [sales, statusGroups] = await Promise.all([
    db.sale.findMany({
      where: {
        fulfillmentType: "DELIVERY",
        status:          "ACTIVE",
        ...(statusFilter
          ? { shippingStatus: statusFilter }
          : { shippingStatus: { in: ["PENDING", "OUT_FOR_DELIVERY"] } }),
      },
      orderBy: [
        { deliveryQueueOrder: { sort: "asc", nulls: "last" } },
        { saleDate: "desc" },
        { saleNo: "desc" },
      ],
      take: 100,
      select: {
        id:                 true,
        saleNo:             true,
        saleDate:           true,
        customerName:       true,
        customerPhone:      true,
        shippingAddress:    true,
        shippingStatus:     true,
        shippingMethod:     true,
        trackingNo:         true,
        netAmount:          true,
        paymentType:        true,
        amountRemain:       true,
        deliveryQueueOrder: true,
        customer:           { select: { name: true, phone: true } },
        deliveryProofs: {
          orderBy: { capturedAt: "desc" },
          take:    1,
          select: {
            id:           true,
            receiverName: true,
            capturedAt:   true,
          },
        },
        _count: { select: { deliveryProofs: true } },
      },
    }),
    db.sale.groupBy({
      by: ["shippingStatus"],
      where: {
        fulfillmentType: "DELIVERY",
        status:          "ACTIVE",
        shippingStatus:  { in: ["PENDING", "OUT_FOR_DELIVERY"] },
      },
      _count: { _all: true },
    }),
  ]);

  const counts = {
    PENDING:          0,
    OUT_FOR_DELIVERY: 0,
  };
  for (const group of statusGroups) {
    if (group.shippingStatus === "PENDING" || group.shippingStatus === "OUT_FOR_DELIVERY") {
      counts[group.shippingStatus] = group._count._all;
    }
  }

  const items = sales.map((s) => ({
    saleId:             s.id,
    saleNo:             s.saleNo,
    saleDate:           s.saleDate.toISOString(),
    customerName:       s.customer?.name ?? s.customerName ?? "-",
    customerPhone:      s.customer?.phone ?? s.customerPhone ?? null,
    shippingAddress:    s.shippingAddress ?? null,
    shippingStatus:     s.shippingStatus,
    shippingMethod:     s.shippingMethod ?? "NONE",
    trackingNo:         s.trackingNo ?? null,
    netAmount:          Number(s.netAmount),
    paymentType:        s.paymentType,
    amountRemain:       Number(s.amountRemain),
    deliveryQueueOrder: s.deliveryQueueOrder,
    proofCount:         s._count.deliveryProofs,
    latestProof:        s.deliveryProofs[0]
      ? {
          id:           s.deliveryProofs[0].id,
          receiverName: s.deliveryProofs[0].receiverName,
          capturedAt:   s.deliveryProofs[0].capturedAt.toISOString(),
        }
      : null,
  }));

  return (
    <MobileDeliveryQueue
      items={items}
      counts={{
        PENDING:          counts.PENDING,
        OUT_FOR_DELIVERY: counts.OUT_FOR_DELIVERY,
      }}
      currentFilter={statusFilter ?? null}
    />
  );
};

export default DeliveryUpdatePage;
