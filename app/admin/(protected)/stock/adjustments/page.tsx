export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import AdjustmentForm from "./AdjustmentForm";
import AdjustmentHistoryList from "./AdjustmentHistoryList";
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

  const [products, adjustments] = await Promise.all([
    db.product.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: {
        id:          true,
        code:        true,
        name:        true,
        description: true,
        stock:       true,
        costPrice:   true,
        salePrice:   true,
        isLotControl:      true,
        requireExpiryDate: true,
        lotIssueMethod:    true,
        category: { select: { name: true } },
        brand:    { select: { name: true } },
        aliases:  { select: { alias: true } },
        units: {
          select: { name: true, scale: true, isBase: true },
          orderBy: { isBase: "desc" },
        },
      },
    }),
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

  const productOptions = products.map((p) => ({
    id:          p.id,
    code:        p.code,
    name:        p.name,
    description: p.description,
    stock:       p.stock,
    costPrice:   Number(p.costPrice),
    salePrice:   Number(p.salePrice),
    isLotControl:      p.isLotControl,
    requireExpiryDate: p.requireExpiryDate,
    lotIssueMethod:    p.lotIssueMethod,
    categoryName: p.category.name,
    brandName:   p.brand?.name ?? null,
    aliases:     p.aliases.map((a) => a.alias),
    units:       p.units.map((u) => ({ name: u.name, scale: Number(u.scale), isBase: u.isBase })),
  }));

  const serialized = adjustments.map((a) => ({
    ...a,
    adjustDate:  a.adjustDate.toISOString(),
    cancelledAt: a.cancelledAt?.toISOString() ?? null,
    items:       a.items.map((i) => ({ ...i, qtyAdjust: Number(i.qtyAdjust) })),
  }));

  return (
    <div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-2">ปรับสต็อก</h1>
      <p className="text-sm text-gray-500 mb-6">ปรับเพิ่ม/ลดจำนวนสินค้าพร้อมระบุเหตุผล</p>

      <AdjustmentForm products={productOptions} canCreate={canCreate} />

      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-kanit text-lg font-semibold text-gray-800">ประวัติการปรับสต็อก</h2>
          <DateRangeFilter from={from} to={to} />
        </div>
        <AdjustmentHistoryList adjustments={serialized} canCancel={canCancel} />
      </div>
    </div>
  );
};

export default AdjustmentsPage;
