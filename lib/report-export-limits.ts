export const GENERAL_REPORT_EXPORT_ROW_LIMIT = 10_000;

const CAPPED_GENERAL_REPORT_TYPES = new Set([
  "sales",
  "purchases",
  "credit-notes",
  "daily-receipt",
  "daily-payment",
]);

export function getReportExportRowLimit(type: string): number | null {
  return CAPPED_GENERAL_REPORT_TYPES.has(type)
    ? GENERAL_REPORT_EXPORT_ROW_LIMIT
    : null;
}
