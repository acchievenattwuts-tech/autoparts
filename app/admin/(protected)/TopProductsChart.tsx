"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
const mockData = [
  { name: "คาปาซิเตอร์ 35+5µF", qty: 48 },
  { name: "น้ำยาแอร์ R32 (1kg)", qty: 41 },
  { name: "มอเตอร์พัดลม 15W", qty: 35 },
  { name: "บอร์ดคอนโทรล Mitsubishi", qty: 28 },
  { name: "วาล์ว膨胀 R410A", qty: 24 },
  { name: "คาปาซิเตอร์ 25+5µF", qty: 22 },
  { name: "น้ำยาล้างแอร์ 600ml", qty: 19 },
  { name: "เทอร์โมสตัท 2P", qty: 17 },
  { name: "รีเลย์ 5Pin 12V", qty: 15 },
  { name: "ฟิลเตอร์แอร์ Toyota", qty: 13 },
];

const TopProductsChart = () => (
  <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
    <div className="flex items-center justify-between mb-4">
      <h2 className="font-kanit font-semibold text-gray-800">สินค้าขายดี Top 10 (เดือนนี้)</h2>
      <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full font-medium">ข้อมูลตัวอย่าง</span>
    </div>
    <ResponsiveContainer width="100%" height={280}>
      <BarChart
        data={mockData}
        layout="vertical"
        margin={{ top: 0, right: 24, left: 0, bottom: 0 }}
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
        <Tooltip
          formatter={(v) => [`${Number(v ?? 0)} ชิ้น`, "จำนวนขาย"]}
          contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }}
          cursor={{ fill: "#f3f4f6" }}
        />
        <Bar dataKey="qty" fill="#f97316" radius={[0, 3, 3, 0]} maxBarSize={16} />
      </BarChart>
    </ResponsiveContainer>
  </div>
);

export default TopProductsChart;
