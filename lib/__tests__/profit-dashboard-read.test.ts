import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  createProfitDashboardReadLimiter,
  runAdminDashboardRead,
  runProfitDashboardRead,
} from "@/lib/profit-dashboard-read";

test("shared dashboard read limiter caps combined concurrency without changing results", async () => {
  let activeReads = 0;
  let peakReads = 0;
  const releaseReads: Array<() => void> = [];
  const retryCalls: number[] = [];
  const limiter = createProfitDashboardReadLimiter(4, async (operation) => {
    retryCalls.push(retryCalls.length);
    return operation();
  });

  const labels = [
    ...Array.from({ length: 16 }, (_, index) => `daily-${index}`),
    ...Array.from({ length: 7 }, (_, index) => `profit-${index}`),
  ];
  const reads = labels.map((label) =>
    limiter(async () => {
      activeReads += 1;
      peakReads = Math.max(peakReads, activeReads);
      await new Promise<void>((resolve) => {
        releaseReads.push(resolve);
      });
      activeReads -= 1;
      return label;
    }),
  );

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(peakReads, 4);
  assert.equal(releaseReads.length, 4);

  while (releaseReads.length > 0) {
    releaseReads.shift()?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  assert.deepEqual(await Promise.all(reads), labels);
  assert.equal(retryCalls.length, labels.length);
  assert.equal(peakReads, 4);
});

test("daily and profit dashboard reads use the same limiter instance", () => {
  assert.equal(runProfitDashboardRead, runAdminDashboardRead);

  const dailySource = readFileSync(
    resolve(
      process.cwd(),
      "app/admin/(protected)/DailyOperationsDashboard.tsx",
    ),
    "utf8",
  );
  const profitSource = readFileSync(
    resolve(process.cwd(), "lib/profit-dashboard.ts"),
    "utf8",
  );
  const dailyDbReads = dailySource.match(
    /\bdb\.[A-Za-z]+\.(?:aggregate|count|findMany|groupBy)\(/g,
  );
  const profitDbReads = profitSource.match(
    /\bdb\.factProfit\.(?:aggregate|findMany|groupBy)\(/g,
  );

  assert.equal(dailyDbReads?.length, 17);
  assert.equal(
    dailySource.match(/runAdminDashboardRead\(\(\) =>\s*db\./g)?.length,
    17,
  );
  assert.equal(profitDbReads?.length, 14);
  assert.equal(
    profitSource.match(/runAdminDashboardRead\(\(\) =>\s*db\.factProfit\./g)
      ?.length,
    14,
  );
});

test("profit dashboard read limiter releases a slot after a failed read", async () => {
  const limiter = createProfitDashboardReadLimiter(1, async (operation) =>
    operation(),
  );
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
