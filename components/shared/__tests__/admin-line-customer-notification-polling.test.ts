import test from "node:test";
import assert from "node:assert/strict";

import {
  ADMIN_LINE_NOTIFICATION_POLL_INTERVAL_MS,
  shouldPollLineCustomerSummary,
} from "../admin-line-customer-notification-polling";

test("uses a five-minute poll interval", () => {
  assert.equal(ADMIN_LINE_NOTIFICATION_POLL_INTERVAL_MS, 5 * 60_000);
});

test("polls immediately when there has never been a successful fetch", () => {
  assert.equal(
    shouldPollLineCustomerSummary({
      now: 1_000,
      lastFetchedAt: 0,
      isDocumentHidden: false,
    }),
    true,
  );
});

test("does not poll on the timer while the document is hidden", () => {
  assert.equal(
    shouldPollLineCustomerSummary({
      now: 10 * 60_000,
      lastFetchedAt: 1_000,
      isDocumentHidden: true,
    }),
    false,
  );
});

test("polls again once the visible document is past the interval", () => {
  assert.equal(
    shouldPollLineCustomerSummary({
      now: 10 * 60_000,
      lastFetchedAt: 1_000,
      isDocumentHidden: false,
    }),
    true,
  );
});

test("does not poll again before the interval elapses", () => {
  assert.equal(
    shouldPollLineCustomerSummary({
      now: 60_000,
      lastFetchedAt: 1_000,
      isDocumentHidden: false,
    }),
    false,
  );
});
