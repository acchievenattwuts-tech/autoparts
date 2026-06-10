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
  });

  assert.equal(calls.length, 4);
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

  assert.deepEqual(summary, {
    deletedAuditLogs: 11,
    deletedJobsCompletedOrSkipped: 7,
    deletedJobsFailed: 2,
    deletedSuggestions: 5,
  });
});
