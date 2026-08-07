import test from "node:test";
import assert from "node:assert/strict";

import {
  ADMIN_NOTIFICATION_SUMMARY_POLL_INTERVAL_MS,
  aggregateUnreadCounts,
  shouldPollNotificationSummary,
} from "../admin-notification-center-utils";

// Raised from 5 to 10 minutes in ba1097e to cut notification DB/API traffic.
// The elapsed-time cases below derive their clock from the constant so a future
// interval change can never leave this suite asserting a stale number again.
const INTERVAL = ADMIN_NOTIFICATION_SUMMARY_POLL_INTERVAL_MS;

test("uses a ten-minute summary poll interval for shared notification sources", () => {
  assert.equal(ADMIN_NOTIFICATION_SUMMARY_POLL_INTERVAL_MS, 10 * 60_000);
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
      now: 1_000 + INTERVAL,
      lastFetchedAt: 1_000,
      isDocumentHidden: true,
    }),
    false,
  );
});

test("polls shared notification sources again once the interval elapses", () => {
  assert.equal(
    shouldPollNotificationSummary({
      now: 1_000 + INTERVAL,
      lastFetchedAt: 1_000,
      isDocumentHidden: false,
    }),
    true,
  );
});

test("does not poll shared notification sources before the interval elapses", () => {
  assert.equal(
    shouldPollNotificationSummary({
      now: 1_000 + INTERVAL - 1,
      lastFetchedAt: 1_000,
      isDocumentHidden: false,
    }),
    false,
  );
});
