import Link from "next/link";
import { unstable_cache } from "next/cache";
import { TrendingUp, Banknote, Users, ShoppingCart, Receipt, Globe, SearchX } from "lucide-react";

import AdminPageHeader from "@/components/shared/AdminPageHeader";
import { hasPermissionAccess } from "@/lib/access-control";
import { db } from "@/lib/db";
import { getSessionPermissionContext } from "@/lib/require-auth";
import {
  addThailandDays,
  formatDateThai,
  formatDateTimeThai,
  getThailandDateKey,
  getThailandMonthStartDateKey,
  parseDateOnlyToEndOfDay,
  parseDateOnlyToStartOfDay,
} from "@/lib/th-date";

import AdminDashboardCharts from "./AdminDashboardCharts";
import type { SalesChartDatum } from "./SalesChart";
import type { TopProductsChartDatum } from "./TopProductsChart";

// Cache dashboard aggregates for 60 seconds — admins viewing within a minute see cached data,
// reducing DB load drastically. Cache key includes today's date so it auto-invalidates daily.
const DASHBOARD_CACHE_TTL_SECONDS = 60;

const fetchDashboardAggregates = (params: {
  bangkokToday: string;
  bangkokMonthStart: string;
  bangkokStartOfToday: Date;
  bangkokEndOfToday: Date;
  bangkokStartOfMonth: Date;
  bangkokStartOf30Days: Date;
  canViewProductSearchReport: boolean;
}) =>
  unstable_cache(
    async () => {
      const {
        bangkokToday,
        bangkokMonthStart,
        bangkokStartOfToday,
        bangkokEndOfToday,
        bangkokStartOfMonth,
        bangkokStartOf30Days,
        canViewProductSearchReport,
      } = params;
      return Promise.all([
        db.sale.aggregate({
          _count: { id: true },
          _sum: { netAmount: true },
          where: {
            status: "ACTIVE",
            saleDate: { gte: bangkokStartOfToday, lte: bangkokEndOfToday },
          },
        }),
        db.sale.aggregate({
          _sum: { netAmount: true },
          where: {
            status: "ACTIVE",
            saleDate: { gte: bangkokStartOfMonth, lte: bangkokEndOfToday },
          },
        }),
        db.purchase.aggregate({
          _sum: { netAmount: true },
          where: {
            status: "ACTIVE",
            purchaseDate: { gte: bangkokStartOfMonth, lte: bangkokEndOfToday },
          },
        }),
        db.sale.aggregate({
          _sum: { amountRemain: true },
          where: { status: "ACTIVE", paymentType: "CREDIT_SALE", fulfillmentType: "PICKUP" },
        }),
        db.sale.aggregate({
          _sum: { amountRemain: true },
          where: {
            status: "ACTIVE",
            paymentType: "CREDIT_SALE",
            fulfillmentType: "DELIVERY",
            amountRemain: { gt: 0 },
          },
        }),
        db.expense.aggregate({
          _sum: { netAmount: true },
          where: {
            status: "ACTIVE",
            expenseDate: { gte: bangkokStartOfMonth, lte: bangkokEndOfToday },
          },
        }),
        db.purchase.aggregate({
          _sum: { amountRemain: true },
          where: {
            status: "ACTIVE",
            purchaseType: "CREDIT_PURCHASE",
            amountRemain: { gt: 0 },
          },
        }),
        db.supplierAdvance.aggregate({
          _sum: { amountRemain: true },
          where: { status: "ACTIVE", amountRemain: { gt: 0 } },
        }),
        db.purchaseReturn.aggregate({
          _sum: { amountRemain: true },
          where: {
            status: "ACTIVE",
            settlementType: "SUPPLIER_CREDIT",
            amountRemain: { gt: 0 },
          },
        }),
        db.storefrontVisitDaily.count({
          where: { visitDay: bangkokToday },
        }),
        db.storefrontVisitDaily.findMany({
          distinct: ["visitorKey"],
          where: { visitDay: { gte: bangkokMonthStart, lte: bangkokToday } },
          select: { visitorKey: true },
        }),
        db.storefrontVisitDaily.findMany({
          distinct: ["visitorKey"],
          select: { visitorKey: true },
        }),
        canViewProductSearchReport
          ? db.productSearchLog.findMany({
              where: { resultCount: 0 },
              orderBy: { createdAt: "desc" },
              take: 10,
            })
          : Promise.resolve([]),
        db.sale.findMany({
          where: {
            status: "ACTIVE",
            saleDate: { gte: bangkokStartOf30Days, lte: bangkokEndOfToday },
          },
          select: { saleDate: true, netAmount: true },
          orderBy: { saleDate: "asc" },
        }),
        db.saleItem.groupBy({
          by: ["productId"],
          where: {
            sale: {
              status: "ACTIVE",
              saleDate: { gte: bangkokStartOfMonth, lte: bangkokEndOfToday },
            },
          },
          _sum: { quantity: true, totalAmount: true },
          orderBy: [
            { _sum: { quantity: "desc" } },
            { _sum: { totalAmount: "desc" } },
            { productId: "asc" },
          ],
          take: 10,
        }),
      ]);
    },
    [
      "dashboard-aggregates",
      params.bangkokToday,
      params.canViewProductSearchReport ? "with-search" : "no-search",
    ],
    {
      revalidate: DASHBOARD_CACHE_TTL_SECONDS,
      tags: ["dashboard-aggregates"],
    },
  )();

