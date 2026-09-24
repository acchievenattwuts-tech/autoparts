import assert from "node:assert/strict";
import test, { before, mock } from "node:test";

import { Prisma } from "@/lib/generated/prisma";

// The production rawEvent clear must only NULL the rawEvent column (text and the
// row itself are kept), only for rows older than the cutoff that still have one,
// and fetch just ids per batch.

type FindManyArgs = {
  where: { createdAt: { lt: Date }; rawEvent: { not: unknown } };
  select: Record<string, boolean>;
  take: number;
};
type UpdateManyArgs = { where: { id: { in: string[] } }; data: Record<string, unknown> };

const findCalls: FindManyArgs[] = [];
const updateCalls: UpdateManyArgs[] = [];
let pending = ["m1", "m2", "m3"];

before(async () => {
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        lineMessage: {
          findMany: async (args: FindManyArgs) => {
            findCalls.push(args);
            return pending.slice(0, args.take).map((id) => ({ id }));
          },
          updateMany: async (args: UpdateManyArgs) => {
            updateCalls.push(args);
            pending = pending.filter((id) => !args.where.id.in.includes(id));
            return { count: args.where.id.in.length };
          },
          deleteMany: async () => {
            throw new Error("LineMessage rows must never be deleted");
          },
        },
        lineAiAuditLog: { deleteMany: async () => ({ count: 0 }) },
        lineAiJob: { deleteMany: async () => ({ count: 0 }) },
        lineAiSuggestion: { deleteMany: async () => ({ count: 0 }) },
      },
    },
  });
});

test("the daily cleanup clears rawEvent (to SQL NULL) older than 90 days and keeps the rows", async () => {
  const { cleanupLineAiRetention } = await import("@/lib/line-ai-retention-service");
  const now = new Date("2026-09-24T05:00:00.000Z");

  const summary = await cleanupLineAiRetention({ now });

  assert.equal(summary.clearedLineMessageRawEvents, 3);
  assert.equal(findCalls.length, 1);
  assert.deepEqual(findCalls[0].where.createdAt, { lt: new Date("2026-06-26T05:00:00.000Z") });
  assert.equal(findCalls[0].where.rawEvent.not, Prisma.DbNull);
  assert.deepEqual(findCalls[0].select, { id: true });
  assert.equal(findCalls[0].take, 500);

  assert.equal(updateCalls.length, 1);
  assert.deepEqual(updateCalls[0].where, { id: { in: ["m1", "m2", "m3"] } });
  assert.deepEqual(Object.keys(updateCalls[0].data), ["rawEvent"]);
  assert.equal(updateCalls[0].data.rawEvent, Prisma.DbNull);
});
