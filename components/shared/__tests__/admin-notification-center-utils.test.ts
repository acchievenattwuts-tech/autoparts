import test from "node:test";
import assert from "node:assert/strict";

import {
  ADMIN_NOTIFICATION_SUMMARY_POLL_INTERVAL_MS,
  aggregateUnreadCounts,
  shouldPollNotificationSummary,
} from "../admin-notification-center-utils";

test("uses a five-minute summary poll interval for shared notification sources", () => {
  assert.equal(ADMIN_NOTIFICATION_SUMMARY_POLL_INTERVAL_MS, 5 * 60_000);
});

test("aggregates unread counts across all registered notification sources", () => {
  assert.equal(aggregateUnreadCounts([0, 3, 5, 1]), 9);
});

test("does not allow aggregated unread counts to go below zero", () => {
  assert.equal(aggregateUnreadCounts([4, -3, -9]), 0);
});

test("polls shared notification sources immediately when they never fetched before", () => {
  assert.equal(
    shouldPollNotificationSummary({
      now: 1_000,
      lastFetchedAt: 0,
      isDocumentHidden: false,
    }),
    true,
  );
});

test("does not poll shared notification sources while the document is hidden", () => {
  assert.equal(
    shouldPollNotificationSummary({
      now: 10 * 60_000,
      lastFetchedAt: 1_000,
      isDocumentHidden: true,
    }),
    false,
  );
});

test("polls shared notification sources again once the interval elapses", () => {
  assert.equal(
    shouldPollNotificationSummary({
      now: 10 * 60_000,
      lastFetchedAt: 1_000,
      isDocumentHidden: false,
    }),
    true,
  );
});

test("does not poll shared notification sources before the interval elapses", () => {
  assert.equal(
    shouldPollNotificationSummary({
      now: 60_000,
      lastFetchedAt: 1_000,
      isDocumentHidden: false,
    }),
    false,
  );
});
