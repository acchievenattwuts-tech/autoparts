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
  if (days <= 30) return "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-200";
  if (days <= 60) return "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-200";
  return "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-200";
};

const stockBadge = (stock: number) => {
  if (stock === 0) return "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-200";
  return "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-200";
};

const panelClassName =
  "rounded-2xl border border-gray-100 bg-white/95 p-5 shadow-sm dark:border-white/10 dark:bg-slate-950/80";

const itemClassName =
  "flex items-center justify-between gap-3 rounded-xl border border-transparent py-2 last:border-0 dark:border-white/5";

const ExpiryAlerts = ({
  lowStockItems,
  expiryItems,
}: {
  lowStockItems: LowStockItem[];
  expiryItems: LotExpiry[];
}) => (
  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
    <section className={panelClassName}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-orange-50 p-2 text-orange-600 dark:bg-orange-500/15 dark:text-orange-200">
            <AlertTriangle size={16} />
          </div>
          <div>
            <h2 className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">สต็อกต่ำกว่ากำหนด</h2>
            <p className="text-xs text-gray-500 dark:text-slate-400">รายการที่ควรเร่งเติมสต็อกหรือเช็กความต้องการขาย</p>
          </div>
        </div>
        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600 dark:bg-white/10 dark:text-slate-300">
          {lowStockItems.length.toLocaleString("th-TH")} รายการ
        </span>
      </div>
      {lowStockItems.length > 0 ? (
        <div className="space-y-2">
          {lowStockItems.map((item) => (
            <div key={item.name} className={itemClassName}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900 dark:text-slate-100">{item.name}</p>
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  ขั้นต่ำ {item.minStock} {item.unit}
                </p>
              </div>
              <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${stockBadge(item.stock)}`}>
                {item.stock === 0 ? "หมด" : `เหลือ ${item.stock}`}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-500 dark:bg-white/5 dark:text-slate-400">
          ไม่พบรายการสต็อกต่ำกว่ากำหนดในตอนนี้
        </div>
      )}
    </section>

    <section className={panelClassName}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-red-50 p-2 text-red-600 dark:bg-red-500/15 dark:text-red-200">
            <Clock size={16} />
          </div>
          <div>
            <h2 className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">สินค้าใกล้หมดอายุ (90 วัน)</h2>
            <p className="text-xs text-gray-500 dark:text-slate-400">เช็ก lot ที่ควรเร่งระบายหรือวางแผนเคลื่อนไหวก่อนหมดอายุ</p>
          </div>
        </div>
        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600 dark:bg-white/10 dark:text-slate-300">
          {expiryItems.length.toLocaleString("th-TH")} lot
        </span>
      </div>
      {expiryItems.length > 0 ? (
        <div className="space-y-2">
          {expiryItems.map((item) => (
            <div key={`${item.productName}-${item.lotNo}`} className={itemClassName}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900 dark:text-slate-100">{item.productName}</p>
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  Lot: {item.lotNo} · {item.qty} {item.unit} · หมด {item.expDate}
                </p>
              </div>
              <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${daysBadge(item.daysLeft)}`}>
                {item.daysLeft} วัน
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-500 dark:bg-white/5 dark:text-slate-400">
          ยังไม่พบสินค้าใกล้หมดอายุภายใน 90 วัน
        </div>
      )}
    </section>
  </div>
);

export default ExpiryAlerts;
