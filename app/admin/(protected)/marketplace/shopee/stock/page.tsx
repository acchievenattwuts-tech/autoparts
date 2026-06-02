export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowLeft, Boxes, Info } from "lucide-react";

import { ensureAccessControlSetup, hasPermissionAccess } from "@/lib/access-control";
import { db } from "@/lib/db";
import { ShopeeAuthStatus } from "@/lib/generated/prisma";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { listShopeeStockReconciliation, type ShopeeStockReconciliationStatus } from "@/lib/shopee/services/stock";
import { formatDateTimeThai } from "@/lib/th-date";

import { MappingSettingsForm, ReconciliationButton, ShopBufferForm } from "./StockSyncControls";

const STATUS_META: Record<ShopeeStockReconciliationStatus, { label: string; className: string }> = {
  DISABLED: {
    label: "ปิด",
    className: "border-slate-200 bg-slate-50 text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400",
  },
  MONITOR_ONLY: {
    label: "เฝ้าดู",
    className: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-200",
  },
  NOT_PUSHED: {
    label: "ยังไม่เคยส่ง",
    className: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200",
  },
  IN_SYNC: {
    label: "ตรงล่าสุด",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200",
  },
  NEEDS_PUSH: {
    label: "ต้องส่งใหม่",
    className: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-200",
  },
  PUSH_FAILED: {
    label: "ส่งไม่สำเร็จ",
    className: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200",
  },
};

const fmt = (value: number | null) => (value == null ? "-" : value.toLocaleString("th-TH"));

