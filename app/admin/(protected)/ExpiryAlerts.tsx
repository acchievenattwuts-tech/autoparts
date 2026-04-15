import { AlertTriangle, Clock } from "lucide-react";

export interface LotExpiry {
  productName: string;
  lotNo: string;
  expDate: string;
  daysLeft: number;
  qty: number;
  unit: string;
}

export interface LowStockItem {
  name: string;
  stock: number;
  minStock: number;
  unit: string;
}

const daysBadge = (days: number) => {
  if (days <= 30) return "bg-red-100 text-red-700";
  if (days <= 60) return "bg-orange-100 text-orange-700";
  return "bg-yellow-100 text-yellow-700";
};

const stockBadge = (stock: number) => {
  if (stock === 0) return "bg-red-100 text-red-700";
  return "bg-orange-100 text-orange-700";
};

const ExpiryAlerts = ({
  lowStockItems,
  expiryItems,
}: {
  lowStockItems: LowStockItem[];
  expiryItems: LotExpiry[];
}) => (
  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
    <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-orange-500" />
          <h2 className="font-kanit font-semibold text-gray-800">สต็อกต่ำกว่ากำหนด</h2>
        </div>
      </div>
      {lowStockItems.length > 0 ? (
        <div className="space-y-2">
          {lowStockItems.map((item) => (
            <div key={item.name} className="flex items-center justify-between border-b border-gray-50 py-2 last:border-0">
              <div className="mr-3 min-w-0 flex-1">
                <p className="truncate text-sm text-gray-800">{item.name}</p>
                <p className="text-xs text-gray-400">min: {item.minStock} {item.unit}</p>
              </div>
              <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${stockBadge(item.stock)}`}>
                {item.stock === 0 ? "หมด" : `เหลือ ${item.stock}`}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400">ไม่มีรายการสต็อกต่ำกว่ากำหนด</p>
      )}
    </div>

    <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock size={16} className="text-red-500" />
          <h2 className="font-kanit font-semibold text-gray-800">สินค้าใกล้หมดอายุ (90 วัน)</h2>
        </div>
      </div>
      {expiryItems.length > 0 ? (
        <div className="space-y-2">
          {expiryItems.map((item) => (
            <div key={`${item.productName}-${item.lotNo}`} className="flex items-center justify-between border-b border-gray-50 py-2 last:border-0">
              <div className="mr-3 min-w-0 flex-1">
                <p className="truncate text-sm text-gray-800">{item.productName}</p>
                <p className="text-xs text-gray-400">
                  Lot: {item.lotNo} · {item.qty} {item.unit} · หมด {item.expDate}
                </p>
              </div>
              <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${daysBadge(item.daysLeft)}`}>
                {item.daysLeft} วัน
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400">ไม่มีสินค้าที่ใกล้หมดอายุใน 90 วัน</p>
      )}
    </div>
  </div>
);

export default ExpiryAlerts;
