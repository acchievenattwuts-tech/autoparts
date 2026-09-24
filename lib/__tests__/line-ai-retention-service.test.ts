import test from "node:test";
import assert from "node:assert/strict";

import { cleanupLineAiRetention } from "../line-ai-retention-service";
import { LineAiJobStatus } from "../generated/prisma";

test("cleanupLineAiRetention applies the configured retention windows per table and status", async () => {
  const now = new Date("2026-06-10T05:00:00.000Z");
  const calls: Array<{ kind: string; cutoff: Date; statuses?: LineAiJobStatus[] }> = [];

  const summary = await cleanupLineAiRetention({
    now,
    deleteAuditLogsOlderThan: async (cutoff) => {
      calls.push({ kind: "audit", cutoff });
      return 11;
    },
    deleteJobsOlderThan: async (statuses, cutoff) => {
      calls.push({ kind: "job", statuses, cutoff });
      return statuses.includes(LineAiJobStatus.FAILED) ? 2 : 7;
    },
    deleteSuggestionsOlderThan: async (cutoff) => {
      calls.push({ kind: "suggestion", cutoff });
      return 5;
    },
    clearLineMessageRawEventsOlderThan: async (cutoff) => {
      calls.push({ kind: "rawEvent", cutoff });
      return 3;
    },
  });

  assert.equal(calls.length, 5);
  assert.deepEqual(calls[0], {
    kind: "audit",
    cutoff: new Date("2026-04-11T05:00:00.000Z"),
  });
  assert.deepEqual(calls[1], {
    kind: "job",
    statuses: [LineAiJobStatus.COMPLETED, LineAiJobStatus.SKIPPED],
    cutoff: new Date("2026-05-11T05:00:00.000Z"),
  });
  assert.deepEqual(calls[2], {
    kind: "job",
    statuses: [LineAiJobStatus.FAILED],
    cutoff: new Date("2026-04-11T05:00:00.000Z"),
  });
  assert.deepEqual(calls[3], {
    kind: "suggestion",
    cutoff: new Date("2026-04-11T05:00:00.000Z"),
  });

  // LineMessage text is kept forever; only rawEvent older than 90 days is cleared.
  assert.deepEqual(calls[4], {
    kind: "rawEvent",
    cutoff: new Date("2026-03-12T05:00:00.000Z"),
  });

  assert.deepEqual(summary, {
    deletedAuditLogs: 11,
    deletedJobsCompletedOrSkipped: 7,
    deletedJobsFailed: 2,
    deletedSuggestions: 5,
    clearedLineMessageRawEvents: 3,
  });
});

test("rawEvent clear runs in batches until a short batch", async () => {
  const { clearLineMessageRawEventsInBatches } = await import("../line-ai-retention-service");
  const cutoff = new Date("2026-03-12T05:00:00.000Z");
  let remaining = 1_250;
  const takes: number[] = [];
  const cutoffs: Date[] = [];

  const result = await clearLineMessageRawEventsInBatches(cutoff, {
    batchSize: 500,
    findIdsWithRawEvent: async (olderThan, take) => {
      cutoffs.push(olderThan);
      takes.push(take);
      const count = Math.min(take, remaining);
      return Array.from({ length: count }, (_, index) => `m-${remaining - index}`);
    },
    clearRawEvent: async (ids) => {
      remaining -= ids.length;
      return ids.length;
    },
  });

  assert.deepEqual(result, { cleared: 1_250, batches: 3, capped: false });
  assert.deepEqual(takes, [500, 500, 500]);
  assert.ok(cutoffs.every((value) => value === cutoff));
});

test("rawEvent clear stops at the per-run batch cap and reports it", async () => {
  const { clearLineMessageRawEventsInBatches } = await import("../line-ai-retention-service");
  let finds = 0;

  const result = await clearLineMessageRawEventsInBatches(new Date(), {
    batchSize: 10,
    maxBatches: 3,
    findIdsWithRawEvent: async (_cutoff, take) => {
      finds += 1;
      return Array.from({ length: take }, (_, index) => `m-${finds}-${index}`);
    },
    clearRawEvent: async (ids) => ids.length,
  });

  assert.deepEqual(result, { cleared: 30, batches: 3, capped: true });
  assert.equal(finds, 3);
});

test("rawEvent clear stops when the time budget is spent", async () => {
  const { clearLineMessageRawEventsInBatches } = await import("../line-ai-retention-service");
  let clock = 0;

  const result = await clearLineMessageRawEventsInBatches(new Date(), {
    batchSize: 10,
    maxBatches: 100,
    timeBudgetMs: 1_000,
    nowMs: () => clock,
    findIdsWithRawEvent: async (_cutoff, take) => Array.from({ length: take }, (_, index) => `m-${index}`),
    clearRawEvent: async (ids) => {
      clock += 400;
      return ids.length;
    },
  });

  assert.deepEqual(result, { cleared: 30, batches: 3, capped: true });
});

test("rawEvent clear with nothing old left does no update", async () => {
  const { clearLineMessageRawEventsInBatches } = await import("../line-ai-retention-service");
  let updates = 0;

  const result = await clearLineMessageRawEventsInBatches(new Date(), {
    findIdsWithRawEvent: async () => [],
    clearRawEvent: async () => {
      updates += 1;
      return 0;
    },
  });

  assert.deepEqual(result, { cleared: 0, batches: 0, capped: false });
  assert.equal(updates, 0);
});
