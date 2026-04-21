"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useAdminTheme } from "@/components/shared/AdminThemeProvider";

export type TopProductsChartDatum = {
  name: string;
  qty: number;
  revenue: number;
};

const formatRevenue = (value: unknown) => {
  const numericValue = Number(value ?? 0);
  return numericValue >= 1000 ? `฿${(numericValue / 1000).toFixed(0)}k` : `฿${numericValue}`;
};

const CustomTooltip = ({
  active,
  label,
  payload,
  isDark,
}: {
  active?: boolean;
  label?: string;
  payload?: { value: number; name: string; payload: TopProductsChartDatum }[];
  isDark: boolean;
}) => {
  if (!active || !payload?.length) return null;

  const datum = payload[0].payload;

  return (
    <div
      className={`rounded-lg border px-3 py-2 text-xs shadow-lg ${
        isDark
          ? "border-white/10 bg-slate-900 text-slate-100"
          : "border-gray-200 bg-white text-gray-800"
      }`}
    >
      <p className="mb-1 max-w-[180px] font-medium leading-tight">{label}</p>
      <p className="text-emerald-500 dark:text-emerald-300">
        ยอดขาย: <span className="font-semibold">฿{datum.revenue.toLocaleString("th-TH")}</span>
      </p>
      <p className="text-sky-500 dark:text-sky-300">
        จำนวนขาย: <span className="font-semibold">{datum.qty} ชิ้น</span>
      </p>
    </div>
  );
};

const TopProductsChart = ({ data }: { data: TopProductsChartDatum[] }) => {
  const { isDark } = useAdminTheme();
  const colors = isDark
    ? {
        axis: "#a5b4c7",
        cursor: "rgba(52, 211, 153, 0.12)",
        grid: "rgba(148, 163, 184, 0.18)",
        label: "#e5e7eb",
        value: "#cbd5e1",
      }
    : {
        axis: "#9ca3af",
        cursor: "#f9fafb",
        grid: "#f0f0f0",
        label: "#374151",
        value: "#6b7280",
      };

  return (
    <div className="rounded-2xl border border-gray-100 bg-white/95 p-5 shadow-sm dark:border-white/10 dark:bg-slate-950/80">
      <div className="mb-1 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-kanit font-semibold text-gray-800 dark:text-slate-100">สินค้าขายดี Top 10 (เดือนนี้)</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">เรียงตามยอดขาย (฿) และ hover เพื่อดูจำนวนชิ้นอย่างรวดเร็ว</p>
        </div>
      </div>
      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 64, left: 0, bottom: 0 }}>
            <CartesianGrid horizontal={false} stroke={colors.grid} strokeDasharray="3 3" />
            <XAxis
              axisLine={false}
              tick={{ fontSize: 10, fill: colors.axis }}
              tickFormatter={(value) => (value >= 1000 ? `${(value / 1000).toFixed(0)}k` : `${value}`)}
              tickLine={false}
              type="number"
            />
            <YAxis
              axisLine={false}
              dataKey="name"
              tick={{ fontSize: 10, fill: colors.label }}
              tickLine={false}
              type="category"
              width={160}
            />
            <Tooltip content={<CustomTooltip isDark={isDark} />} cursor={{ fill: colors.cursor }} />
            <Bar dataKey="revenue" fill="#10b981" maxBarSize={16} radius={[0, 3, 3, 0]}>
              <LabelList
                dataKey="revenue"
                formatter={formatRevenue}
                position="right"
                style={{ fill: colors.value, fontSize: 9 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex h-[320px] items-center justify-center text-sm text-gray-500 dark:text-slate-400">
          ยังไม่มีข้อมูลสินค้าขายดีของเดือนนี้
        </div>
      )}
    </div>
  );
};

export default TopProductsChart;
