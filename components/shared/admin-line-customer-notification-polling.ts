export const ADMIN_LINE_NOTIFICATION_POLL_INTERVAL_MS = 5 * 60_000;

type ShouldPollLineCustomerSummaryParams = {
  now: number;
  lastFetchedAt: number;
  isDocumentHidden: boolean;
};

export function shouldPollLineCustomerSummary({
  now,
  lastFetchedAt,
  isDocumentHidden,
}: ShouldPollLineCustomerSummaryParams): boolean {
  if (isDocumentHidden) return false;
  if (lastFetchedAt <= 0) return true;
  return now - lastFetchedAt >= ADMIN_LINE_NOTIFICATION_POLL_INTERVAL_MS;
}
