import { db } from "@/lib/db";
import { Package, TrendingUp, AlertTriangle, ShieldAlert } from "lucide-react";

const AdminDashboard = async () => {
  const [totalProducts, totalSalesToday, lowStockCount, expiringWarranties] = await Promise.all([
    db.product.count({ where: { isActive: true } }),
    db.sale.count({
      where: {
        saleDate: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
        },
      },
    }),
    db.product.count({
      where: {
        isActive: true,
        stock: { lte: db.product.fields.minStock },
      },
    }).catch(() => 0),
    db.warranty.count({
      where: {
        endDate: {
          lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          gte: new Date(),
        },
      },
    }),
  ]);

  const cards = [
    {
      label: "สินค้าทั้งหมด",
      value: totalProducts,
      unit: "รายการ",
      icon: Package,
      color: "bg-blue-50 text-blue-600",
    },
    {
      label: "การขายวันนี้",
      value: totalSalesToday,
      unit: "รายการ",
      icon: TrendingUp,
      color: "bg-green-50 text-green-600",
    },
    {
      label: "สินค้า stock ต่ำ",
      value: lowStockCount,
      unit: "รายการ",
      icon: AlertTriangle,
      color: "bg-orange-50 text-orange-600",
    },
    {
      label: "ประกันกำลังหมด",
      value: expiringWarranties,
      unit: "รายการ (30 วัน)",
      icon: ShieldAlert,
      color: "bg-red-50 text-red-600",
    },
  ];

  return (
    <div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map((card) => (
          <div key={card.label} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-500">{card.label}</p>
              <div className={`p-2 rounded-lg ${card.color}`}>
                <card.icon size={20} />
              </div>
            </div>
            <p className="font-kanit text-3xl font-bold text-gray-900">{card.value.toLocaleString()}</p>
            <p className="text-xs text-gray-400 mt-1">{card.unit}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AdminDashboard;
