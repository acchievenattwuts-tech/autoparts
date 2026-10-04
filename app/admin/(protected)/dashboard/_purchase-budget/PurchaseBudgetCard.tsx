import type { ReactNode } from "react";
import { CircleCheck, Info, OctagonAlert, TriangleAlert, Wallet } from "lucide-react";

import type { PurchaseBudgetFigures, PurchaseBudgetLevel } from "@/lib/purchase-budget-core";
import type { PurchaseBudgetCashView } from "@/lib/purchase-budget-dashboard";

import {
  BUDGET_MUTED_PANEL_CLASS,
  BUDGET_PANEL_CLASS,
  BUDGET_PANEL_TITLE_CLASS,
  BUDGET_ROW_CLASS,
  BUDGET_STATUS_STYLE,
  budgetAmountTone,
  formatBaht,
  formatPercent,
  formatSignedBaht,
} from "@/components/shared/purchase-budget-ui";

const METER_MAX_PCT = 100;

export const BudgetStatusChip = ({ level }: { level: PurchaseBudgetLevel | "unset" }) => {
  const style = BUDGET_STATUS_STYLE[level];
  const Icon = level === "ok" ? CircleCheck : level === "low" ? TriangleAlert : level === "over" ? OctagonAlert : Info;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-bold ${style.chip}`}>
      <Icon size={14} aria-hidden />
      {style.label}
    </span>
  );
};

export const BudgetCardHeader = ({ subtitle, level, action }: { subtitle: string; level: PurchaseBudgetLevel | "unset"; action?: ReactNode }) => (
  <div className="flex flex-wrap items-center justify-between gap-3">
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600 dark:border-indigo-400/30 dark:bg-indigo-400/10 dark:text-indigo-300">
        <Wallet size={20} aria-hidden />
      </div>
      <div className="min-w-0">
        <h2 className="font-kanit text-base font-semibold text-slate-900 dark:text-slate-100">งบสั่งซื้อคงเหลือ</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <BudgetStatusChip level={level} />
      {action}
    </div>
  </div>
);

const statusMessage = (figures: PurchaseBudgetFigures): string => {
  if (figures.level === "over") {
    return `ใช้เกินงบ ${formatBaht(-figures.remaining)} บาท · ยังบันทึกใบซื้อได้ แต่ควรชะลอการสั่งหรือเพิ่มงบ`;
  }
  if (figures.level === "low") {
    return `เหลือ ${formatPercent(figures.remainingPct)}% ของงบที่ตั้ง ต่ำกว่าเส้นเตือน ${figures.thresholdPct}% · ควรสั่งเฉพาะของที่จำเป็น`;
  }
  return `สั่งซื้อเพิ่มได้อีก ${formatBaht(figures.remaining)} บาท`;
};

export const BudgetHero = ({ figures, startedOnLabel }: { figures: PurchaseBudgetFigures; startedOnLabel: string }) => {
  const style = BUDGET_STATUS_STYLE[figures.level];
  const usedPct = figures.budget > 0 ? Math.min(METER_MAX_PCT, Math.max(0, (figures.used / figures.budget) * METER_MAX_PCT)) : METER_MAX_PCT;
  const markerPct = Math.min(METER_MAX_PCT, Math.max(0, METER_MAX_PCT - figures.thresholdPct));
  return (
    <div className="flex min-w-0 grow basis-[340px] flex-col gap-2">
      <p className="text-sm text-slate-500 dark:text-slate-400">งบที่ยังสั่งซื้อได้</p>
      <p className="font-kanit font-semibold leading-tight text-slate-900 dark:text-slate-100">
        <span className="text-4xl sm:text-[44px]">{formatBaht(figures.remaining)}</span>{" "}
        <span className="text-base font-medium text-slate-600 dark:text-slate-300">บาท</span>
      </p>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        จากงบที่ตั้ง {formatBaht(figures.budget)} บาท · เริ่มนับ {startedOnLabel}
      </p>
      <div
        role="meter"
        aria-label="สัดส่วนงบที่ใช้ไปแล้ว"
        aria-valuemin={0}
        aria-valuemax={METER_MAX_PCT}
        aria-valuenow={Math.round(usedPct)}
        title={`ใช้ไปสุทธิ ${formatBaht(figures.used)} จากงบ ${formatBaht(figures.budget)} (${formatPercent(usedPct)}%)`}
        className={`relative mt-1.5 h-2.5 rounded-full ${style.track}`}
      >
        <div className={`absolute inset-y-0 left-0 rounded-full ${style.fill}`} style={{ width: `${usedPct}%` }} />
        <div className="absolute -inset-y-1 w-0.5 rounded-sm bg-slate-900/55 dark:bg-slate-100/60" style={{ left: `${markerPct}%` }} />
      </div>
      <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <span>
          {figures.used >= 0
            ? `ใช้ไปสุทธิ ${formatBaht(figures.used)} บาท`
            : `ได้งบเพิ่มจากยอดขาย ${formatBaht(-figures.used)} บาท`}
        </span>
        <span>เส้นเตือน: งบเหลือ {figures.thresholdPct}%</span>
      </div>
      <p className={`mt-1 text-sm font-semibold ${style.message}`}>{statusMessage(figures)}</p>
    </div>
  );
};

export const BudgetBreakdown = ({ figures, startedOnLabel }: { figures: PurchaseBudgetFigures; startedOnLabel: string }) => {
  // Deductions read red and additions green (budgetAmountTone); the budget set stays neutral.
  const rows = [
    { label: "งบที่ตั้ง (รวมเพิ่ม/ลดงบ)", amount: formatBaht(figures.budget), tone: budgetAmountTone(0) },
    { label: "หัก ซื้อสินค้าเข้า", amount: formatSignedBaht(-figures.purchases), tone: budgetAmountTone(-figures.purchases) },
    { label: "บวก ต้นทุนสินค้าที่ขาย", amount: formatSignedBaht(figures.salesCost), tone: budgetAmountTone(figures.salesCost) },
    { label: "คืนสินค้า / ปรับสต็อก / เคลม / ใบเพิ่มหนี้", amount: formatSignedBaht(figures.otherEffect), tone: budgetAmountTone(figures.otherEffect) },
  ];
  return (
    <div className={`min-w-0 grow basis-[360px] ${BUDGET_MUTED_PANEL_CLASS}`}>
      <p className={`mb-1 ${BUDGET_PANEL_TITLE_CLASS}`}>ที่มาของตัวเลข (ตั้งแต่ {startedOnLabel})</p>
      {rows.map((row) => (
        <div key={row.label} className={BUDGET_ROW_CLASS}>
          <span className="min-w-0 text-slate-600 dark:text-slate-300">{row.label}</span>
          <span className={`shrink-0 whitespace-nowrap font-semibold tabular-nums ${row.tone}`}>{row.amount}</span>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-3 pt-2 text-sm font-bold text-slate-900 dark:text-slate-100">
        <span>งบคงเหลือ</span>
        <span className="whitespace-nowrap tabular-nums">{formatBaht(figures.remaining)}</span>
      </div>
    </div>
  );
};

const RULES: { title: string; text: string }[] = [
  { title: "นับตั้งแต่วันเริ่มนับ", text: "นับเฉพาะเอกสารที่ลงวันที่ตั้งแต่วันเริ่มนับ ของในสต็อกเดิมไม่หักงบ" },
  { title: "ซื้อสินค้า", text: "หักงบเมื่อบันทึกใบซื้อ ทั้งซื้อสดและซื้อเชื่อ ตามมูลค่าที่เข้าสต็อก" },
  { title: "ขายสินค้า", text: "บวกงบเท่าต้นทุนของสินค้าที่ขาย รวมของที่ซื้อก่อนวันเริ่มนับ ไม่ใช่ราคาขาย" },
  { title: "มัดจำซัพพลายเออร์", text: "ไม่หักงบ แสดงไว้ดูเท่านั้น งบจะหักตอนบันทึกใบซื้อ" },
  { title: "ลูกค้าคืนสินค้า", text: "ของกลับเข้าสต็อก หักงบ" },
  { title: "คืนสินค้าให้ซัพพลายเออร์", text: "ของออกจากสต็อก บวกงบ" },
  { title: "ปรับปรุงสต็อก ของเสีย เคลม", text: "งบขยับตามมูลค่าสต็อกที่เปลี่ยน (ยอดยกมาไม่นับ)" },
  { title: "ใบเพิ่มหนี้ / ลดราคาซื้อ", text: "ต้นทุนเพิ่มหักงบ ต้นทุนลดบวกงบ" },
  { title: "ยกเลิกหรือแก้ไขเอกสาร", text: "คำนวณใหม่ให้อัตโนมัติ ไม่ต้องแก้งบเอง" },
  { title: "สินค้าไม่คำนวณสต็อก", text: "หักงบตอนซื้อ และบวกงบตอนขายตามต้นทุนในบิลขาย" },
  { title: "VAT ค่าขนส่ง ส่วนลด", text: "ไม่นับ VAT ที่ขอคืนได้ · นับค่าขนส่งในใบซื้อ · หักส่วนลดท้ายบิล" },
];

/** Quiet, collapsed by default: reference text that sits under the page header. */
export const BudgetRules = () => (
  <details className="group rounded-xl border border-slate-200 bg-white px-3 sm:px-4 dark:border-white/10 dark:bg-[#0d1728]">
    <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300">
      <Info size={15} aria-hidden className="text-slate-400 dark:text-slate-500" />
      วิธีคำนวณ: งบขยับเมื่อไหร่
      <span className="ml-auto text-xs font-normal text-slate-400 group-open:hidden dark:text-slate-500">กดเพื่อดู</span>
    </summary>
    <div className="mb-3 grid grid-cols-1 gap-x-5 gap-y-2 border-t border-slate-100 pt-3 md:grid-cols-2 xl:grid-cols-3 dark:border-white/10">
      {RULES.map((rule) => (
        <p key={rule.title} className="text-sm leading-relaxed">
          <span className="font-semibold text-slate-700 dark:text-slate-200">{rule.title}</span>
          <span className="text-slate-500 dark:text-slate-400"> — {rule.text}</span>
        </p>
      ))}
    </div>
  </details>
);

export const BudgetCashCompare = ({ cash }: { cash: PurchaseBudgetCashView }) => {
  const stats = [
    ...(cash.cashBankBalance !== null ? [{ label: "เงินสด + ธนาคาร", value: cash.cashBankBalance }] : []),
    { label: "เจ้าหนี้คงค้าง", value: cash.apOutstanding },
    ...(cash.cashBankBalance !== null ? [{ label: "เงินสดหลังจ่ายเจ้าหนี้ครบ", value: cash.cashBankBalance - cash.apOutstanding }] : []),
    { label: "ลูกหนี้คงค้าง (รวม COD)", value: cash.arOutstanding },
  ];
  return (
    <div className={`flex flex-col gap-2.5 ${BUDGET_PANEL_CLASS}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className={BUDGET_PANEL_TITLE_CLASS}>เทียบกับเงินจริง</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">งบบอกว่าสั่งเพิ่มได้อีกเท่าไร ส่วนเงินที่จ่ายได้จริงให้ดูเงินสดประกอบ</p>
      </div>
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-white/5">
            <p className="text-xs text-slate-500 dark:text-slate-400">{stat.label}</p>
            <p className="mt-0.5 font-kanit text-[17px] font-semibold text-slate-900 dark:text-slate-100">{formatBaht(stat.value)}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
