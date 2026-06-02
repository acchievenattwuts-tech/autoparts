export const dynamic = "force-dynamic";

import Link from "next/link";
import { AlertTriangle, Boxes, CheckCircle2, Inbox, Package, Plug, Store, XCircle } from "lucide-react";

import { ensureAccessControlSetup, hasPermissionAccess } from "@/lib/access-control";
import { db } from "@/lib/db";
import { ShopeeAuthStatus } from "@/lib/generated/prisma";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { isShopeeConfigured } from "@/lib/shopee/config";
import { formatDateTimeThai } from "@/lib/th-date";

import { disconnectShopeeShop, startShopeeAuthorization } from "./actions";
import SettlementAccountForm from "./SettlementAccountForm";

type ShopeePageProps = {
  searchParams: Promise<{ connected?: string; error?: string; shop?: string }>;
};

const ERROR_MESSAGES: Record<string, string> = {
  not_configured: "ยังไม่ได้ตั้งค่า Shopee credentials — โปรดดูขั้นตอนใน docs/shopee/USER-TASKS.md",
  forbidden: "คุณไม่มีสิทธิ์จัดการการเชื่อมต่อ Shopee",
  missing_params: "Shopee ส่งข้อมูลกลับไม่ครบ (ไม่มี code หรือ shop_id)",
  not_found: "ไม่พบร้านที่ต้องการ",
  invalid: "คำขอไม่ถูกต้อง",
  callback: "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
};

const STATUS_META: Record<
  ShopeeAuthStatus,
  { label: string; className: string }
> = {
  AUTHORIZED: {
    label: "เชื่อมต่อแล้ว",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200",
  },
  PENDING: {
    label: "รอเชื่อมต่อ",
    className: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200",
  },
  EXPIRED: {
    label: "Token หมดอายุ",
    className: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200",
  },
  REVOKED: {
    label: "ยกเลิกแล้ว",
    className: "border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300",
  },
};

