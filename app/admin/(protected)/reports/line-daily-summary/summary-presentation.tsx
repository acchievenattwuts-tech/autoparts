/**
 * Presentation helpers shared by the LINE daily-summary page shell and the two
 * Suspense-streamed sections (stat cards + Flex preview).
 */

export function StatCard({
  title,
  value,
  tone = "default",
}: {
  title: string;
  value: string;
  tone?: "default" | "warn";
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        tone === "warn"
          ? "border-amber-200 bg-amber-50 dark:border-amber-400/30 dark:bg-amber-500/15"
          : "border-gray-200 bg-white dark:border-white/10 dark:bg-slate-950/80"
      }`}
    >
      <p className="text-xs font-medium text-gray-500 dark:text-slate-400">{title}</p>
      <p className="mt-1 font-kanit text-xl font-bold text-gray-900 dark:text-slate-100">{value}</p>
    </div>
  );
}

export function fmtMoney(value: number) {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function fmtPercent(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0;

  return safeValue.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function PreviewMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-white/10 dark:bg-white/5">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 font-kanit text-lg font-semibold text-slate-900 dark:text-slate-100">{value}</p>
    </div>
  );
}

export function FlexPreviewSection({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle?: string;
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {subtitle ? <p className="mt-1 text-xs text-slate-400">{subtitle}</p> : null}
      <div className="mt-3 space-y-2">
        {items.map((item) => (
          <div
            key={`${title}-${item.label}`}
            className="flex items-start justify-between gap-4 border-b border-slate-100 pb-2 text-sm last:border-b-0 last:pb-0"
          >
            <span className="text-slate-500">{item.label}</span>
            <span className="text-right font-semibold text-slate-900">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function keepPreviewItem(compactMode: boolean, rawValue: number, keepWhenZero = false) {
  if (!compactMode) return true;
  if (keepWhenZero) return true;
  return rawValue !== 0;
}
