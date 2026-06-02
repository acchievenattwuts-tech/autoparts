import { Activity, AlertTriangle, Boxes, Clock, RefreshCw } from "lucide-react";

import { db } from "@/lib/db";
import { ShopeeAuthStatus } from "@/lib/generated/prisma";
import { listShopeeStockReconciliation } from "@/lib/shopee/services/stock";
import { formatDateTimeThai } from "@/lib/th-date";

/**
 * Sync Health panel (marketplace overview) — per-shop operational status:
 * token countdown, last order sync, failed sync jobs (24h), stock push risk.
 * Self-contained server component; read-only; does not touch sync logic.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

type Tone = "ok" | "warn" | "danger";

const TONE_CLASS: Record<Tone, string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200",
  warn: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200",
  danger: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200",
};

function tokenCountdown(expiresAt: Date | null): { label: string; tone: Tone } {
  if (!expiresAt) return { label: "ไม่มีข้อมูล token", tone: "warn" };
  const ms = expiresAt.getTime() - Date.now();
  if (ms <= 0) return { label: "token หมดอายุแล้ว", tone: "danger" };
  const hours = Math.floor(ms / HOUR_MS);
  const minutes = Math.floor((ms % HOUR_MS) / 60_000);
  const label = hours > 0 ? `อีก ${hours} ชม. ${minutes} นาที` : `อีก ${minutes} นาที`;
  return { label, tone: ms < HOUR_MS ? "warn" : "ok" };
}

const SyncHealthPanel = async () => {
  const shops = await db.shopeeShop.findMany({
    where: { authStatus: ShopeeAuthStatus.AUTHORIZED },
    orderBy: { createdAt: "desc" },
    select: { id: true, shopId: true, shopName: true, tokenExpiresAt: true, lastOrderSyncAt: true, syncEnabled: true },
  });
  if (shops.length === 0) return null;

  const since = new Date(new Date().getTime() - DAY_MS);
  const cards = await Promise.all(
    shops.map(async (shop) => {
      const [recon, failedJobs] = await Promise.all([
        listShopeeStockReconciliation(shop.id),
        db.shopeeSyncJob.count({
          where: { shopRecordId: shop.id, status: "FAILED", createdAt: { gte: since } },
        }),
      ]);
      return { shop, stock: recon.summary, failedJobs };
    }),
  );

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0d1728]">
      <h2 className="flex items-center gap-2 font-kanit text-base font-semibold text-slate-900 dark:text-slate-100">
        <Activity size={18} /> สุขภาพการ sync
      </h2>
      <div className="mt-3 space-y-3">
        {cards.map(({ shop, stock, failedJobs }) => {
          const token = tokenCountdown(shop.tokenExpiresAt);
          const stockRisk = stock.needsPush + stock.failed;
          return (
            <div key={shop.id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-white/10 dark:bg-white/5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-slate-900 dark:text-slate-100">{shop.shopName ?? `Shop ${shop.shopId}`}</p>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE_CLASS[token.tone]}`}>
                  <Clock size={12} /> {token.label}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-white/10 dark:bg-slate-950">
                  <p className="text-slate-400 dark:text-slate-500">ดึงออเดอร์ล่าสุด</p>
                  <p className="mt-0.5 font-medium text-slate-700 dark:text-slate-200">
                    {shop.lastOrderSyncAt
                      ? formatDateTimeThai(shop.lastOrderSyncAt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
                      : "ยังไม่เคย"}
                  </p>
                </div>
                <div className={`rounded-lg border px-3 py-2 text-xs ${failedJobs > 0 ? TONE_CLASS.danger : "border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-slate-950 dark:text-slate-200"}`}>
                  <p className="flex items-center gap-1 opacity-80"><RefreshCw size={11} /> job ล้มเหลว (24 ชม.)</p>
                  <p className="mt-0.5 font-bold tabular-nums">{failedJobs}</p>
                </div>
                <div className={`rounded-lg border px-3 py-2 text-xs ${stockRisk > 0 ? TONE_CLASS.warn : "border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-slate-950 dark:text-slate-200"}`}>
                  <p className="flex items-center gap-1 opacity-80"><Boxes size={11} /> stock ต้องตรวจ</p>
                  <p className="mt-0.5 font-bold tabular-nums">{stockRisk}</p>
                  <p className="text-[10px] opacity-70">ต้อง push {stock.needsPush} · error {stock.failed}</p>
                </div>
              </div>
              {!shop.syncEnabled ? (
                <p className="mt-2 flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-300">
                  <AlertTriangle size={11} /> auto-pull ปิดอยู่ — ดึงออเดอร์เองเท่านั้น
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default SyncHealthPanel;
