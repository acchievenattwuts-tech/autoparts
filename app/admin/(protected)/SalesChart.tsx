"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
const mockData = [
  { date: "27/02", amount: 4200 },
  { date: "28/02", amount: 6800 },
  { date: "01/03", amount: 3100 },
  { date: "02/03", amount: 7500 },
  { date: "03/03", amount: 2900 },
  { date: "04/03", amount: 1200 },
  { date: "05/03", amount: 8400 },
  { date: "06/03", amount: 5600 },
  { date: "07/03", amount: 9200 },
  { date: "08/03", amount: 4700 },
  { date: "09/03", amount: 6300 },
  { date: "10/03", amount: 3800 },
  { date: "11/03", amount: 7100 },
  { date: "12/03", amount: 5400 },
  { date: "13/03", amount: 8900 },
  { date: "14/03", amount: 4100 },
  { date: "15/03", amount: 6700 },
  { date: "16/03", amount: 3300 },
  { date: "17/03", amount: 9800 },
  { date: "18/03", amount: 5200 },
  { date: "19/03", amount: 7800 },
  { date: "20/03", amount: 4500 },
  { date: "21/03", amount: 6100 },
  { date: "22/03", amount: 3600 },
  { date: "23/03", amount: 8200 },
  { date: "24/03", amount: 5900 },
  { date: "25/03", amount: 7300 },
  { date: "26/03", amount: 4800 },
  { date: "27/03", amount: 6500 },
  { date: "28/03", amount: 9100 },
];

const formatYAxis = (v: number) =>
  v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`;

const SalesChart = () => (
  <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
    <div className="flex items-center justify-between mb-4">
      <h2 className="font-kanit font-semibold text-gray-800">ยอดขายรายวัน (30 วันย้อนหลัง)</h2>
      <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full font-medium">ข้อมูลตัวอย่าง</span>
    </div>
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={mockData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "#9ca3af" }}
          tickLine={false}
          axisLine={false}
          interval={4}
        />
        <YAxis
          tickFormatter={formatYAxis}
          tick={{ fontSize: 10, fill: "#9ca3af" }}
          tickLine={false}
          axisLine={false}
          width={32}
        />
        <Tooltip
          formatter={(v) => [`฿${Number(v ?? 0).toLocaleString("th-TH")}`, "ยอดขาย"]}
          labelStyle={{ fontSize: 12, color: "#374151" }}
          contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }}
          cursor={{ fill: "#f3f4f6" }}
        />
        <Bar dataKey="amount" fill="#1e3a5f" radius={[3, 3, 0, 0]} maxBarSize={20} />
      </BarChart>
    </ResponsiveContainer>
  </div>
);

export default SalesChart;
