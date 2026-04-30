export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import MobileStatusTabs from "./MobileStatusTabs";
import MobileDeliveryCard from "./MobileDeliveryCard";

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

  const sales = await db.sale.findMany({
    where: {
      fulfillmentType: "DELIVERY",
      status:          "ACTIVE",
      ...(statusFilter
        ? { shippingStatus: statusFilter }
        : { shippingStatus: { in: ["PENDING", "OUT_FOR_DELIVERY"] } }),
    },
    orderBy: [{ saleDate: "desc" }, { saleNo: "desc" }],
    take: 100,
    select: {
      id:              true,
      saleNo:          true,
      saleDate:        true,
      customerName:    true,
      customerPhone:   true,
      shippingAddress: true,
      shippingStatus:  true,
      shippingMethod:  true,
      trackingNo:      true,
      netAmount:       true,
      paymentType:     true,
      amountRemain:    true,
      customer:        { select: { name: true, phone: true } },
    },
  });

  return (
    <div className="-m-4 lg:-m-6">
      <div className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-white/10 dark:bg-[#0f172a]/95">
        <div className="mb-2 flex items-center justify-between">
          <h1 className="font-kanit text-xl font-bold text-gray-900 dark:text-slate-100">
            อัปเดตจัดส่ง
          </h1>
          <span className="text-sm text-gray-500 dark:text-slate-400">
            {sales.length} รายการ
          </span>
        </div>
        <MobileStatusTabs current={statusFilter} />
      </div>

      <div className="space-y-3 px-3 py-3 sm:px-4">
        {sales.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-400 dark:border-white/10 dark:bg-slate-900 dark:text-slate-500">
            ไม่มีรายการจัดส่ง
          </div>
        ) : (
          sales.map((s) => (
            <MobileDeliveryCard
              key={s.id}
              saleId={s.id}
              saleNo={s.saleNo}
              saleDate={s.saleDate.toISOString()}
              customerName={s.customer?.name ?? s.customerName ?? "-"}
              customerPhone={s.customer?.phone ?? s.customerPhone ?? null}
              shippingAddress={s.shippingAddress ?? null}
              shippingStatus={s.shippingStatus}
              shippingMethod={s.shippingMethod ?? "NONE"}
              trackingNo={s.trackingNo ?? null}
              netAmount={Number(s.netAmount)}
              paymentType={s.paymentType}
              amountRemain={Number(s.amountRemain)}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default DeliveryUpdatePage;