const DailyOperationsDashboard = async () => {
  const { role, permissions } = await getSessionPermissionContext();
  const canViewProductSearchReport = hasPermissionAccess(
    role,
    permissions,
    "product_search_report.view",
  );
  const now = new Date();
  const bangkokToday = getThailandDateKey(now);
  const bangkokMonthStart = getThailandMonthStartDateKey(now);
  const bangkokStartOfToday = parseDateOnlyToStartOfDay(bangkokToday);
  const bangkokEndOfToday = parseDateOnlyToEndOfDay(bangkokToday);
  const bangkokStartOfMonth = parseDateOnlyToStartOfDay(bangkokMonthStart);
  const bangkokStartOf30Days = addThailandDays(bangkokStartOfToday, -29);

  const [
    salesTodayAgg,
    salesMonthAgg,
    purchasesMonthAgg,
    arNormal,
    arCOD,
    expensesMonthAgg,
    apOutstandingAgg,
    supplierAdvanceOutstandingAgg,
    purchaseReturnCreditOutstandingAgg,
    storefrontVisitorsToday,
    storefrontVisitorsMonthRows,
    storefrontVisitorsTotalRows,
    recentNoResultSearches,
    recentSales,
    topProductGroups,
  ] = await fetchDashboardAggregates({
    bangkokToday,
    bangkokMonthStart,
    bangkokStartOfToday,
    bangkokEndOfToday,
    bangkokStartOfMonth,
    bangkokStartOf30Days,
    canViewProductSearchReport,
  });

  const formatMoney = (value: unknown) =>
    Number(value ?? 0).toLocaleString("th-TH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const formatShortDate = (date: Date) =>
    formatDateThai(date, { day: "2-digit", month: "short", year: "numeric" });

  const todayLabel = formatShortDate(bangkokStartOfToday);
  const monthLabel = `${formatShortDate(bangkokStartOfMonth)} - ${todayLabel}`;

  const salesByDay = new Map<string, number>();
  for (let index = 0; index < 30; index += 1) {
    const day = addThailandDays(bangkokStartOf30Days, index);
    salesByDay.set(getThailandDateKey(day), 0);
  }

  for (const sale of recentSales) {
    const key = getThailandDateKey(sale.saleDate);
    salesByDay.set(key, (salesByDay.get(key) ?? 0) + Number(sale.netAmount));
  }

  const salesChartData: SalesChartDatum[] = Array.from(salesByDay.entries()).map(([key, amount]) => ({
    date: formatDateThai(parseDateOnlyToStartOfDay(key), { day: "2-digit", month: "2-digit" }),
    amount,
  }));

  const storefrontVisitorsMonth = storefrontVisitorsMonthRows.length;
  const storefrontVisitorsTotal = storefrontVisitorsTotalRows.length;
  const productNameMap = new Map(
    (
      await db.product.findMany({
        where: { id: { in: topProductGroups.map((item) => item.productId) } },
        select: { id: true, name: true },
      })
    ).map((product) => [product.id, product.name]),
  );

  const topProductsData = topProductGroups
    .map((item): TopProductsChartDatum => ({
      name: productNameMap.get(item.productId) ?? item.productId,
      qty: Number(item._sum.quantity ?? 0),
      revenue: Number(item._sum.totalAmount ?? 0),
    }))
    .sort((left, right) => right.qty - left.qty || right.revenue - left.revenue || left.name.localeCompare(right.name))
    .slice(0, 10);

  const cards = [
    {
      label: "ผู้เข้าชมหน้าร้านวันนี้",
      value: storefrontVisitorsToday.toLocaleString(),
      helper: `เดือนนี้ ${storefrontVisitorsMonth.toLocaleString()} | สะสม ${storefrontVisitorsTotal.toLocaleString()}`,
      icon: Globe,
      color: "bg-cyan-50 text-cyan-600",
    },
    {
      label: "บิลขายวันนี้",
      value: salesTodayAgg._count.id.toLocaleString(),
      helper: `ยอดขาย ${formatMoney(salesTodayAgg._sum.netAmount)} บาท | ${todayLabel}`,
      icon: TrendingUp,
      color: "bg-green-50 text-green-600",
    },
    {
      label: "ยอดขายเดือนนี้",
      value: `${formatMoney(salesMonthAgg._sum.netAmount)} บาท`,
      helper: monthLabel,
      icon: Banknote,
      color: "bg-emerald-50 text-emerald-600",
    },
    {
      label: "ยอดซื้อเดือนนี้",
      value: `${formatMoney(purchasesMonthAgg._sum.netAmount)} บาท`,
      helper: monthLabel,
      icon: ShoppingCart,
      color: "bg-indigo-50 text-indigo-600",
    },
    {
      label: "ลูกหนี้ค้างชำระ",
      value: `${formatMoney(arNormal._sum.amountRemain)} บาท`,
      helper: `ณ ${todayLabel}`,
      icon: Users,
      color: "bg-yellow-50 text-yellow-600",
    },
    {
      label: "COD รอรับเงิน",
      value: `${formatMoney(arCOD._sum.amountRemain)} บาท`,
      helper: `ณ ${todayLabel}`,
      icon: Receipt,
      color: "bg-orange-50 text-orange-600",
    },
    {
      label: "เจ้าหนี้คงค้าง",
      value: `${formatMoney(apOutstandingAgg._sum.amountRemain)} บาท`,
      helper: `ณ ${todayLabel}`,
      icon: ShoppingCart,
      color: "bg-rose-50 text-rose-600",
    },
    {
      label: "มัดจำซัพพลายเออร์",
      value: `${formatMoney(supplierAdvanceOutstandingAgg._sum.amountRemain)} บาท`,
      helper: `คงเหลือ ณ ${todayLabel}`,
      icon: Banknote,
      color: "bg-emerald-50 text-emerald-600",
    },
    {
      label: "เครดิตใบคืนซื้อคงเหลือ",
      value: `${formatMoney(purchaseReturnCreditOutstandingAgg._sum.amountRemain)} บาท`,
      helper: `ณ ${todayLabel}`,
      icon: Receipt,
      color: "bg-amber-50 text-amber-600",
    },
    {
      label: "ค่าใช้จ่ายเดือนนี้",
      value: `${formatMoney(expensesMonthAgg._sum.netAmount)} บาท`,
      helper: monthLabel,
      icon: Receipt,
      color: "bg-purple-50 text-purple-600",
    },
  ];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Dashboard"
        title="Daily Operations"
        description="สรุปภาพการขาย เงินสด ลูกหนี้ เจ้าหนี้ และตัวเลขสำคัญที่เจ้าของต้องติดตามทุกวัน"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border border-gray-100 bg-white/95 p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/80"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-500 dark:text-slate-400">{card.label}</p>
                <p className="font-kanit text-xl font-semibold text-gray-900 dark:text-slate-100">{card.value}</p>
              </div>
              <div className={`rounded-xl border border-black/5 p-2 shadow-sm dark:border-white/10 ${card.color}`}>
                <card.icon size={18} />
              </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-400">{card.helper}</p>
          </div>
        ))}
      </div>

      <AdminDashboardCharts
        leadingContent={
          canViewProductSearchReport ? (
            <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white/95 shadow-sm dark:border-white/10 dark:bg-slate-950/80">
              <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-3 dark:border-white/10 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl border border-rose-100 bg-rose-50 p-2 text-rose-600 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200">
                    <SearchX size={18} />
                  </div>
                  <div>
                    <h2 className="font-kanit text-base font-semibold text-gray-900 dark:text-slate-100">
                      คำค้นหาสินค้าที่ไม่พบผลลัพธ์ล่าสุด
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-slate-400">Top 10 ล่าสุดจากหน้าร้านและหลังบ้าน</p>
                  </div>
                </div>
                <Link
                  href="/admin/reports/product-search-no-result"
                  className="inline-flex items-center justify-center rounded-lg bg-[#1e3a5f] px-3 py-2 text-sm font-medium text-white transition hover:bg-[#163055] dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400"
                >
                  เปิดรายงาน
                </Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 dark:bg-white/5 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">คำค้น</th>
                      <th className="px-4 py-2 text-left font-medium">แหล่งที่มา</th>
                      <th className="px-4 py-2 text-left font-medium">เวลา</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentNoResultSearches.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-4 py-6 text-center text-sm text-gray-400 dark:text-slate-500">
                          ยังไม่มีคำค้นหาที่ไม่พบผลลัพธ์
                        </td>
                      </tr>
                    ) : (
                      recentNoResultSearches.map((item) => (
                        <tr key={item.id} className="border-t border-gray-50 dark:border-white/5">
                          <td className="max-w-[28rem] truncate px-4 py-2 font-medium text-gray-900 dark:text-slate-100">
                            {item.query}
                          </td>
                          <td className="px-4 py-2 text-gray-500 dark:text-slate-400">
                            {item.source === "storefront" ? "หน้าร้าน" : "หลังบ้าน"}
                          </td>
                          <td className="px-4 py-2 text-gray-500 dark:text-slate-400">
                            {formatDateTimeThai(item.createdAt)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null
        }
        salesData={salesChartData}
        topProductsData={topProductsData}
      />
    </div>
  );
};

export default DailyOperationsDashboard;
