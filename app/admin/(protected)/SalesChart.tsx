"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

export type SalesChartDatum = {
  date: string;
  amount: number;
};

const formatYAxis = (v: number) =>
  v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`;

const SalesChart = ({ data }: { data: SalesChartDatum[] }) => (
  <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
    <div className="mb-4 flex items-center justify-between">
      <h2 className="font-kanit font-semibold text-gray-800">ยอดขายรายวัน (30 วันย้อนหลัง)</h2>
    </div>
    {data.length > 0 ? (
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
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
    ) : (
      <div className="flex h-[320px] items-center justify-center text-sm text-gray-400">
        ยังไม่มียอดขายในช่วง 30 วันที่ผ่านมา
      </div>
    )}
  </div>
);

export default SalesChart;
