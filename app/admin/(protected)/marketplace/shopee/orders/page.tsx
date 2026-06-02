export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowLeft, Inbox } from "lucide-react";

import { ensureAccessControlSetup, hasPermissionAccess } from "@/lib/access-control";
import { db } from "@/lib/db";
import { ShopeeAuthStatus, ShopeeOrderImportStatus } from "@/lib/generated/prisma";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { formatDateTimeThai } from "@/lib/th-date";

import OrderQueueControls from "./OrderQueueControls";

const STATUS_META: Record<ShopeeOrderImportStatus, { label: string; className: string }> = {
  PENDING: { label: "รอตรวจ", className: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200" },
  IMPORTED: { label: "สร้างบิลแล้ว", className: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200" },
  FAILED: { label: "ผิดพลาด", className: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200" },
  NEEDS_SKU_MAPPING: { label: "ต้อง map SKU", className: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-200" },
  NEEDS_LOT_SELECTION: { label: "ต้องเลือก lot", className: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-200" },
  CANCELLED_REVIEW: { label: "รอตรวจยกเลิก", className: "border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300" },
  SKIPPED: { label: "ข้าม", className: "border-slate-200 bg-slate-50 text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400" },
};

const STATUS_ORDER: ShopeeOrderImportStatus[] = [
  ShopeeOrderImportStatus.PENDING,
  ShopeeOrderImportStatus.NEEDS_SKU_MAPPING,
  ShopeeOrderImportStatus.IMPORTED,
  ShopeeOrderImportStatus.FAILED,
  ShopeeOrderImportStatus.CANCELLED_REVIEW,
  ShopeeOrderImportStatus.SKIPPED,
];

const parseStatus = (value: string | undefined): ShopeeOrderImportStatus | null =>
  value && (STATUS_ORDER as string[]).includes(value) ? (value as ShopeeOrderImportStatus) : null;

type OrdersPageProps = { searchParams: Promise<{ status?: string }> };

const ShopeeOrdersPage = async ({ searchParams }: OrdersPageProps) => {
  await ensureAccessControlSetup();
  await requirePermission("marketplace.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canSync = hasPermissionAccess(role, permissions, "marketplace.sync");
  const params = await searchParams;
  const statusFilter = parseStatus(params.status);

  const shop = await db.shopeeShop.findFirst({
    where: { authStatus: ShopeeAuthStatus.AUTHORIZED },
    orderBy: { authorizedAt: "desc" },
    select: { id: true, shopId: true, shopName: true, lastOrderSyncAt: true },
  });

  const [orders, grouped] = shop
    ? await Promise.all([
        db.shopeeOrderImport.findMany({
          where: { shopRecordId: shop.id, ...(statusFilter ? { importStatus: statusFilter } : {}) },
          orderBy: { createdAt: "desc" },
          take: 100,
          select: {
            id: true,
            orderSn: true,
            shopeeStatus: true,
            importStatus: true,
            buyerUsername: true,
            totalAmount: true,
            currency: true,
            orderCreatedAt: true,
            lastError: true,
          },
        }),
        db.shopeeOrderImport.groupBy({
          by: ["importStatus"],
          where: { shopRecordId: shop.id },
          _count: { _all: true },
        }),
      ])
    : [[], []];

  const countByStatus = new Map(grouped.map((g) => [g.importStatus, g._count._all]));
  const totalCount = grouped.reduce((sum, g) => sum + g._count._all, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-orange-200 bg-orange-50 text-orange-600 dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-300">
            <Inbox size={22} />
          </span>
          <div>
            <h1 className="font-kanit text-xl font-bold text-slate-900 dark:text-slate-100">คิวออเดอร์ Shopee</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              ดึงออเดอร์เข้า queue เพื่อตรวจสอบ — ยังไม่สร้างบิล/ตัดสต็อก
            </p>
          </div>
        </div>
        <Link
          href="/admin/marketplace/shopee"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
        >
          <ArrowLeft size={15} />
          กลับ
        </Link>
      </div>

      {!shop ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-6 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100">
          <p className="font-medium">ยังไม่มีร้าน Shopee ที่เชื่อมต่อ</p>
          <p className="mt-1">
            ต้อง{" "}
            <Link href="/admin/marketplace/shopee" className="underline">
              เชื่อมต่อร้าน Shopee
            </Link>{" "}
            ก่อน
          </p>
        </div>
      ) : (
        <>
          {canSync ? <OrderQueueControls shopRecordId={shop.id} /> : null}
          {shop.lastOrderSyncAt ? (
            <p className="text-xs text-slate-400 dark:text-slate-500">
              ดึงล่าสุด {formatDateTimeThai(shop.lastOrderSyncAt, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/marketplace/shopee/orders"
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                !statusFilter
                  ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:bg-[#0d1728] dark:text-slate-300 dark:hover:bg-white/10"
              }`}
            >
              ทั้งหมด ({totalCount})
            </Link>
            {STATUS_ORDER.map((status) => {
              const count = countByStatus.get(status) ?? 0;
              if (count === 0 && statusFilter !== status) return null;
              const active = statusFilter === status;
              return (
                <Link
                  key={status}
                  href={`/admin/marketplace/shopee/orders?status=${status}`}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:bg-[#0d1728] dark:text-slate-300 dark:hover:bg-white/10"
                  }`}
                >
                  {STATUS_META[status].label} ({count})
                </Link>
              );
            })}
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-[#0d1728]">
            {orders.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                ยังไม่มีออเดอร์ในคิว — กด &quot;ดึงออเดอร์จาก Shopee&quot;
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-white/10">
                {orders.map((order) => {
                  const meta = STATUS_META[order.importStatus];
                  return (
                    <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-slate-900 dark:text-slate-100">{order.orderSn}</p>
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.className}`}>
                            {meta.label}
                          </span>
                          <span className="text-[11px] text-slate-400 dark:text-slate-500">{order.shopeeStatus}</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {order.buyerUsername ?? "ไม่ระบุผู้ซื้อ"}
                          {order.orderCreatedAt
                            ? ` · ${formatDateTimeThai(order.orderCreatedAt, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`
                            : ""}
                        </p>
                        {order.lastError ? (
                          <p className="mt-1 text-xs text-rose-600 dark:text-rose-300">{order.lastError}</p>
                        ) : null}
                      </div>
                      <div className="text-right text-sm">
                        {order.totalAmount != null ? (
                          <p className="font-medium text-slate-900 dark:text-slate-100">
                            {Number(order.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            {order.currency ? ` ${order.currency}` : ""}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default ShopeeOrdersPage;
