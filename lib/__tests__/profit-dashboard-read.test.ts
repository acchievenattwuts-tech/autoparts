import assert from "node:assert/strict";
import test from "node:test";

import { createProfitDashboardReadLimiter } from "@/lib/profit-dashboard-read";

test("profit dashboard read limiter caps concurrency without changing results", async () => {
  let activeReads = 0;
  let peakReads = 0;
  const releaseReads: Array<() => void> = [];
  const retryCalls: number[] = [];
  const limiter = createProfitDashboardReadLimiter(4, async (operation) => {
    retryCalls.push(retryCalls.length);
    return operation();
  });

  const reads = Array.from({ length: 7 }, (_, index) =>
    limiter(async () => {
      activeReads += 1;
      peakReads = Math.max(peakReads, activeReads);
      await new Promise<void>((resolve) => {
        releaseReads.push(resolve);
      });
      activeReads -= 1;
      return `result-${index}`;
    }),
  );

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(peakReads, 4);
  assert.equal(releaseReads.length, 4);

  while (releaseReads.length > 0) {
    releaseReads.shift()?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  assert.deepEqual(
    await Promise.all(reads),
    Array.from({ length: 7 }, (_, index) => `result-${index}`),
  );
  assert.equal(retryCalls.length, 7);
  assert.equal(peakReads, 4);
});

test("profit dashboard read limiter releases a slot after a failed read", async () => {
  const limiter = createProfitDashboardReadLimiter(1, async (operation) => operation());
  const first = limiter(async () => {
    throw new Error("read failed");
  });
  const second = limiter(async () => "recovered");

  await assert.rejects(first, /read failed/);
  assert.equal(await second, "recovered");
});

test("profit dashboard read limiter delegates retry behavior", async () => {
  let retryAttempts = 0;
  const limiter = createProfitDashboardReadLimiter(1, async (operation) => {
    try {
      return await operation();
    } catch {
      retryAttempts += 1;
      return operation();
    }
  });
  let operationAttempts = 0;

  const result = await limiter(async () => {
    operationAttempts += 1;
    if (operationAttempts === 1) throw new Error("transient");
    return "same-result";
  });

  assert.equal(result, "same-result");
  assert.equal(operationAttempts, 2);
  assert.equal(retryAttempts, 1);
});
