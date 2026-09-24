export const dynamic = "force-dynamic";
export const maxDuration = 130; // Vercel Pro: must exceed dbTx default (110s) + response time

import { db } from "@/lib/db";
import AdjustmentForm from "./AdjustmentForm";
import AdjustmentHistoryList from "./AdjustmentHistoryList";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import DateRangeFilter from "@/components/shared/DateRangeFilter";
import { hasPermissionAccess } from "@/lib/access-control";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { parseDateOnlyToEndOfDay, parseDateOnlyToStartOfDay } from "@/lib/th-date";

const AdjustmentsPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) => {
  await requirePermission("stock.adjustments.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canCreate = hasPermissionAccess(role, permissions, "stock.adjustments.create");
  const canCancel = hasPermissionAccess(role, permissions, "stock.adjustments.cancel");

  const { from: fromParam, to: toParam } = await searchParams;
  const from = fromParam ?? "";
  const to   = toParam   ?? "";

  const adjustmentWhere = (from || to) ? {
    adjustDate: {
      ...(from ? { gte: parseDateOnlyToStartOfDay(from) } : {}),
      ...(to   ? { lte: parseDateOnlyToEndOfDay(to) } : {}),
    },
  } : {};

  // Products are searched on demand by AdjustmentForm (searchAdjustmentProducts),
  // like the sale/purchase forms, instead of shipping the whole catalog.
  const [adjustments] = await Promise.all([
    db.adjustment.findMany({
      where: adjustmentWhere,
      orderBy: { adjustDate: "desc" },
      take: 100,
      select: {
        id: true,
        adjustNo: true,
        adjustDate: true,
        note: true,
        status: true,
        cancelledAt: true,
        cancelNote: true,
        user: { select: { name: true } },
        items: {
          orderBy: [{ lineNo: "asc" }, { id: "asc" }],
          select: {
            id: true,
            qtyAdjust: true,
            reason: true,
            product: { select: { code: true, name: true } },
          },
        },
      },
    }),
  ]);

  const serialized = adjustments.map((a) => ({
    ...a,
    adjustDate:  a.adjustDate.toISOString(),
    cancelledAt: a.cancelledAt?.toISOString() ?? null,
    items:       a.items.map((i) => ({ ...i, qtyAdjust: Number(i.qtyAdjust) })),
  }));

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="สต็อก"
        title="ปรับสต็อก"
        description="ปรับเพิ่ม/ลดจำนวนสินค้าพร้อมระบุเหตุผล"
      />

      <AdjustmentForm products={[]} canCreate={canCreate} />

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">ประวัติการปรับสต็อก</h2>
          <DateRangeFilter from={from} to={to} />
        </div>
        <AdjustmentHistoryList adjustments={serialized} canCancel={canCancel} />
      </div>
    </div>
  );
};

export default AdjustmentsPage;
