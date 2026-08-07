import test from "node:test";
import assert from "node:assert/strict";

import {
  ADMIN_LINE_NOTIFICATION_POLL_INTERVAL_MS,
  shouldPollLineCustomerSummary,
} from "../admin-line-customer-notification-polling";

// Raised from 5 to 10 minutes in ba1097e to cut notification DB/API traffic.
// The elapsed-time cases below derive their clock from the constant so a future
// interval change can never leave this suite asserting a stale number again.
const INTERVAL = ADMIN_LINE_NOTIFICATION_POLL_INTERVAL_MS;

test("uses a ten-minute poll interval", () => {
  assert.equal(ADMIN_LINE_NOTIFICATION_POLL_INTERVAL_MS, 10 * 60_000);
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
      now: 1_000 + INTERVAL,
      lastFetchedAt: 1_000,
      isDocumentHidden: true,
    }),
    false,
  );
});

test("polls again once the visible document is past the interval", () => {
  assert.equal(
    shouldPollLineCustomerSummary({
      now: 1_000 + INTERVAL,
      lastFetchedAt: 1_000,
      isDocumentHidden: false,
    }),
    true,
  );
});

test("does not poll again before the interval elapses", () => {
  assert.equal(
    shouldPollLineCustomerSummary({
      now: 1_000 + INTERVAL - 1,
      lastFetchedAt: 1_000,
      isDocumentHidden: false,
    }),
    false,
  );
});
