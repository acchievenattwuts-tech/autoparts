export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { getBangkokDayKey } from "@/lib/storefront-visitor";
import { requirePermission } from "@/lib/require-auth";
import { formatDateThai, getThailandDateKey } from "@/lib/th-date";
import {
  TrendingUp, AlertTriangle,
  Banknote, Users, ShoppingCart, Receipt, Globe,
} from "lucide-react";

import AdminDashboardCharts from "./AdminDashboardCharts";
import ExpiryAlerts, { type LotExpiry, type LowStockItem } from "./ExpiryAlerts";
import type { SalesChartDatum } from "./SalesChart";
import type { TopProductsChartDatum } from "./TopProductsChart";

const AdminDashboard = async () => {
  await requirePermission("dashboard.view");

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOf30Days = new Date(startOfToday);
  startOf30Days.setDate(startOf30Days.getDate() - 29);
  const expiryEndDate = new Date(startOfToday);
  expiryEndDate.setDate(expiryEndDate.getDate() + 90);

  const bangkokToday = getBangkokDayKey(now);
  const bangkokMonthStart = `${bangkokToday.slice(0, 8)}01`;

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
      where: { status: "ACTIVE", saleDate: { gte: startOfToday } },
    }),
    db.product.count({
      where: { isActive: true, stock: { lte: db.product.fields.minStock } },
    }).catch(() => 0),
    db.sale.aggregate({
      _sum: { netAmount: true },
      where: { status: "ACTIVE", saleDate: { gte: startOfMonth } },
    }),
    db.purchase.aggregate({
      _sum: { netAmount: true },
      where: { status: "ACTIVE", purchaseDate: { gte: startOfMonth } },
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
      where: { status: "ACTIVE", expenseDate: { gte: startOfMonth } },
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
      where: { status: "ACTIVE", saleDate: { gte: startOf30Days } },
      select: { saleDate: true, netAmount: true },
      orderBy: { saleDate: "asc" },
    }),
    db.saleItem.findMany({
      where: {
        sale: {
          status: "ACTIVE",
          saleDate: { gte: startOfMonth },
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
          gte: startOfToday,
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

  const fmt = (v: unknown) =>
    Number(v ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2 });

  const fmtDate = (d: Date) =>
    formatDateThai(d, { day: "2-digit", month: "short", year: "numeric" });

  const todayLabel = fmtDate(now);
  const monthLabel = `${fmtDate(startOfMonth)} – ${todayLabel}`;

  const salesByDay = new Map<string, number>();
  for (let i = 0; i < 30; i += 1) {
    const day = new Date(startOf30Days);
    day.setDate(startOf30Days.getDate() + i);
    const key = getThailandDateKey(day);
    salesByDay.set(key, 0);
  }
  for (const sale of recentSales) {
    const day = new Date(sale.saleDate);
    day.setHours(0, 0, 0, 0);
    const key = getThailandDateKey(day);
    salesByDay.set(key, (salesByDay.get(key) ?? 0) + Number(sale.netAmount));
  }
  const salesChartData: SalesChartDatum[] = Array.from(salesByDay.entries()).map(([key, amount]) => {
    const day = new Date(key);
    return {
      date: formatDateThai(day, { day: "2-digit", month: "2-digit" }),
      amount,
    };
  });

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
    .sort((a, b) => b.revenue - a.revenue || b.qty - a.qty || a.name.localeCompare(b.name))
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
  const msPerDay = 1000 * 60 * 60 * 24;
  const expiryItems: LotExpiry[] = expiringLots
    .map((lot) => {
      const qtyOnHand = lotBalanceMap.get(`${lot.productId}::${lot.lotNo}`) ?? 0;
      if (!lot.expDate || qtyOnHand <= 0) return null;
      const daysLeft = Math.max(0, Math.ceil((lot.expDate.getTime() - startOfToday.getTime()) / msPerDay));
      return {
        productName: lot.product.name,
        lotNo: lot.lotNo,
        expDate: formatDateThai(lot.expDate),
        daysLeft,
        qty: qtyOnHand,
        unit: lot.product.reportUnitName,
      };
    })
    .filter((item): item is LotExpiry => item !== null)
    .sort((a, b) => a.daysLeft - b.daysLeft || a.productName.localeCompare(b.productName))
    .slice(0, 5);

  const cards = [
    {
      label: "ผู้เข้าชมหน้าบ้านวันนี้",
      value: storefrontVisitorsToday.toLocaleString(),
      unit: `เดือนนี้ ${storefrontVisitorsMonth.toLocaleString()} | สะสม ${storefrontVisitorsTotal.toLocaleString()}`,
      icon: Globe,
      color: "bg-cyan-50 text-cyan-600",
    },
    {
      label: "บิลขายวันนี้",
      value: salesTodayAgg._count.id.toLocaleString(),
      unit: `บิล · ฿${fmt(salesTodayAgg._sum.netAmount)} | ${todayLabel}`,
      icon: TrendingUp,
      color: "bg-green-50 text-green-600",
    },
    {
      label: "ยอดขายเดือนนี้",
      value: `฿${fmt(salesMonthAgg._sum.netAmount)}`,
      unit: monthLabel,
      icon: Banknote,
      color: "bg-emerald-50 text-emerald-600",
    },
    {
      label: "ยอดซื้อเดือนนี้",
      value: `฿${fmt(purchasesMonthAgg._sum.netAmount)}`,
      unit: monthLabel,
      icon: ShoppingCart,
      color: "bg-indigo-50 text-indigo-600",
    },
    {
      label: "ลูกหนี้ค้างชำระ",
      value: `฿${fmt(arNormal._sum.amountRemain)}`,
      unit: `ณ ${todayLabel}`,
      icon: Users,
      color: "bg-yellow-50 text-yellow-600",
    },
    {
      label: "COD รอรับเงิน",
      value: `฿${fmt(arCOD._sum.amountRemain)}`,
      unit: `ณ ${todayLabel}`,
      icon: Receipt,
      color: "bg-orange-50 text-orange-600",
    },
    {
      label: "A/P Outstanding",
      value: `฿${fmt(apOutstandingAgg._sum.amountRemain)}`,
      unit: `ณ ${todayLabel}`,
      icon: ShoppingCart,
      color: "bg-rose-50 text-rose-600",
    },
    {
      label: "Supplier Advance",
      value: `฿${fmt(supplierAdvanceOutstandingAgg._sum.amountRemain)}`,
      unit: `คงเหลือ ณ ${todayLabel}`,
      icon: Banknote,
      color: "bg-emerald-50 text-emerald-600",
    },
    {
      label: "CN Credit Outstanding",
      value: `฿${fmt(purchaseReturnCreditOutstandingAgg._sum.amountRemain)}`,
      unit: `ณ ${todayLabel}`,
      icon: Receipt,
      color: "bg-amber-50 text-amber-600",
    },
    {
      label: "ค่าใช้จ่ายเดือนนี้",
      value: `฿${fmt(expensesMonthAgg._sum.netAmount)}`,
      unit: monthLabel,
      icon: Receipt,
      color: "bg-purple-50 text-purple-600",
    },
    {
      label: "สต็อกต่ำกว่ากำหนด",
      value: lowStockCount.toLocaleString(),
      unit: "รายการ",
      icon: AlertTriangle,
      color: "bg-orange-50 text-orange-600",
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="font-kanit text-2xl font-bold text-gray-900">Dashboard</h1>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs leading-tight text-gray-500">{card.label}</p>
              <div className={`rounded-lg p-1.5 ${card.color}`}>
                <card.icon size={16} />
              </div>
            </div>
            <p className="truncate font-kanit text-xl font-bold text-gray-900">{card.value}</p>
            <p className="mt-0.5 truncate text-xs text-gray-400">{card.unit}</p>
          </div>
        ))}
      </div>

      <AdminDashboardCharts salesData={salesChartData} topProductsData={topProductsData} />

      <ExpiryAlerts lowStockItems={lowStockItems} expiryItems={expiryItems} />
    </div>
  );
};

export default AdminDashboard;
