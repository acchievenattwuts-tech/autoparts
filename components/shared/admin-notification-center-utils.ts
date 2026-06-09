export const ADMIN_NOTIFICATION_SUMMARY_POLL_INTERVAL_MS = 10 * 60_000;

type ShouldPollNotificationSummaryParams = {
  now: number;
  lastFetchedAt: number;
  isDocumentHidden: boolean;
};

export function shouldPollNotificationSummary({
  now,
  lastFetchedAt,
  isDocumentHidden,
}: ShouldPollNotificationSummaryParams): boolean {
  if (isDocumentHidden) return false;
  if (lastFetchedAt <= 0) return true;
  return now - lastFetchedAt >= ADMIN_NOTIFICATION_SUMMARY_POLL_INTERVAL_MS;
}

export function aggregateUnreadCounts(counts: readonly number[]): number {
  return Math.max(
    0,
    counts.reduce((total, count) => total + count, 0),
  );
}
