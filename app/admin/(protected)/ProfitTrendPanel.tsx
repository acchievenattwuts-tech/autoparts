"use client";

import { useState } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useAdminTheme } from "@/components/shared/AdminThemeProvider";

type ProfitTrendPanelDatum = {
  dateKey: string;
  shortLabel: string;
  fullLabel: string;
  salesAmount: number;
  grossProfit: number;
  marginPct: number;
};

type ProfitTrendPanelProps = {
  basisLabel: string;
  data: ProfitTrendPanelDatum[];
  hasSelectedRangeActivity: boolean;
};

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercent(value: number): string {
  return `${value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function formatCompactNumber(value: number): string {
  const absolute = Math.abs(value);

  if (absolute >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (absolute >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }

  return value.toFixed(0);
}

function resolveActiveIndex(state: unknown): number | null {
  if (
    typeof state === "object" &&
    state !== null &&
    "activeTooltipIndex" in state &&
    typeof state.activeTooltipIndex === "number"
  ) {
    return state.activeTooltipIndex;
  }

  return null;
}

function TrendTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: Array<{ value?: number }>;
  label?: string;
  formatter: (value: number) => string;
}) {
  const { isDark } = useAdminTheme();

  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const surfaceColor = isDark ? "#0f172a" : "#ffffff";
  const borderColor = isDark ? "rgba(148, 163, 184, 0.24)" : "#e5e7eb";
  const textColor = isDark ? "#e5e7eb" : "#374151";

  return (
    <div
      className="rounded-xl border px-3 py-2 text-xs shadow-lg"
      style={{ backgroundColor: surfaceColor, borderColor, color: textColor }}
    >
      <p className="font-medium">{label}</p>
      <p className="mt-1">{formatter(Number(payload[0]?.value ?? 0))}</p>
    </div>
  );
}

export default function ProfitTrendPanel({
  basisLabel,
  data,
  hasSelectedRangeActivity,
}: ProfitTrendPanelProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const { isDark } = useAdminTheme();
  const chartColors = isDark
    ? {
        activeDotFill: "#020617",
        areaFill: "rgba(56, 189, 248, 0.24)",
        areaStroke: "#67e8f9",
        axis: "#a5b4c7",
        barCursor: "rgba(52, 211, 153, 0.14)",
        barFill: "#6ee7b7",
        grid: "rgba(148, 163, 184, 0.18)",
        legendMargin: "#cbd5e1",
        marginLine: "#c084fc",
        marginReference: "rgba(251, 191, 36, 0.85)",
        reference: "rgba(148, 163, 184, 0.38)",
        surface: "#0f172a",
        text: "#e5e7eb",
        tooltipBorder: "rgba(148, 163, 184, 0.28)",
      }
    : {
        activeDotFill: "#ffffff",
        areaFill: "#bae6fd",
        areaStroke: "#0ea5e9",
        axis: "#94a3b8",
        barCursor: "#ecfdf5",
        barFill: "#10b981",
        grid: "#eef2f7",
        legendMargin: "#8b5cf6",
        marginLine: "#8b5cf6",
        marginReference: "#f59e0b",
        reference: "#cbd5e1",
        surface: "#ffffff",
        text: "#374151",
        tooltipBorder: "#e5e7eb",
      };

  const onChartMouseMove = (state: unknown) => {
    const nextIndex = resolveActiveIndex(state);
    if (nextIndex !== null) {
      setActiveIndex(nextIndex);
    }
  };

  const onChartMouseLeave = () => {
    setActiveIndex(null);
  };

  const sharedChartProps = {
    data,
    syncId: "profit-trend",
    margin: { top: 12, right: 12, left: -8, bottom: 0 },
    onMouseMove: onChartMouseMove,
    onMouseLeave: onChartMouseLeave,
  } as const;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-white/10 dark:bg-slate-950/70">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
          Trend Focus
        </p>
        <h3 className="mt-1 font-kanit text-lg font-semibold text-gray-900">
          ดูความต่างของยอดขาย กำไร และ % Margin ในวันเดียวกัน
        </h3>
        <p className="mt-1 text-xs text-gray-600">
          ใช้ hover บนกราฟเพื่อดูค่ารายวันแบบละเอียด ส่วนเส้นประสีส้มในกราฟ margin คือเกณฑ์ 20% เพื่อช่วยแยกวันขายคุ้มกับวัน margin บาง
        </p>
        <p className="mt-2 text-xs text-gray-500">
          ยอดขายแสดงตาม basis ที่เลือก: {basisLabel} ส่วนกำไรและ % Margin ยังคงยึดก่อน VAT เสมอ
        </p>
      </div>

      <div className="space-y-5">
        <div>
          <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
            <span>ยอดขายรายวัน ({basisLabel})</span>
            <span>แท่งสีเขียว = ปริมาณยอดขายของแต่ละวัน</span>
          </div>
          <div className="h-44 rounded-2xl border border-gray-100 bg-white px-2 py-3 dark:border-white/10 dark:bg-slate-950/80">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart {...sharedChartProps}>
                <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="shortLabel"
                  tick={{ fontSize: 11, fill: chartColors.axis }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tickFormatter={formatCompactNumber}
                  tick={{ fontSize: 11, fill: chartColors.axis }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                />
                <Tooltip
                  cursor={{ fill: chartColors.barCursor }}
                  content={<TrendTooltip formatter={(value) => `${formatMoney(value)} บาท`} />}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel ?? ""}
                />
                <Bar dataKey="salesAmount" fill={chartColors.barFill} radius={[10, 10, 3, 3]} maxBarSize={28} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
            <span>กำไรขั้นต้นรายวัน</span>
            <span>พื้นที่สีฟ้า = เห็นจังหวะกำไรขึ้นลงได้ชัดกว่าการใช้แท่งแบบเดิม</span>
          </div>
          <div className="h-44 rounded-2xl border border-gray-100 bg-white px-2 py-3 dark:border-white/10 dark:bg-slate-950/80">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart {...sharedChartProps}>
                <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="shortLabel"
                  tick={{ fontSize: 11, fill: chartColors.axis }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tickFormatter={formatCompactNumber}
                  tick={{ fontSize: 11, fill: chartColors.axis }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                />
                <ReferenceLine y={0} stroke={chartColors.reference} strokeDasharray="4 4" />
                <Tooltip
                  cursor={{ stroke: chartColors.areaStroke, strokeDasharray: "4 4" }}
                  content={<TrendTooltip formatter={(value) => `${formatMoney(value)} บาท`} />}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel ?? ""}
                />
                <Area
                  type="monotone"
                  dataKey="grossProfit"
                  stroke={chartColors.areaStroke}
                  strokeWidth={3}
                  fill={chartColors.areaFill}
                  fillOpacity={0.55}
                  dot={{ r: 0 }}
                  activeDot={{ r: 5, stroke: chartColors.areaStroke, strokeWidth: 2, fill: chartColors.activeDotFill }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
            <span>% Margin รายวัน</span>
            <span>เส้นประสีส้ม = threshold 20% เพื่อแยกวันขายคุ้มกับวัน margin บาง</span>
          </div>
          <div className="h-44 rounded-2xl border border-gray-100 bg-white px-2 py-3 dark:border-white/10 dark:bg-slate-950/80">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart {...sharedChartProps}>
                <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="shortLabel"
                  tick={{ fontSize: 11, fill: chartColors.axis }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tickFormatter={(value) => `${value.toFixed(0)}%`}
                  tick={{ fontSize: 11, fill: chartColors.axis }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                />
                <ReferenceLine y={20} stroke={chartColors.marginReference} strokeDasharray="6 4" />
                <Tooltip
                  cursor={{ stroke: chartColors.marginLine, strokeDasharray: "4 4" }}
                  content={<TrendTooltip formatter={formatPercent} />}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel ?? ""}
                />
                <Line
                  type="monotone"
                  dataKey="marginPct"
                  stroke={chartColors.marginLine}
                  strokeWidth={3}
                  dot={{ r: 3, fill: chartColors.legendMargin, strokeWidth: 0 }}
                  activeDot={{ r: 5, stroke: chartColors.marginLine, strokeWidth: 2, fill: chartColors.activeDotFill }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-white/10 dark:bg-slate-950/70">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="font-medium text-gray-700">วิธีอ่านเร็ว:</span>
          <span className="inline-flex items-center gap-2 text-gray-600">
            <span className="h-3 w-3 rounded-full bg-emerald-500" />
            เขียว = ยอดขาย
          </span>
          <span className="inline-flex items-center gap-2 text-gray-600">
            <span className="h-3 w-3 rounded-full bg-sky-500" />
            ฟ้า = กำไรขั้นต้น
          </span>
          <span className="inline-flex items-center gap-2 text-gray-600">
            <span className="h-3 w-3 rounded-full bg-violet-500" />
            ม่วง = % Margin
          </span>
        </div>
        <p className="mt-3 text-xs text-gray-600">
          ถ้าวันไหนแท่งเขียวสูงแต่เส้นม่วงต่ำ แปลว่าขายได้เยอะแต่ margin บาง ส่วนวันที่พื้นที่ฟ้าสูงและเส้นม่วงสูงมักเป็นวันที่ขายคุ้มและทำกำไรดี
        </p>
        {!hasSelectedRangeActivity ? (
          <p className="mt-2 text-xs text-amber-700">
            ช่วงที่เลือกยังไม่พบยอดขายหรือค่าใช้จ่ายจริงในชั้นข้อมูล fact_profit จึงควรเห็นตัวเลขเป็นศูนย์ทั้งหมด
          </p>
        ) : null}
      </div>
    </div>
  );
}
