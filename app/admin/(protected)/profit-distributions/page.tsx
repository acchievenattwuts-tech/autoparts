export const dynamic = "force-dynamic";

import { AlertTriangle, PieChart, Plus, UserCog } from "lucide-react";

import NavLink from "@/components/shared/NavLink";
import { hasPermissionAccess } from "@/lib/access-control";
import {
  getCurrentPeriod,
  getPartnerYearSummaries,
  getYearOverview,
  listDistributionYears,
  PROFIT_DISTRIBUTION_START_LABEL,
  type PartnerYearSummary,
  type YearOverviewMonth,
} from "@/lib/profit-distribution";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { formatDateThai } from "@/lib/th-date";

import YearSelect from "./YearSelect";

type PageProps = {
  searchParams: Promise<{ year?: string }>;
};

function money(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const CARD_CLASS =
  "rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900";

/** Row status drives both the badge and whether a shortcut to declare appears. */
type MonthStatus = "BEFORE_START" | "OPEN" | "DECLARED" | "PENDING" | "NO_PROFIT" | "LOSS";

/** Below this, a net profit is treated as exactly zero rather than a loss. */
const ZERO_PROFIT_EPSILON = 0.005;

/**
 * Every closed, in-scope month must end up with a document — a loss month too,
 * because the declaration chain may not have gaps (an undeclared month would be
 * carried forward again by every later period).
 */
function needsDeclaration(status: MonthStatus): boolean {
  return status === "PENDING" || status === "LOSS" || status === "NO_PROFIT";
}

function getMonthStatus(row: YearOverviewMonth): MonthStatus {
  if (row.isBeforeStart) return "BEFORE_START";
  if (!row.isClosed) return "OPEN";
  if (row.distribution) return "DECLARED";
  if (row.currentNetProfit < -ZERO_PROFIT_EPSILON) return "LOSS";
  if (row.currentNetProfit <= ZERO_PROFIT_EPSILON) return "NO_PROFIT";
  return "PENDING";
}

export default async function ProfitDistributionsPage({ searchParams }: PageProps) {
  await requirePermission("profit_distributions.view");

  const { session, role, permissions } = await getSessionPermissionContext();
  const canViewAll = hasPermissionAccess(role, permissions, "profit_distributions.view_all");
  const canCreate = hasPermissionAccess(role, permissions, "profit_distributions.create");
  const canManagePartners = hasPermissionAccess(
    role,
    permissions,
    "profit_distributions.partners.manage",
  );

  const params = await searchParams;
  const years = await listDistributionYears();
  const requestedYear = Number(params.year);
  const year =
    Number.isInteger(requestedYear) && years.includes(requestedYear)
      ? requestedYear
      : (years[0] ?? getCurrentPeriod().year);

  const [overview, partnerSummaries] = await Promise.all([
    getYearOverview(year),
    getPartnerYearSummaries(year),
  ]);

  // Without view_all a partner only ever sees their own figures — in the cards,
  // the table columns, and the totals.
  const visiblePartners: PartnerYearSummary[] = canViewAll
    ? partnerSummaries
    : partnerSummaries.filter((partner) => partner.userId === session.user.id);

  const visiblePartnerIds = new Set(visiblePartners.map((partner) => partner.partnerProfileId));

  // Pre-start months are excluded from the scale — a large legacy loss would
  // otherwise flatten every in-scope bar to nothing.
  const chartScale = Math.max(
    1,
    ...overview.months
      .filter((row) => !row.isBeforeStart)
      .map((row) =>
        Math.max(Math.abs(row.currentNetProfit), row.distribution?.distributedAmount ?? 0),
      ),
  );

  const pendingMonths = overview.months.filter((row) => needsDeclaration(getMonthStatus(row)));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <PieChart size={24} className="text-[#1e3a5f] dark:text-sky-300" />
          <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">
            แบ่งกำไรผู้ร่วมทุน
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <YearSelect years={years} value={year} />
          {canManagePartners ? (
            <NavLink
              href="/admin/profit-distributions/partners"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-gray-200 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"
            >
              <UserCog size={16} />
              ผู้ร่วมทุน
            </NavLink>
          ) : null}
          {canCreate ? (
            <NavLink
              href="/admin/profit-distributions/new"
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#1e3a5f] px-4 text-sm font-medium text-white hover:bg-[#274b78] dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400"
            >
              <Plus size={16} />
              ประกาศแบ่งกำไร
            </NavLink>
          ) : null}
        </div>
      </div>

      <p className="text-sm text-gray-500 dark:text-slate-400">
        แบ่งกำไรสุทธิรายเดือนให้ผู้ร่วมทุน — เอกสารนี้ตัดเงินสดตามวันที่โอนจริง แต่
        <span className="font-medium text-gray-700 dark:text-slate-200">ไม่กระทบกำไรสุทธิของเดือนใดทั้งสิ้น</span>{" "}
        จึงคีย์ย้อนหลังได้อย่างปลอดภัย · เริ่มนับตั้งแต่งวด{" "}
        <span className="font-medium text-gray-700 dark:text-slate-200">
          {PROFIT_DISTRIBUTION_START_LABEL}
        </span>{" "}
        เดือนก่อนหน้านั้นไม่นำมาคำนวณ
      </p>

      {canCreate && pendingMonths.length > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-400/20 dark:bg-amber-400/10">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" />
            <div className="space-y-2">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-100">
                มี {pendingMonths.length} เดือนที่จบแล้วแต่ยังไม่ได้ประกาศแบ่งกำไร
              </p>
              <p className="text-xs text-amber-700/90 dark:text-amber-200/90">
                ต้องประกาศเรียงตามลำดับ เริ่มจากเดือนแรกสุด — เดือนที่ขาดทุนก็ต้องประกาศ
                (ยอดที่แบ่งเป็น 0 แล้วยกไปหักเดือนถัดไป)
              </p>
              <div className="flex flex-wrap gap-2">
                {pendingMonths.map((row) => (
                  <NavLink
                    key={row.month}
                    href={`/admin/profit-distributions/new?period=${row.year}-${String(row.month).padStart(2, "0")}`}
                    className="inline-flex items-center gap-1 rounded-full bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300"
                  >
                    ประกาศ {row.shortLabel} · ฿{money(row.currentNetProfit)}
                  </NavLink>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className={CARD_CLASS}>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            กำไรสุทธิสะสม (ตั้งแต่ {PROFIT_DISTRIBUTION_START_LABEL})
          </p>
          <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-slate-100">
            ฿{money(overview.totals.currentNetProfit)}
          </p>
        </div>
        <div className={CARD_CLASS}>
          <p className="text-xs text-gray-500 dark:text-slate-400">แบ่งไปแล้ว</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-600 dark:text-emerald-300">
            ฿{money(overview.totals.distributedAmount)}
          </p>
        </div>
        <div className={CARD_CLASS}>
          <p className="text-xs text-gray-500 dark:text-slate-400">กันไว้ในร้าน</p>
          <p className="mt-1 text-2xl font-semibold text-sky-600 dark:text-sky-300">
            ฿{money(overview.totals.retainedAmount)}
          </p>
          <p className="mt-0.5 text-[10px] text-gray-400 dark:text-slate-500">
            = กำไรสุทธิสะสม − แบ่งไปแล้ว (ไม่ใช่ผลรวมคอลัมน์ &quot;กันไว้&quot; รายเดือน
            เพราะยอดที่ยกไปจะซ้ำกัน)
          </p>
        </div>
        <div className={CARD_CLASS}>
          <p className="text-xs text-gray-500 dark:text-slate-400">เดือนที่ยังไม่ประกาศ</p>
          <p className="mt-1 text-2xl font-semibold text-amber-600 dark:text-amber-300">
            {overview.pendingClosedMonths}
          </p>
        </div>
      </div>

      {visiblePartners.length === 0 ? (
        <div className={`${CARD_CLASS} text-center`}>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            {canViewAll
              ? "ยังไม่มีผู้ร่วมทุนในระบบ"
              : "บัญชีของคุณยังไม่ได้ถูกตั้งเป็นผู้ร่วมทุน"}
          </p>
          {canManagePartners ? (
            <NavLink
              href="/admin/profit-distributions/partners"
              className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg bg-[#1e3a5f] px-4 text-sm font-medium text-white hover:bg-[#274b78] dark:bg-sky-500 dark:text-slate-950"
            >
              <UserCog size={15} />
              ตั้งค่าผู้ร่วมทุน
            </NavLink>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {visiblePartners.map((partner) => {
            const drifted = Math.abs(partner.fairnessDeltaPercent) > 5;
            return (
              <div key={partner.partnerProfileId} className={CARD_CLASS}>
                <p className="truncate font-kanit text-base font-semibold text-gray-900 dark:text-slate-100">
                  {partner.name}
                </p>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-xs text-gray-500 dark:text-slate-400">
                      ได้ล่าสุด
                      {partner.latestPeriodShortLabel ? ` (${partner.latestPeriodShortLabel})` : ""}
                    </dt>
                    <dd className="font-semibold text-gray-900 dark:text-slate-100">
                      ฿{money(partner.latestAmount)}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-xs text-gray-500 dark:text-slate-400">สะสมปี {year}</dt>
                    <dd className="font-semibold text-emerald-600 dark:text-emerald-300">
                      ฿{money(partner.yearTotal)}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-xs text-gray-500 dark:text-slate-400">ทุนคงเหลือ</dt>
                    <dd className="text-gray-700 dark:text-slate-200">
                      ฿{money(partner.capitalBalance)}
                    </dd>
                  </div>
                </dl>
                <div
                  className={`mt-3 rounded-lg px-2.5 py-1.5 text-xs ${
                    drifted
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-400/10 dark:text-amber-200"
                      : "bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-slate-300"
                  }`}
                >
                  ได้จริง {partner.actualSharePercent}% · ตั้งต้น {partner.defaultSharePercent}%
                  {partner.fairnessDeltaPercent !== 0 ? (
                    <span className="ml-1 font-medium">
                      ({partner.fairnessDeltaPercent > 0 ? "+" : ""}
                      {partner.fairnessDeltaPercent})
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <section className={CARD_CLASS}>
        <h2 className="font-kanit text-base font-semibold text-gray-900 dark:text-slate-100">
          กำไรสุทธิ เทียบกับ ยอดที่แบ่ง — ปี {year}
        </h2>
        <div className="mt-4 overflow-x-auto">
          <div className="flex min-w-[640px] items-end gap-2">
            {overview.months.map((row) => {
              const profitHeight = Math.round(
                (Math.max(row.currentNetProfit, 0) / chartScale) * 100,
              );
              const distributedHeight = Math.round(
                ((row.distribution?.distributedAmount ?? 0) / chartScale) * 100,
              );
              const isLoss = row.isClosed && row.currentNetProfit < 0;
              return (
                <div key={row.month} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex h-32 w-full items-end justify-center gap-1">
                    {row.isBeforeStart ? (
                      // Out of scope: draw a flat baseline instead of real bars.
                      <div
                        className="w-full rounded-t bg-gray-200 dark:bg-white/10"
                        style={{ height: "2%" }}
                        title="ก่อนเริ่มใช้ระบบแบ่งกำไร"
                      />
                    ) : (
                      <>
                        <div
                          className={`w-1/2 rounded-t ${isLoss ? "bg-rose-400 dark:bg-rose-500/70" : "bg-sky-400 dark:bg-sky-500/70"}`}
                          style={{ height: `${isLoss ? 6 : Math.max(profitHeight, 2)}%` }}
                          title={`กำไรสุทธิ ${money(row.currentNetProfit)}`}
                        />
                        <div
                          className="w-1/2 rounded-t bg-emerald-400 dark:bg-emerald-500/70"
                          style={{ height: `${Math.max(distributedHeight, 2)}%` }}
                          title={`แบ่งไป ${money(row.distribution?.distributedAmount ?? 0)}`}
                        />
                      </>
                    )}
                  </div>
                  <span
                    className={`text-[10px] ${
                      row.isBeforeStart
                        ? "text-gray-300 dark:text-slate-600"
                        : "text-gray-500 dark:text-slate-400"
                    }`}
                  >
                    {row.shortLabel}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-sky-400 dark:bg-sky-500/70" />
            กำไรสุทธิ
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-emerald-400 dark:bg-emerald-500/70" />
            ยอดที่แบ่ง
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-rose-400 dark:bg-rose-500/70" />
            เดือนที่ขาดทุน
          </span>
        </div>
      </section>

      <MonthlyTable
        overview={overview.months}
        partners={visiblePartners}
        visiblePartnerIds={visiblePartnerIds}
        canCreate={canCreate}
      />
    </div>
  );
}

type MonthlyTableProps = {
  overview: YearOverviewMonth[];
  partners: PartnerYearSummary[];
  visiblePartnerIds: Set<string>;
  canCreate: boolean;
};

const STATUS_BADGE: Record<MonthStatus, { label: string; className: string }> = {
  BEFORE_START: {
    label: "ก่อนเริ่มใช้ระบบ",
    className: "bg-gray-100 text-gray-400 dark:bg-white/5 dark:text-slate-500",
  },
  OPEN: {
    label: "ยังไม่จบเดือน",
    className: "bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-slate-400",
  },
  DECLARED: {
    label: "ประกาศแล้ว",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200",
  },
  PENDING: {
    label: "ยังไม่ประกาศ",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-400/10 dark:text-amber-200",
  },
  NO_PROFIT: {
    label: "ไม่มีกำไร · รอประกาศ",
    className: "bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-slate-400",
  },
  LOSS: {
    label: "ขาดทุน · รอประกาศ",
    className: "bg-rose-100 text-rose-700 dark:bg-rose-400/10 dark:text-rose-200",
  },
};

const MonthlyTable = ({
  overview,
  partners,
  visiblePartnerIds,
  canCreate,
}: MonthlyTableProps) => {
  const shareOf = (row: YearOverviewMonth, partnerProfileId: string): number | null => {
    const share = row.distribution?.shares.find(
      (item) => item.partnerProfileId === partnerProfileId,
    );
    return share ? share.shareAmount : null;
  };

  return (
    <section className="space-y-3">
      <h2 className="font-kanit text-base font-semibold text-gray-900 dark:text-slate-100">
        สรุปรายเดือน
      </h2>

      {/* Desktop / tablet: full matrix */}
      <div className="hidden rounded-2xl border border-gray-100 bg-white shadow-sm md:block dark:border-white/10 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100 text-sm dark:divide-white/10">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500 dark:bg-slate-950/60 dark:text-slate-400">
              <tr>
                <th className="px-3 py-3">เดือน</th>
                <th className="px-3 py-3 text-right">กำไรสุทธิ</th>
                <th className="px-3 py-3 text-right">ยกมา</th>
                <th className="px-3 py-3 text-right">แบ่งไป</th>
                <th className="px-3 py-3 text-right">กันไว้</th>
                {partners.map((partner) => (
                  <th key={partner.partnerProfileId} className="px-3 py-3 text-right">
                    {partner.name}
                  </th>
                ))}
                <th className="px-3 py-3">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/10">
              {overview.map((row) => {
                const status = getMonthStatus(row);
                const isPending = needsDeclaration(status);
                const rowClass = isPending
                  ? "bg-amber-50/70 dark:bg-amber-400/5"
                  : row.isBeforeStart
                    ? "opacity-60"
                    : "hover:bg-gray-50 dark:hover:bg-white/5";
                return (
                  <tr key={row.month} className={rowClass}>
                    <td
                      className={`px-3 py-3 whitespace-nowrap font-medium ${
                        row.isBeforeStart
                          ? "text-gray-400 dark:text-slate-500"
                          : "text-gray-800 dark:text-slate-100"
                      }`}
                    >
                      {row.shortLabel}
                    </td>
                    <td
                      className={`px-3 py-3 whitespace-nowrap text-right ${
                        row.isBeforeStart
                          ? "text-gray-400 dark:text-slate-500"
                          : row.currentNetProfit < 0
                            ? "text-rose-600 dark:text-rose-300"
                            : "text-gray-700 dark:text-slate-200"
                      }`}
                    >
                      {status === "OPEN" ? "-" : `฿${money(row.currentNetProfit)}`}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-right text-gray-500 dark:text-slate-400">
                      {row.distribution && row.distribution.carryForwardAmount !== 0
                        ? `฿${money(row.distribution.carryForwardAmount)}`
                        : "-"}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-right font-semibold text-emerald-600 dark:text-emerald-300">
                      {row.distribution ? `฿${money(row.distribution.distributedAmount)}` : "-"}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-right text-sky-600 dark:text-sky-300">
                      {row.distribution ? `฿${money(row.distribution.retainedAmount)}` : "-"}
                      {row.distribution?.retainedMode === "CARRY_FORWARD" &&
                      row.distribution.retainedAmount !== 0 ? (
                        <span
                          className="ml-1 text-[10px] text-gray-400 dark:text-slate-500"
                          title="ยอดที่กันไว้ถูกยกไปสมทบฐานที่แบ่งได้ของเดือนถัดไป"
                        >
                          ยกไป
                        </span>
                      ) : null}
                    </td>
                    {partners.map((partner) => {
                      const amount = shareOf(row, partner.partnerProfileId);
                      return (
                        <td
                          key={partner.partnerProfileId}
                          className="px-3 py-3 whitespace-nowrap text-right text-gray-700 dark:text-slate-200"
                        >
                          {amount === null ? "-" : `฿${money(amount)}`}
                        </td>
                      );
                    })}
                    <td className="px-3 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE[status].className}`}
                        >
                          {STATUS_BADGE[status].label}
                        </span>
                        {row.distribution ? (
                          <NavLink
                            href={`/admin/profit-distributions/${row.distribution.id}`}
                            className="font-mono text-xs text-[#1e3a5f] hover:underline dark:text-sky-300"
                          >
                            {row.distribution.distributionNo}
                          </NavLink>
                        ) : null}
                        {isPending && canCreate ? (
                          <NavLink
                            href={`/admin/profit-distributions/new?period=${row.year}-${String(row.month).padStart(2, "0")}`}
                            className="rounded-full bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300"
                          >
                            ประกาศ
                          </NavLink>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile: one card per month so the matrix never scrolls the page sideways */}
      <div className="space-y-3 md:hidden">
        {overview.map((row) => {
          const status = getMonthStatus(row);
          return (
            <div
              key={row.month}
              className={`rounded-2xl border p-4 shadow-sm ${
                needsDeclaration(status)
                  ? "border-amber-200 bg-amber-50 dark:border-amber-400/20 dark:bg-amber-400/5"
                  : row.isBeforeStart
                    ? "border-gray-100 bg-white opacity-60 dark:border-white/10 dark:bg-slate-900"
                    : "border-gray-100 bg-white dark:border-white/10 dark:bg-slate-900"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`font-kanit font-semibold ${
                    row.isBeforeStart
                      ? "text-gray-400 dark:text-slate-500"
                      : "text-gray-900 dark:text-slate-100"
                  }`}
                >
                  {row.label}
                </span>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE[status].className}`}
                >
                  {STATUS_BADGE[status].label}
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-gray-500 dark:text-slate-400">กำไรสุทธิ</dt>
                  <dd
                    className={
                      row.isBeforeStart
                        ? "text-gray-400 dark:text-slate-500"
                        : row.currentNetProfit < 0
                          ? "text-rose-600 dark:text-rose-300"
                          : "text-gray-800 dark:text-slate-100"
                    }
                  >
                    {status === "OPEN" ? "-" : `฿${money(row.currentNetProfit)}`}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500 dark:text-slate-400">แบ่งไป</dt>
                  <dd className="text-emerald-600 dark:text-emerald-300">
                    {row.distribution ? `฿${money(row.distribution.distributedAmount)}` : "-"}
                  </dd>
                </div>
              </dl>
              {row.distribution ? (
                <ul className="mt-3 space-y-1 border-t border-gray-100 pt-3 text-sm dark:border-white/10">
                  {row.distribution.shares
                    .filter((share) => visiblePartnerIds.has(share.partnerProfileId))
                    .map((share) => (
                      <li key={share.partnerProfileId} className="flex justify-between gap-2">
                        <span className="text-gray-600 dark:text-slate-300">
                          {share.partnerName}
                        </span>
                        <span className="text-gray-800 dark:text-slate-100">
                          ฿{money(share.shareAmount)}
                        </span>
                      </li>
                    ))}
                </ul>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {row.distribution ? (
                  <NavLink
                    href={`/admin/profit-distributions/${row.distribution.id}`}
                    className="font-mono text-xs text-[#1e3a5f] hover:underline dark:text-sky-300"
                  >
                    {row.distribution.distributionNo} ·{" "}
                    {formatDateThai(row.distribution.payDate)}
                  </NavLink>
                ) : null}
                {needsDeclaration(status) && canCreate ? (
                  <NavLink
                    href={`/admin/profit-distributions/new?period=${row.year}-${String(row.month).padStart(2, "0")}`}
                    className="rounded-full bg-amber-600 px-3 py-1 text-xs font-medium text-white dark:bg-amber-400 dark:text-slate-950"
                  >
                    ประกาศแบ่งกำไร
                  </NavLink>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
