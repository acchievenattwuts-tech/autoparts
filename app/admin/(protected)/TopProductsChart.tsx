"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

const mockData = [
  { name: "บอร์ดคอนโทรล Mitsubishi",   qty: 28, revenue: 196000 },
  { name: "น้ำยาแอร์ R32 (1kg)",       qty: 41, revenue: 61500 },
  { name: "มอเตอร์พัดลม 15W",          qty: 35, revenue: 52500 },
  { name: "วาล์ว膨胀 R410A",            qty: 24, revenue: 36000 },
  { name: "คาปาซิเตอร์ 35+5µF",        qty: 48, revenue: 14400 },
  { name: "น้ำยาล้างแอร์ 600ml",        qty: 19, revenue: 9500 },
  { name: "เทอร์โมสตัท 2P",            qty: 17, revenue: 8500 },
  { name: "ฟิลเตอร์แอร์ Toyota",        qty: 13, revenue: 7800 },
  { name: "คาปาซิเตอร์ 25+5µF",        qty: 22, revenue: 5500 },
  { name: "รีเลย์ 5Pin 12V",           qty: 15, revenue: 4500 },
];

const fmtRevenue = (v: unknown) => {
  const n = Number(v ?? 0);
  return n >= 1000 ? `฿${(n / 1000).toFixed(1)}k` : `฿${n}`;
};

const CustomTooltip = ({ active, payload, label }: {
  active?: boolean;
  payload?: { value: number; name: string }[];
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  const qty = payload.find((p) => p.name === "qty")?.value ?? 0;
  const rev = payload.find((p) => p.name === "revenue")?.value ?? 0;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-medium text-gray-800 mb-1">{label}</p>
      <p className="text-[#0ea5e9]">จำนวนขาย: <span className="font-semibold">{qty} ชิ้น</span></p>
      <p className="text-[#10b981]">ยอดขาย: <span className="font-semibold">฿{Number(rev).toLocaleString("th-TH")}</span></p>
    </div>
  );
};

const TopProductsChart = () => (
  <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
    <div className="flex items-center justify-between mb-4">
      <h2 className="font-kanit font-semibold text-gray-800">สินค้าขายดี Top 10 (เดือนนี้)</h2>
      <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full font-medium">ข้อมูลตัวอย่าง</span>
    </div>
    <ResponsiveContainer width="100%" height={320}>
      <BarChart
        data={mockData}
        layout="vertical"
        margin={{ top: 0, right: 56, left: 0, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 10, fill: "#9ca3af" }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 10, fill: "#374151" }}
          tickLine={false}
          axisLine={false}
          width={160}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: "#f3f4f6" }} />
        <Bar dataKey="qty" fill="#0ea5e9" radius={[0, 3, 3, 0]} maxBarSize={14}>
          {mockData.map((_, i) => (
            <Cell key={i} fill="#0ea5e9" />
          ))}
        </Bar>
        <Bar dataKey="revenue" fill="#10b981" radius={[0, 3, 3, 0]} maxBarSize={14}
          label={{ position: "right", formatter: fmtRevenue, fontSize: 9, fill: "#6b7280" }}
        />
      </BarChart>
    </ResponsiveContainer>
  </div>
);

export default TopProductsChart;
