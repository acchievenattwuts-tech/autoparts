import { withDbRetry } from "@/lib/db";

const PROFIT_DASHBOARD_MAX_CONCURRENT_READS = 4;

type ReadOperation = <T>(operation: () => Promise<T>) => Promise<T>;

/**
 * Keep Profit Dashboard cache refreshes from occupying the whole per-instance
 * Prisma pool. Waiting jobs stay in-process and start as soon as an earlier read
 * finishes, so this limits peak pressure without changing query results.
 */
export function createProfitDashboardReadLimiter(
  maxConcurrent: number,
  runRead: ReadOperation,
): ReadOperation {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new Error("maxConcurrent must be a positive integer");
  }

  let activeReads = 0;
  const waiters: Array<() => void> = [];

  return async <T>(operation: () => Promise<T>): Promise<T> => {
    if (activeReads >= maxConcurrent) {
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
    }

    activeReads += 1;
    try {
      return await runRead(operation);
    } finally {
      activeReads -= 1;
      waiters.shift()?.();
    }
  };
}

export const runProfitDashboardRead = createProfitDashboardReadLimiter(
  PROFIT_DASHBOARD_MAX_CONCURRENT_READS,
  withDbRetry,
);
