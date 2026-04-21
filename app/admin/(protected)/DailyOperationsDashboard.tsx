import { TrendingUp, AlertTriangle, Banknote, Users, ShoppingCart, Receipt, Globe } from "lucide-react";

import { db } from "@/lib/db";
import { getBangkokDayKey } from "@/lib/storefront-visitor";
import {
  formatDateThai,
  getThailandDateKey,
  getThailandMonthStartDateKey,
  parseDateOnlyToEndOfDay,
  parseDateOnlyToStartOfDay,
} from "@/lib/th-date";

import AdminDashboardCharts from "./AdminDashboardCharts";
import ExpiryAlerts, { type LotExpiry, type LowStockItem } from "./ExpiryAlerts";
import type { SalesChartDatum } from "./SalesChart";
import type { TopProductsChartDatum } from "./TopProductsChart";

const DailyOperationsDashboard = async () => {
  const now = new Date();
  const bangkokToday = getBangkokDayKey(now);
  const bangkokMonthStart = getThailandMonthStartDateKey(now);
  const bangkokStartOfToday = parseDateOnlyToStartOfDay(bangkokToday);
  const bangkokEndOfToday = parseDateOnlyToEndOfDay(bangkokToday);
  const bangkokStartOfMonth = parseDateOnlyToStartOfDay(bangkokMonthStart);
  const bangkokStartOf30Days = new Date(bangkokStartOfToday);
  bangkokStartOf30Days.setUTCDate(bangkokStartOf30Days.getUTCDate() - 29);
  const expiryEndDate = new Date(bangkokEndOfToday);
  expiryEndDate.setUTCDate(expiryEndDate.getUTCDate() + 90);

  const [
    salesTodayAgg,
    lowStockCount,
    salesMonthAgg,
    purchasesMonthAgg,
    arNormal,
    arCOD,
    expensesMonthAgg,
    apOutstandingAgg,
    supplierAdvanceOutstandingAgg,
    purchaseReturnCreditOutstandingAgg,
    storefrontVisitorsToday,
    storefrontVisitorsMonth,
    storefrontVisitorsTotal,
    recentSales,
    monthSaleItems,
    lowStockProducts,
    expiringLots,
    lotBalances,
  ] = await Promise.all([
    db.sale.aggregate({
      _count: { id: true },
      _sum: { netAmount: true },
      where: {
        status: "ACTIVE",
        saleDate: { gte: bangkokStartOfToday, lte: bangkokEndOfToday },
      },
    }),
    db.product.count({
      where: { isActive: true, stock: { lte: db.product.fields.minStock } },
    }).catch(() => 0),
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
        shippingStatus: { not: "DELIVERED" },
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
    db.storefrontVisitDaily.groupBy({
      by: ["visitorKey"],
      where: { visitDay: { gte: bangkokMonthStart, lte: bangkokToday } },
    }).then((rows) => rows.length),
    db.storefrontVisitDaily.groupBy({
      by: ["visitorKey"],
    }).then((rows) => rows.length),
    db.sale.findMany({
      where: {
        status: "ACTIVE",
        saleDate: { gte: bangkokStartOf30Days, lte: bangkokEndOfToday },
      },
      select: { saleDate: true, netAmount: true },
      orderBy: { saleDate: "asc" },
    }),
    db.saleItem.findMany({
      where: {
        sale: {
          status: "ACTIVE",
          saleDate: { gte: bangkokStartOfMonth, lte: bangkokEndOfToday },
        },
      },
      select: {
        quantity: true,
        totalAmount: true,
        productId: true,
        product: { select: { name: true } },
      },
    }),
    db.product.findMany({
      where: {
        isActive: true,
        stock: { lte: db.product.fields.minStock },
      },
      select: {
        name: true,
        stock: true,
        minStock: true,
        reportUnitName: true,
      },
      orderBy: [{ stock: "asc" }, { minStock: "asc" }, { name: "asc" }],
      take: 5,
    }),
    db.productLot.findMany({
      where: {
        expDate: {
          gte: bangkokStartOfToday,
          lte: expiryEndDate,
        },
      },
      select: {
        productId: true,
        lotNo: true,
        expDate: true,
        product: {
          select: {
            name: true,
            reportUnitName: true,
          },
        },
      },
      orderBy: [{ expDate: "asc" }, { lotNo: "asc" }],
      take: 30,
    }),
    db.lotBalance.findMany({
      select: {
        productId: true,
        lotNo: true,
        qtyOnHand: true,
      },
    }),
  ]);

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
    const day = new Date(bangkokStartOf30Days);
    day.setUTCDate(bangkokStartOf30Days.getUTCDate() + index);
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

  const topProductsMap = new Map<string, TopProductsChartDatum>();
  for (const item of monthSaleItems) {
    const existing = topProductsMap.get(item.productId) ?? {
      name: item.product.name,
      qty: 0,
      revenue: 0,
    };
    existing.qty += Number(item.quantity);
    existing.revenue += Number(item.totalAmount);
    topProductsMap.set(item.productId, existing);
  }

  const topProductsData = Array.from(topProductsMap.values())
    .sort((left, right) => right.revenue - left.revenue || right.qty - left.qty || left.name.localeCompare(right.name))
    .slice(0, 10);

  const lowStockItems: LowStockItem[] = lowStockProducts.map((product) => ({
    name: product.name,
    stock: product.stock,
    minStock: product.minStock,
    unit: product.reportUnitName,
  }));

  const lotBalanceMap = new Map(
    lotBalances.map((lot) => [`${lot.productId}::${lot.lotNo}`, Number(lot.qtyOnHand)]),
  );
  const millisecondsPerDay = 1000 * 60 * 60 * 24;
  const expiryItems: LotExpiry[] = expiringLots
    .map((lot) => {
      const qtyOnHand = lotBalanceMap.get(`${lot.productId}::${lot.lotNo}`) ?? 0;
      if (!lot.expDate || qtyOnHand <= 0) return null;

      return {
        productName: lot.product.name,
        lotNo: lot.lotNo,
        expDate: formatDateThai(lot.expDate),
        daysLeft: Math.max(
          0,
          Math.ceil((lot.expDate.getTime() - bangkokStartOfToday.getTime()) / millisecondsPerDay),
        ),
        qty: qtyOnHand,
        unit: lot.product.reportUnitName,
      };
    })
    .filter((item): item is LotExpiry => item !== null)
    .sort((left, right) => left.daysLeft - right.daysLeft || left.productName.localeCompare(right.productName))
    .slice(0, 5);

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
    {
      label: "สินค้าใกล้ขั้นต่ำ",
      value: lowStockCount.toLocaleString(),
      helper: "รายการที่ต้องติดตาม",
      icon: AlertTriangle,
      color: "bg-orange-50 text-orange-600",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="max-w-3xl space-y-1">
        <h1 className="font-kanit text-2xl font-bold text-gray-900">Daily Operations</h1>
        <p className="text-sm text-gray-500">
          สรุปภาพการขาย เงินสด ลูกหนี้ เจ้าหนี้ และสถานะสต็อกที่เจ้าของต้องติดตามทุกวัน
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border border-gray-100 bg-white/95 p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/80"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-500">{card.label}</p>
                <p className="font-kanit text-xl font-semibold text-gray-900">{card.value}</p>
              </div>
              <div className={`rounded-xl border border-black/5 p-2 shadow-sm dark:border-white/10 ${card.color}`}>
                <card.icon size={18} />
              </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-400">{card.helper}</p>
          </div>
        ))}
      </div>

      <AdminDashboardCharts salesData={salesChartData} topProductsData={topProductsData} />

      <ExpiryAlerts lowStockItems={lowStockItems} expiryItems={expiryItems} />
    </div>
  );
};

export default DailyOperationsDashboard;