const ShopeeStockPage = async () => {
  await ensureAccessControlSetup();
  await requirePermission("marketplace.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canManage = hasPermissionAccess(role, permissions, "marketplace.manage");
  const canSync = hasPermissionAccess(role, permissions, "marketplace.sync");

  const shop = await db.shopeeShop.findFirst({
    where: { authStatus: ShopeeAuthStatus.AUTHORIZED },
    orderBy: { authorizedAt: "desc" },
    select: {
      id: true,
      shopId: true,
      shopName: true,
      stockBuffer: true,
      lastStockSyncAt: true,
    },
  });

  const reconciliation = shop ? await listShopeeStockReconciliation(shop.id) : null;
  const recentJobs = shop
    ? await db.shopeeSyncJob.findMany({
        where: { shopRecordId: shop.id, type: "STOCK_PUSH" },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          status: true,
          itemsProcessed: true,
          itemsFailed: true,
          lastError: true,
          createdAt: true,
          metaJson: true,
        },
      })
    : [];

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-orange-200 bg-orange-50 text-orange-600 dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-300">
            <Boxes size={22} />
          </span>
          <div>
            <h1 className="font-kanit text-xl font-bold text-slate-900 dark:text-slate-100">Shopee Stock Sync</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              ตรวจ stock ที่ควรส่งไป Shopee จาก StockCard/Product.stock พร้อม buffer ต่อร้านหรือ mapping
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

      {!shop || !reconciliation ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-6 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100">
          <p className="font-medium">ยังไม่มีร้าน Shopee ที่เชื่อมต่อ</p>
          <p className="mt-1">
            ต้อง{" "}
            <Link href="/admin/marketplace/shopee" className="underline">
              เชื่อมต่อร้าน Shopee
            </Link>{" "}
            ก่อนจึงจะตรวจ stock sync ได้
          </p>
        </div>
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-[#0d1728]">
              <p className="text-xs text-slate-500 dark:text-slate-400">mapped ทั้งหมด</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">{reconciliation.summary.total}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-[#0d1728]">
              <p className="text-xs text-slate-500 dark:text-slate-400">เปิดส่งไป Shopee</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">{reconciliation.summary.pushEnabled}</p>
            </div>
            <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4 shadow-sm dark:border-orange-400/30 dark:bg-orange-400/10">
              <p className="text-xs text-orange-700 dark:text-orange-200">ต้องตรวจ/ส่งใหม่</p>
              <p className="mt-1 text-2xl font-semibold text-orange-800 dark:text-orange-100">{reconciliation.summary.needsPush}</p>
            </div>
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 shadow-sm dark:border-rose-400/30 dark:bg-rose-400/10">
              <p className="text-xs text-rose-700 dark:text-rose-200">มี error ล่าสุด</p>
              <p className="mt-1 text-2xl font-semibold text-rose-800 dark:text-rose-100">{reconciliation.summary.failed}</p>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0d1728]">
            <div className="grid gap-4 md:grid-cols-[1fr_280px] md:items-end">
              <div>
                <h2 className="font-kanit text-base font-semibold text-slate-900 dark:text-slate-100">
                  ร้าน {shop.shopName ?? shop.shopId}
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  ค่า buffer กลางจะถูกใช้เมื่อ mapping ไม่ได้กำหนด buffer เฉพาะรายการ
                  {shop.lastStockSyncAt
                    ? ` · ตรวจล่าสุด ${formatDateTimeThai(shop.lastStockSyncAt, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`
                    : ""}
                </p>
              </div>
              <ShopBufferForm shopRecordId={shop.id} stockBuffer={shop.stockBuffer} canManage={canManage} />
            </div>
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-100">
              <Info size={15} className="mt-0.5 shrink-0" />
              <p>
                รอบนี้ยังเป็น reconciliation/alert เท่านั้น ยังไม่ยิง live update_stock และยังไม่ hook เข้า transaction หลักจนกว่าจะยืนยัน payload Shopee API จริง
              </p>
            </div>
          </section>

          <ReconciliationButton shopRecordId={shop.id} canSync={canSync} />

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-[#0d1728]">
            {reconciliation.rows.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                ยังไม่มี mapping สินค้า Shopee
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-white/10">
                {reconciliation.rows.map((row) => {
                  const meta = STATUS_META[row.status];
                  return (
                    <div key={row.mappingId} className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(260px,1fr)_320px_320px] lg:items-center">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-slate-900 dark:text-slate-100">
                            {row.productCode} · {row.productName}
                          </p>
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.className}`}>
                            {meta.label}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          item {row.itemId} · model {row.modelId}
                          {row.sellerSku ? ` · SKU ${row.sellerSku}` : ""}
                        </p>
                        {row.lastError ? <p className="mt-1 text-xs text-rose-600 dark:text-rose-300">{row.lastError}</p> : null}
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-xs">
                        <div>
                          <p className="text-slate-400 dark:text-slate-500">ในระบบ</p>
                          <p className="font-medium text-slate-900 dark:text-slate-100">{fmt(row.internalStock)}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 dark:text-slate-500">buffer</p>
                          <p className="font-medium text-slate-900 dark:text-slate-100">{fmt(row.effectiveBuffer)}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 dark:text-slate-500">ควรส่ง</p>
                          <p className="font-medium text-slate-900 dark:text-slate-100">{fmt(row.targetStock)}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 dark:text-slate-500">ส่งล่าสุด</p>
                          <p className="font-medium text-slate-900 dark:text-slate-100">{fmt(row.lastPushedStock)}</p>
                        </div>
                        {row.lastPushedAt ? (
                          <p className="col-span-4 text-slate-400 dark:text-slate-500">
                            {formatDateTimeThai(row.lastPushedAt, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </p>
                        ) : null}
                      </div>
                      <MappingSettingsForm
                        mappingId={row.mappingId}
                        syncMode={row.syncMode}
                        stockBuffer={row.effectiveBuffer === shop.stockBuffer ? null : row.effectiveBuffer}
                        canManage={canManage}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {recentJobs.length > 0 ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0d1728]">
              <h2 className="font-kanit text-base font-semibold text-slate-900 dark:text-slate-100">ประวัติตรวจล่าสุด</h2>
              <div className="mt-3 space-y-2">
                {recentJobs.map((job) => (
                  <div key={job.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-white/10 dark:bg-white/5">
                    <p className="font-medium text-slate-800 dark:text-slate-100">
                      {job.status} · ตรวจ {job.itemsProcessed} รายการ · error {job.itemsFailed}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {formatDateTimeThai(job.createdAt, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                    {job.lastError ? <p className="mt-1 text-xs text-rose-600 dark:text-rose-300">{job.lastError}</p> : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
};

export default ShopeeStockPage;