const ShopeeOverviewPage = async ({ searchParams }: ShopeePageProps) => {
  await ensureAccessControlSetup();
  await requirePermission("marketplace.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canManage = hasPermissionAccess(role, permissions, "marketplace.manage");
  const configured = isShopeeConfigured();
  const params = await searchParams;

  const shops = await db.shopeeShop.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      shopId: true,
      shopName: true,
      authStatus: true,
      tokenExpiresAt: true,
      syncEnabled: true,
      lastError: true,
      authorizedAt: true,
      settlementCashBankAccountId: true,
    },
  });

  const cashBankAccounts = canManage
    ? await db.cashBankAccount.findMany({
        where: { isActive: true },
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true },
      })
    : [];

  const errorMessage = params.error ? ERROR_MESSAGES[params.error] ?? "เกิดข้อผิดพลาด" : null;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-orange-200 bg-orange-50 text-orange-600 dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-300">
          <Store size={22} />
        </span>
        <div>
          <h1 className="font-kanit text-xl font-bold text-slate-900 dark:text-slate-100">
            Shopee / Marketplace
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            เชื่อมต่อร้าน Shopee เพื่อ sync ออเดอร์และสต็อก — แยกจากระบบหน้าร้านเดิม
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/admin/marketplace/shopee/products"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-white/10 dark:bg-[#0d1728] dark:text-slate-200 dark:hover:bg-white/10"
        >
          <Package size={16} />
          จับคู่สินค้า Shopee
        </Link>
        <Link
          href="/admin/marketplace/shopee/orders"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-white/10 dark:bg-[#0d1728] dark:text-slate-200 dark:hover:bg-white/10"
        >
          <Inbox size={16} />
          คิวออเดอร์ Shopee
        </Link>
        <Link
          href="/admin/marketplace/shopee/stock"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-white/10 dark:bg-[#0d1728] dark:text-slate-200 dark:hover:bg-white/10"
        >
          <Boxes size={16} />
          Shopee Stock Sync
        </Link>
      </div>

      {params.connected ? (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-100">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
          <p>เชื่อมต่อร้าน Shopee {params.shop ? `(${params.shop})` : ""} สำเร็จแล้ว</p>
        </div>
      ) : null}

      {errorMessage ? (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-100">
          <XCircle size={18} className="mt-0.5 shrink-0" />
          <p>{errorMessage}</p>
        </div>
      ) : null}

      {!configured ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" />
          <div>
            <p className="font-medium">ยังไม่ได้ตั้งค่า Shopee credentials</p>
            <p className="mt-1 text-amber-800 dark:text-amber-200/90">
              ต้องตั้ง <code className="rounded bg-amber-100 px-1 dark:bg-amber-400/20">SHOPEE_PARTNER_ID</code>,{" "}
              <code className="rounded bg-amber-100 px-1 dark:bg-amber-400/20">SHOPEE_PARTNER_KEY</code> และ{" "}
              <code className="rounded bg-amber-100 px-1 dark:bg-amber-400/20">SHOPEE_REDIRECT_URL</code> ใน{" "}
              <code className="rounded bg-amber-100 px-1 dark:bg-amber-400/20">.env.local</code> ก่อน
              (ดู docs/shopee/USER-TASKS.md)
            </p>
          </div>
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0d1728]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-kanit text-base font-semibold text-slate-900 dark:text-slate-100">
            ร้านที่เชื่อมต่อ
          </h2>
          {canManage ? (
            <form action={startShopeeAuthorization}>
              <button
                type="submit"
                disabled={!configured}
                className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-orange-500 dark:hover:bg-orange-400"
              >
                <Plug size={16} />
                เชื่อมต่อร้าน Shopee
              </button>
            </form>
          ) : null}
        </div>

        <div className="mt-4 space-y-3">
          {shops.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
              ยังไม่มีร้าน Shopee ที่เชื่อมต่อ
            </div>
          ) : (
            shops.map((shop) => {
              const meta = STATUS_META[shop.authStatus];
              return (
                <div
                  key={shop.id}
                  className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 dark:border-white/10 dark:bg-white/5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-slate-900 dark:text-slate-100">
                        {shop.shopName ?? `Shop ${shop.shopId}`}
                      </p>
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.className}`}>
                        {meta.label}
                      </span>
                      {shop.syncEnabled ? (
                        <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-200">
                          sync เปิด
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      shop_id: {shop.shopId}
                      {shop.tokenExpiresAt
                        ? ` · token หมดอายุ ${formatDateTimeThai(shop.tokenExpiresAt, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`
                        : ""}
                    </p>
                    {shop.lastError ? (
                      <p className="mt-1 text-xs text-rose-600 dark:text-rose-300">{shop.lastError}</p>
                    ) : null}
                  </div>
                  {canManage && shop.authStatus !== ShopeeAuthStatus.REVOKED ? (
                    <form action={disconnectShopeeShop}>
                      <input type="hidden" name="shopRecordId" value={shop.id} />
                      <button
                        type="submit"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 dark:border-white/10 dark:text-slate-300 dark:hover:border-rose-400/30 dark:hover:bg-rose-400/10 dark:hover:text-rose-200"
                      >
                        ยกเลิกการเชื่อมต่อ
                      </button>
                    </form>
                  ) : null}
                  </div>
                  {canManage && shop.authStatus === ShopeeAuthStatus.AUTHORIZED ? (
                    <div className="border-t border-slate-200 pt-3 dark:border-white/10">
                      <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
                        บัญชี &quot;Shopee พักเงิน&quot; (ใช้ตอนสร้างบิลจากออเดอร์)
                      </label>
                      <SettlementAccountForm
                        shopRecordId={shop.id}
                        currentAccountId={shop.settlementCashBankAccountId}
                        accounts={cashBankAccounts}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </section>

      <p className="text-center text-xs text-slate-400 dark:text-slate-500">
        StockCard ยังเป็น source of truth — Shopee จะไม่เขียนทับสต็อกในระบบโดยตรง
      </p>
    </div>
  );
};

export default ShopeeOverviewPage;
