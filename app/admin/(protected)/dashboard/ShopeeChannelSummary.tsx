import { ChevronRight, ShoppingBag, Store, TrendingUp } from "lucide-react";
import Link from "next/link";

import { hasPermissionAccess } from "@/lib/access-control";

import { getMarketplaceChannelConfig, type ManualMarketplaceChannel } from "@/lib/marketplace/config";
import { getMarketplaceChannelSetting, getPendingSettlementDocuments } from "@/lib/marketplace/queries";
import { getSessionPermissionContext } from "@/lib/require-auth";
import {
  computeChannelNetFigures,
  getShopeeReportingSummary,
} from "@/lib/shopee/services/reporting";
import { getThailandDateKey, parseDateOnlyToStartOfDay } from "@/lib/th-date";

/**
 * Additive dashboard widget: month-to-date sales split by channel
 * (หน้าร้าน / Shopee / Lazada). Self-contained server component — does not touch the
 * existing daily/profit dashboards.
 */
const fmt = (value: number) =>
  value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type PendingSettlement =
  | { status: "ok"; count: number; amount: number }
  | { status: "unconfigured" }
  | { status: "error" };

/**
 * บิลที่ยังไม่ถูกกระทบยอด (ค้างทั้งหมด ไม่จำกัดเดือน) — ใช้ query เดียวกับหน้ากระทบยอด
 * รับเงิน เพื่อให้ตัวเลขตรงกัน ถ้าโหลดไม่สำเร็จให้การ์ดยอดขายยังแสดงได้ตามปกติ
 */
const getPendingSettlement = async (channel: ManualMarketplaceChannel): Promise<PendingSettlement> => {
  try {
    const setting = await getMarketplaceChannelSetting(channel);
    if (!setting) return { status: "unconfigured" };
    const { sales } = await getPendingSettlementDocuments(channel, setting.settlementCashBankAccountId);
    return {
      status: "ok",
      count: sales.length,
      amount: sales.reduce((sum, sale) => sum + sale.amount, 0),
    };
  } catch (error) {
    console.error("[dashboard] pending settlement load failed", { channel, error });
    return { status: "error" };
  }
};

type PendingSettlementLineProps = {
  pending: PendingSettlement;
  /** ลิงก์ไปหน้ากระทบยอด — ส่งมาเฉพาะเมื่อผู้ใช้มีสิทธิ์เปิดหน้านั้น */
  href: string | null;
};

const PendingSettlementLine = ({ pending, href }: PendingSettlementLineProps) => (
  <div className="mt-1 flex items-center justify-between text-xs">
    <span className="opacity-80">รอกระทบยอด (ค้างทั้งหมด)</span>
    {pending.status === "ok" ? (
      href ? (
        <Link
          href={href}
          className="inline-flex items-center gap-0.5 font-semibold tabular-nums underline-offset-2 hover:underline"
        >
          {pending.count} บิล · {fmt(pending.amount)}
          <ChevronRight size={14} aria-hidden />
        </Link>
      ) : (
        <span className="font-semibold tabular-nums">
          {pending.count} บิล · {fmt(pending.amount)}
        </span>
      )
    ) : (
      <span className="opacity-80">
        {pending.status === "unconfigured" ? "ยังไม่ตั้งค่าช่องทาง" : "โหลดข้อมูลไม่สำเร็จ"}
      </span>
    )}
  </div>
);

/** แสดงยอดที่ถูกหักเป็นค่าติดลบ โดยไม่ให้ศูนย์กลายเป็น "-0.00" */
const fmtDeduction = (value: number) => fmt(value === 0 ? 0 : -value);

type ReturnLineProps = {
  returnGrossProfit: number;
  returnAmount: number;
};

/** คืนสินค้า/ลดหนี้ตามวันที่ใบลดหนี้: กำไรที่ลดลง พร้อมยอดขายที่คืน */
const ReturnLine = ({ returnGrossProfit, returnAmount }: ReturnLineProps) => (
  <div className="mt-1 text-xs">
    <div className="flex items-center justify-between">
      <span className="opacity-80">คืนสินค้า/ลดหนี้</span>
      <span className="font-semibold tabular-nums">{fmtDeduction(returnGrossProfit)}</span>
    </div>
    <p className="opacity-70">(ยอดขายที่คืน {fmt(returnAmount)})</p>
  </div>
);

type MarketplaceFeeLinesProps = {
  netFee: number;
  profitAfterFee: number;
};

