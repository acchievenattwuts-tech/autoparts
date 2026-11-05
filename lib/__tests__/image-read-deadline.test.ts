import test from "node:test";
import assert from "node:assert/strict";

import {
  IMAGE_READ_DEADLINE_MS,
  IMAGE_READ_HARD_CUTOFF_MS,
  IMAGE_READ_LATE_GRACE_MS,
  IMAGE_READ_MIN_WINDOW_MS,
  raceImageReadDeadline,
  resolveImageReadDeadlineAt,
  resolveImageReadLateGraceUntil,
} from "@/lib/chat-core/image-read-deadline";

const BUDGET_START = 1_000_000;

test("image-read deadline: a single image may be read until 25s after it arrived", () => {
  // Read starts ~6s in (ingest + debounce), as in production.
  const deadline = resolveImageReadDeadlineAt({
    budgetStartMs: BUDGET_START,
    lastMessageAtMs: BUDGET_START,
    readStartMs: BUDGET_START + 6_000,
  });
  assert.equal(deadline, BUDGET_START + IMAGE_READ_DEADLINE_MS);
});

test("image-read deadline: counts 25s from the last message of the burst, up to the hard cutoff", () => {
  // LINE debounces in 5s windows, so the read starts 5–10s after the last message.
  // Before 2026-11-05 every case below got only the 10s minimum window.
  const cases = [
    { lastAt: 8_000, readAt: 15_000, deadline: 33_000 },
    { lastAt: 12_000, readAt: 20_000, deadline: 37_000 },
    { lastAt: 18_000, readAt: 25_000, deadline: IMAGE_READ_HARD_CUTOFF_MS },
  ];
  for (const { lastAt, readAt, deadline } of cases) {
    assert.equal(
      resolveImageReadDeadlineAt({
        budgetStartMs: BUDGET_START,
        lastMessageAtMs: BUDGET_START + lastAt,
        readStartMs: BUDGET_START + readAt,
      }),
      BUDGET_START + deadline,
      `last message at ${lastAt}ms, read at ${readAt}ms`,
    );
  }
});

test("image-read deadline: a last message older than the budget start counts from the budget start", () => {
  // Cron recovery: the budget starts at loop entry, long after the last message.
  const deadline = resolveImageReadDeadlineAt({
    budgetStartMs: BUDGET_START,
    lastMessageAtMs: BUDGET_START - 120_000,
    readStartMs: BUDGET_START + 1_000,
  });
  assert.equal(deadline, BUDGET_START + IMAGE_READ_DEADLINE_MS);

  assert.equal(
    resolveImageReadDeadlineAt({ budgetStartMs: BUDGET_START, lastMessageAtMs: Number.NaN, readStartMs: BUDGET_START }),
    BUDGET_START + IMAGE_READ_DEADLINE_MS,
    "an unreadable timestamp is ignored",
  );
});

test("image-read deadline: a late read still gets the minimum window", () => {
  // 2026-09-23 09:40 case: the final pass started 33.3s in and vision took ~4s.
  // It must still be allowed to answer (33.3s + 10s window, capped at 38s).
  const readStart = BUDGET_START + 33_300;
  const deadline = resolveImageReadDeadlineAt({
    budgetStartMs: BUDGET_START,
    lastMessageAtMs: null,
    readStartMs: readStart,
  });
  assert.equal(deadline, BUDGET_START + IMAGE_READ_HARD_CUTOFF_MS);
  assert.ok(readStart + 4_000 < deadline, "a 4s read that starts at 33.3s still fits");

  const midStart = BUDGET_START + 20_000;
  assert.equal(
    resolveImageReadDeadlineAt({ budgetStartMs: BUDGET_START, lastMessageAtMs: null, readStartMs: midStart }),
    midStart + IMAGE_READ_MIN_WINDOW_MS,
  );
});

test("image-read deadline: never later than the hard cutoff, even when the read starts past it", () => {
  const deadline = resolveImageReadDeadlineAt({
    budgetStartMs: BUDGET_START,
    lastMessageAtMs: BUDGET_START + 40_000,
    readStartMs: BUDGET_START + 44_000,
  });
  assert.equal(deadline, BUDGET_START + IMAGE_READ_HARD_CUTOFF_MS);
});

test("image-read deadline: the late-read grace ends 50s after the budget start", () => {
  assert.equal(resolveImageReadLateGraceUntil(BUDGET_START), BUDGET_START + IMAGE_READ_LATE_GRACE_MS);
  assert.ok(IMAGE_READ_LATE_GRACE_MS < 60_000, "grace ends before the 60s function limit");
});

test("raceImageReadDeadline: a read that finishes in time returns its value", async () => {
  const result = await raceImageReadDeadline(Promise.resolve("part"), Date.now() + 1_000);
  assert.deepEqual(result, { timedOut: false, value: "part" });
});

test("raceImageReadDeadline: a read that does not finish in time times out and keeps running", async () => {
  let finish: (value: string) => void = () => undefined;
  const task = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const started = Date.now();
  const result = await raceImageReadDeadline(task, Date.now() + 30);
  assert.deepEqual(result, { timedOut: true });
  assert.ok(Date.now() - started < 1_000, "returns at the deadline, not when the task ends");

  finish("slip");
  assert.equal(await task, "slip", "the task is not cancelled");
});

test("raceImageReadDeadline: a deadline already in the past times out at once", async () => {
  const never = new Promise<string>(() => undefined);
  const result = await raceImageReadDeadline(never, Date.now() - 1);
  assert.deepEqual(result, { timedOut: true });
});
