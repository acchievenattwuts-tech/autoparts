"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList,
} from "recharts";

export type TopProductsChartDatum = {
  name: string;
  qty: number;
  revenue: number;
};

const fmtRevenue = (v: unknown) => {
  const n = Number(v ?? 0);
  return n >= 1000 ? `฿${(n / 1000).toFixed(0)}k` : `฿${n}`;
};

const CustomTooltip = ({ active, payload, label }: {
  active?: boolean;
  payload?: { value: number; name: string; payload: TopProductsChartDatum }[];
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 max-w-[180px] font-medium leading-tight text-gray-800">{label}</p>
      <p className="text-[#10b981]">ยอดขาย: <span className="font-semibold">฿{d.revenue.toLocaleString("th-TH")}</span></p>
      <p className="text-[#0ea5e9]">จำนวนขาย: <span className="font-semibold">{d.qty} ชิ้น</span></p>
    </div>
  );
};

const TopProductsChart = ({ data }: { data: TopProductsChartDatum[] }) => (
  <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
    <div className="mb-1 flex items-center justify-between">
      <h2 className="font-kanit font-semibold text-gray-800">สินค้าขายดี Top 10 (เดือนนี้)</h2>
    </div>
    <p className="mb-3 text-xs text-gray-400">เรียงตามยอดขาย (฿) | hover เพื่อดูจำนวนชิ้น</p>
    {data.length > 0 ? (
      <ResponsiveContainer width="100%" height={320}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 64, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 10, fill: "#9ca3af" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 10, fill: "#374151" }}
            tickLine={false}
            axisLine={false}
            width={160}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "#f9fafb" }} />
          <Bar dataKey="revenue" fill="#10b981" radius={[0, 3, 3, 0]} maxBarSize={16}>
            <LabelList
              dataKey="revenue"
              position="right"
              formatter={fmtRevenue}
              style={{ fontSize: 9, fill: "#6b7280" }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    ) : (
      <div className="flex h-[320px] items-center justify-center text-sm text-gray-400">
        ยังไม่มีข้อมูลสินค้าขายดีของเดือนนี้
      </div>
    )}
  </div>
);

export default TopProductsChart;