/** ค่าธรรมเนียมสุทธิ (ค่าธรรมเนียม − รายรับพิเศษ) ที่กระทบยอดแล้ว และกำไรหลังหัก */
const MarketplaceFeeLines = ({ netFee, profitAfterFee }: MarketplaceFeeLinesProps) => (
  <>
    <div className="mt-1 flex items-center justify-between text-xs">
      <span className="opacity-80">ค่าธรรมเนียม (เฉพาะบิลที่กระทบยอดแล้ว)</span>
      <span className="font-semibold tabular-nums">{fmtDeduction(netFee)}</span>
    </div>
    <div className="mt-1 flex items-center justify-between text-sm">
      <span className="font-medium">กำไรหลังหักค่าธรรมเนียม</span>
      <span className="font-bold tabular-nums">{fmt(profitAfterFee)}</span>
    </div>
  </>
);

const ShopeeChannelSummary = async () => {
  const [year, month] = getThailandDateKey().split("-");
  const monthStart = parseDateOnlyToStartOfDay(`${year}-${month}-01`);

  const [summary, shopeePending, lazadaPending, { role, permissions }] = await Promise.all([
    getShopeeReportingSummary({ from: monthStart, to: new Date() }),
    getPendingSettlement("SHOPEE"),
    getPendingSettlement("LAZADA"),
    getSessionPermissionContext(),
  ]);

  // หน้ากระทบยอดอยู่ใต้ /admin/sales (route guard: sales.view) และหน้าเองเช็ก
  // marketplace.manage — แสดงลิงก์เฉพาะคนที่ผ่านทั้งสองชั้น
  const canOpenSettlements =
    hasPermissionAccess(role, permissions, "sales.view") &&
    hasPermissionAccess(role, permissions, "marketplace.manage");
  const settlementHref = (channel: ManualMarketplaceChannel): string | null =>
    canOpenSettlements ? `/admin/sales/${getMarketplaceChannelConfig(channel).slug}/settlements` : null;

  const cards = [
    {
      key: "store",
      hasMarketplaceFee: false,
      label: "หน้าร้าน",
      icon: TrendingUp,
      metric: summary.store,
      pending: null,
      pendingHref: null,
      className: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-200",
    },
    {
      key: "shopee",
      hasMarketplaceFee: true,
      label: "Shopee",
      icon: Store,
      metric: summary.shopee,
      pending: shopeePending,
      pendingHref: settlementHref("SHOPEE"),
      className: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-200",
    },
    {
      key: "lazada",
      hasMarketplaceFee: true,
      label: "Lazada",
      icon: ShoppingBag,
      metric: summary.lazada,
      pending: lazadaPending,
      pendingHref: settlementHref("LAZADA"),
      className: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/30 dark:bg-violet-400/10 dark:text-violet-200",
    },
  ];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-[#0d1728]">
      <h2 className="font-kanit text-sm font-semibold text-slate-900 dark:text-slate-100">ยอดขายแยกช่องทาง (เดือนนี้)</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => {
          const { metric } = card;
          const figures = computeChannelNetFigures(metric);
          return (
            <div key={card.key} className={`rounded-xl border px-4 py-3 ${card.className}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <card.icon size={20} />
                  <div>
                    <p className="text-sm font-medium">{card.label}</p>
                    <p className="text-xs opacity-80">{metric.orderCount} ออเดอร์</p>
                  </div>
                </div>
                <p className="text-lg font-bold tabular-nums">{fmt(metric.salesAmount)}</p>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-current/15 pt-2 text-xs">
                <span className="opacity-80">Gross profit</span>
                <span className="font-semibold tabular-nums">{fmt(metric.grossProfit)}</span>
              </div>
              {figures.hasReturn ? (
                <ReturnLine returnGrossProfit={metric.returnGrossProfit} returnAmount={metric.returnAmount} />
              ) : null}
              {card.hasMarketplaceFee ? (
                <MarketplaceFeeLines netFee={figures.netMarketplaceFee} profitAfterFee={figures.profitAfterFee} />
              ) : figures.hasReturn ? (
                <div className="mt-1 flex items-center justify-between text-sm">
                  <span className="font-medium">กำไรหลังหักคืนสินค้า</span>
                  <span className="font-bold tabular-nums">{fmt(figures.profitAfterReturn)}</span>
                </div>
              ) : null}
              {card.pending ? <PendingSettlementLine pending={card.pending} href={card.pendingHref} /> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default ShopeeChannelSummary;
