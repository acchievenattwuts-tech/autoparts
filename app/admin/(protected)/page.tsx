export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { db } from "@/lib/db";
import {
  Package, TrendingUp, AlertTriangle, ShieldAlert,
  Banknote, Users, ShoppingCart, Receipt,
} from "lucide-react";
import SalesChart from "./SalesChart";
import TopProductsChart from "./TopProductsChart";
import ExpiryAlerts from "./ExpiryAlerts";

const AdminDashboard = async () => {
  const now = new Date();
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [
    totalProducts,
    salesTodayAgg,
    lowStockCount,
    expiringWarranties,
    salesMonthAgg,
    purchasesMonthAgg,
    totalAR,
    expensesMonthAgg,
  ] = await Promise.all([
    db.product.count({ where: { isActive: true } }),
    db.sale.aggregate({
      _count: { id: true },
      _sum: { netAmount: true },
      where: { status: "ACTIVE", saleDate: { gte: startOfToday } },
    }),
    db.product.count({
      where: { isActive: true, stock: { gt: 0, lte: db.product.fields.minStock } },
    }).catch(() => 0),
    db.warranty.count({
      where: { endDate: { gte: now, lte: in30Days } },
    }),
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
      where: { status: "ACTIVE", paymentType: "CREDIT_SALE" },
    }),
    db.expense.aggregate({
      _sum: { netAmount: true },
      where: { status: "ACTIVE", expenseDate: { gte: startOfMonth } },
    }),
  ]);

  const fmt = (v: unknown) =>
    Number(v ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2 });

  const cards = [
    {
      label: "สินค้าทั้งหมด",
      value: totalProducts.toLocaleString(),
      unit: "รายการ",
      icon: Package,
      color: "bg-blue-50 text-blue-600",
    },
    {
      label: "บิลขายวันนี้",
      value: (salesTodayAgg._count.id).toLocaleString(),
      unit: `บิล · ฿${fmt(salesTodayAgg._sum.netAmount)}`,
      icon: TrendingUp,
      color: "bg-green-50 text-green-600",
    },
    {
      label: "ยอดขายเดือนนี้",
      value: `฿${fmt(salesMonthAgg._sum.netAmount)}`,
      unit: "บาท",
      icon: Banknote,
      color: "bg-emerald-50 text-emerald-600",
    },
    {
      label: "ยอดซื้อเดือนนี้",
      value: `฿${fmt(purchasesMonthAgg._sum.netAmount)}`,
      unit: "บาท",
      icon: ShoppingCart,
      color: "bg-indigo-50 text-indigo-600",
    },
    {
      label: "ลูกหนี้ค้างชำระ",
      value: `฿${fmt(totalAR._sum.amountRemain)}`,
      unit: "บาท",
      icon: Users,
      color: "bg-yellow-50 text-yellow-600",
    },
    {
      label: "ค่าใช้จ่ายเดือนนี้",
      value: `฿${fmt(expensesMonthAgg._sum.netAmount)}`,
      unit: "บาท",
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
    {
      label: "ประกันกำลังหมด",
      value: expiringWarranties.toLocaleString(),
      unit: "รายการ (30 วัน)",
      icon: ShieldAlert,
      color: "bg-red-50 text-red-600",
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="font-kanit text-2xl font-bold text-gray-900">Dashboard</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {cards.map((card) => (
          <div key={card.label} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-500 leading-tight">{card.label}</p>
              <div className={`p-1.5 rounded-lg ${card.color}`}>
                <card.icon size={16} />
              </div>
            </div>
            <p className="font-kanit text-xl font-bold text-gray-900 truncate">{card.value}</p>
            <p className="text-xs text-gray-400 mt-0.5 truncate">{card.unit}</p>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <Suspense fallback={<div className="h-72 bg-white rounded-xl animate-pulse" />}>
            <SalesChart />
          </Suspense>
        </div>
        <div>
          <Suspense fallback={<div className="h-72 bg-white rounded-xl animate-pulse" />}>
            <TopProductsChart />
          </Suspense>
        </div>
      </div>

      {/* Alerts */}
      <ExpiryAlerts />
    </div>
  );
};

export default AdminDashboard;
