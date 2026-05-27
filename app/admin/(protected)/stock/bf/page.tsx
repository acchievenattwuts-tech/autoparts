export const dynamic = "force-dynamic";
export const maxDuration = 180; // Vercel Pro: stock backfill — Supabase statement_timeout=2min, allow extra time for multiple batch transactions

import AdminPageHeader from "@/components/shared/AdminPageHeader";
import { db } from "@/lib/db";
import BfForm from "./BfForm";
import BfHistoryTable from "./BfHistoryTable";
import { hasPermissionAccess } from "@/lib/access-control";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { INVENTORY_TRACKING_TRACKED } from "@/lib/inventory-tracking";

const BfPage = async () => {
  await requirePermission("stock.bf.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canCreate = hasPermissionAccess(role, permissions, "stock.bf.create");
  const canCancel = hasPermissionAccess(role, permissions, "stock.bf.cancel");

  const [products, bfDocs] = await Promise.all([
    db.product.findMany({
      where: { isActive: true, inventoryTracking: INVENTORY_TRACKING_TRACKED },
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        avgCost: true,
        stock: true,
        isLotControl: true,
        requireExpiryDate: true,
        units: {
          select: { name: true, scale: true, isBase: true },
          orderBy: { isBase: "desc" },
        },
      },
    }),
    db.balanceForward.findMany({
      orderBy: [{ docDate: "desc" }, { createdAt: "desc" }],
      take: 100,
      select: {
        id: true,
        docNo: true,
        docDate: true,
        unitName: true,
        qtyInBase: true,
        costPerBaseUnit: true,
        note: true,
        status: true,
        cancelledAt: true,
        cancelNote: true,
        product: { select: { code: true, name: true } },
      },
    }),
  ]);

  const mapped = products.map((p) => ({
    ...p,
    avgCost: Number(p.avgCost),
    isLotControl: p.isLotControl,
    requireExpiryDate: p.requireExpiryDate,
  }));

  const serialized = bfDocs.map((d) => ({
    ...d,
    docDate:         d.docDate.toISOString(),
    cancelledAt:     d.cancelledAt?.toISOString() ?? null,
    qtyInBase:       Number(d.qtyInBase),
    costPerBaseUnit: Number(d.costPerBaseUnit),
  }));

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="สต็อก"
        title="ยอดยกมา (BF)"
        description="บันทึกจำนวนสินค้าเริ่มต้นก่อนเริ่มใช้ระบบ"
      />

      <BfForm products={mapped} canCreate={canCreate} />

      <div>
        <h2 className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100 mb-4">ประวัติเอกสารยอดยกมา</h2>
        <BfHistoryTable docs={serialized} canCancel={canCancel} />
      </div>
    </div>
  );
};

export default BfPage;
