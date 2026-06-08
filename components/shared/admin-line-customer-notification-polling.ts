import {
  ADMIN_NOTIFICATION_SUMMARY_POLL_INTERVAL_MS,
  shouldPollNotificationSummary,
} from "@/components/shared/admin-notification-center-utils";

export const ADMIN_LINE_NOTIFICATION_POLL_INTERVAL_MS = ADMIN_NOTIFICATION_SUMMARY_POLL_INTERVAL_MS;

type ShouldPollLineCustomerSummaryParams = {
  now: number;
  lastFetchedAt: number;
  isDocumentHidden: boolean;
};

export function shouldPollLineCustomerSummary(params: ShouldPollLineCustomerSummaryParams): boolean {
  return shouldPollNotificationSummary(params);
}
