import { AlertTriangle, Clock } from "lucide-react";

interface LotExpiry {
  productName: string;
  lotNo: string;
  expDate: string;
  daysLeft: number;
  qty: number;
  unit: string;
}

const mockExpiryData: LotExpiry[] = [
  { productName: "น้ำยาแอร์ R32 (1kg)", lotNo: "R32-2501A", expDate: "15/04/2026", daysLeft: 19, qty: 12, unit: "กระป๋อง" },
  { productName: "น้ำยาล้างแอร์สูตรเข้มข้น", lotNo: "CL-2412", expDate: "30/04/2026", daysLeft: 34, qty: 8, unit: "ขวด" },
  { productName: "น้ำยาแอร์ R410A (1kg)", lotNo: "R410-2502", expDate: "10/05/2026", daysLeft: 44, qty: 6, unit: "กระป๋อง" },
  { productName: "กาวซิลิโคนทนความร้อน", lotNo: "SIL-2501", expDate: "20/05/2026", daysLeft: 54, qty: 15, unit: "หลอด" },
  { productName: "สเปรย์ล้างคอยล์ Foam", lotNo: "FC-2503", expDate: "01/06/2026", daysLeft: 66, qty: 24, unit: "กระป๋อง" },
];

const mockLowStockData = [
  { name: "คาปาซิเตอร์ 35+5µF 450V", stock: 2, minStock: 10, unit: "ตัว" },
  { name: "มอเตอร์พัดลม Daikin 20W", stock: 1, minStock: 5, unit: "ตัว" },
  { name: "บอร์ดคอนโทรล Mitsubishi SRK", stock: 0, minStock: 3, unit: "แผ่น" },
  { name: "วาล์ว膨胀 R410A 1.5 ตัน", stock: 3, minStock: 8, unit: "ตัว" },
  { name: "รีเลย์ 5Pin 12V 30A", stock: 4, minStock: 10, unit: "ตัว" },
];

const daysBadge = (days: number) => {
  if (days <= 30) return "bg-red-100 text-red-700";
  if (days <= 60) return "bg-orange-100 text-orange-700";
  return "bg-yellow-100 text-yellow-700";
};

const stockBadge = (stock: number) => {
  if (stock === 0) return "bg-red-100 text-red-700";
  return "bg-orange-100 text-orange-700";
};

const ExpiryAlerts = () => (
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
    {/* Low Stock */}
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-orange-500" />
          <h2 className="font-kanit font-semibold text-gray-800">สต็อกต่ำกว่ากำหนด</h2>
        </div>
        <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full font-medium">ข้อมูลตัวอย่าง</span>
      </div>
      <div className="space-y-2">
        {mockLowStockData.map((item) => (
          <div key={item.name} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
            <div className="flex-1 min-w-0 mr-3">
              <p className="text-sm text-gray-800 truncate">{item.name}</p>
              <p className="text-xs text-gray-400">min: {item.minStock} {item.unit}</p>
            </div>
            <span className={`shrink-0 inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${stockBadge(item.stock)}`}>
              {item.stock === 0 ? "หมด" : `เหลือ ${item.stock}`}
            </span>
          </div>
        ))}
      </div>
    </div>

    {/* Expiry Alert */}
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Clock size={16} className="text-red-500" />
          <h2 className="font-kanit font-semibold text-gray-800">สินค้าใกล้หมดอายุ (90 วัน)</h2>
        </div>
        <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full font-medium">ข้อมูลตัวอย่าง</span>
      </div>
      <div className="space-y-2">
        {mockExpiryData.map((item) => (
          <div key={item.lotNo} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
            <div className="flex-1 min-w-0 mr-3">
              <p className="text-sm text-gray-800 truncate">{item.productName}</p>
              <p className="text-xs text-gray-400">
                Lot: {item.lotNo} · {item.qty} {item.unit} · หมด {item.expDate}
              </p>
            </div>
            <span className={`shrink-0 inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${daysBadge(item.daysLeft)}`}>
              {item.daysLeft} วัน
            </span>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-400 mt-3 flex items-center gap-1">
        <Clock size={10} /> จะแสดงข้อมูลจริงหลังเปิดใช้ระบบ Lot (Phase 5.5)
      </p>
    </div>
  </div>
);

export default ExpiryAlerts;
