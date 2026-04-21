"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useAdminTheme } from "@/components/shared/AdminThemeProvider";

export type SalesChartDatum = {
  date: string;
  amount: number;
};

const formatYAxis = (value: number) => (value >= 1000 ? `${(value / 1000).toFixed(0)}k` : `${value}`);

const SalesChart = ({ data }: { data: SalesChartDatum[] }) => {
  const { isDark } = useAdminTheme();
  const colors = isDark
    ? {
        axis: "#94a3b8",
        bar: "#7dd3fc",
        cursor: "rgba(125, 211, 252, 0.10)",
        grid: "rgba(148, 163, 184, 0.18)",
        label: "#e2e8f0",
        tooltipBg: "#0f172a",
        tooltipBorder: "rgba(148, 163, 184, 0.28)",
      }
    : {
        axis: "#9ca3af",
        bar: "#1e3a5f",
        cursor: "#f3f4f6",
        grid: "#f0f0f0",
        label: "#374151",
        tooltipBg: "#ffffff",
        tooltipBorder: "#e5e7eb",
      };

  return (
    <div className="rounded-2xl border border-gray-100 bg-white/95 p-5 shadow-sm dark:border-white/10 dark:bg-slate-950/80">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-kanit font-semibold text-gray-800 dark:text-slate-100">ยอดขายรายวัน (30 วันย้อนหลัง)</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">ดูแนวโน้มยอดขายช่วงล่าสุดเพื่อจับจังหวะวันที่ยอดขึ้นหรือลงผิดปกติ</p>
        </div>
        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600 dark:bg-white/10 dark:text-slate-300">
          30 วัน
        </span>
      </div>
      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="date"
              interval={4}
              tick={{ fontSize: 10, fill: colors.axis }}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              tick={{ fontSize: 10, fill: colors.axis }}
              tickFormatter={formatYAxis}
              tickLine={false}
              width={32}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: colors.tooltipBg,
                border: `1px solid ${colors.tooltipBorder}`,
                borderRadius: 8,
                color: colors.label,
                fontSize: 12,
              }}
              cursor={{ fill: colors.cursor }}
              formatter={(value) => [`฿${Number(value ?? 0).toLocaleString("th-TH")}`, "ยอดขาย"]}
              labelStyle={{ color: colors.label, fontSize: 12 }}
            />
            <Bar dataKey="amount" fill={colors.bar} maxBarSize={20} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex h-[320px] items-center justify-center text-sm text-gray-500 dark:text-slate-400">
          ยังไม่มียอดขายในช่วง 30 วันที่ผ่านมา
        </div>
      )}
    </div>
  );
};

export default SalesChart;
