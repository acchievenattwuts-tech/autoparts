/**
 * Baseline measurement for the admin navigation auth overhead.
 *
 * Read-only. Times the two DB round-trips that every admin navigation pays
 * before the page's own data query starts:
 *
 *   Q1  auth.config.ts jwt() session-revocation + permission refresh
 *       -> runs once per auth() call (proxy.ts, layout.tsx, requirePermission)
 *   Q2  lib/access-control.ts getUserPermissionKeys()
 *       -> runs once per requirePermission() call, returning the same data
 *          the jwt callback just put on the session token
 *
 * Usage: npm run measure:admin-auth-baseline
 */
import { db } from "../lib/db";

const ITERATIONS = 12;
const WARMUP_ITERATIONS = 2;

type Sample = { label: string; timings: number[] };

const percentile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
};

const summarize = ({ label, timings }: Sample) => {
  const sorted = [...timings].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  return {
    label,
    min: sorted[0] ?? 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1] ?? 0,
    avg: sorted.length > 0 ? sum / sorted.length : 0,
  };
};

const time = async (fn: () => Promise<unknown>): Promise<number> => {
  const startedAt = performance.now();
  await fn();
  return performance.now() - startedAt;
};

/** Mirrors the jwt() callback query in auth.config.ts. */
const runJwtCallbackQuery = (userId: string) =>
  db.user.findUnique({
    where: { id: userId },
    select: {
      authVersion: true,
      isActive: true,
      role: true,
      appRole: {
        select: {
          permissions: { select: { permission: { select: { key: true } } } },
        },
      },
      directPermissionGrants: {
        select: { permission: { select: { key: true } } },
      },
    },
  });

/** Mirrors getUserPermissionKeys() in lib/access-control.ts. */
const runPermissionKeysQuery = (userId: string) =>
  db.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      appRole: {
        select: {
          permissions: { select: { permission: { select: { key: true } } } },
        },
      },
      directPermissionGrants: {
        select: { permission: { select: { key: true } } },
      },
    },
  });

const main = async (): Promise<void> => {
  const user = await db.user.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, appRoleId: true },
  });

  if (!user) {
    console.error("No active user found — cannot measure.");
    process.exitCode = 1;
    return;
  }

  console.log("=== Admin auth baseline ===");
  console.log(`user role: ${user.role} | appRole: ${user.appRoleId ? "yes" : "none"}`);
  console.log(`iterations: ${ITERATIONS} (after ${WARMUP_ITERATIONS} warmup)\n`);

  for (let i = 0; i < WARMUP_ITERATIONS; i += 1) {
    await runJwtCallbackQuery(user.id);
    await runPermissionKeysQuery(user.id);
  }

  const jwtTimings: number[] = [];
  const permissionTimings: number[] = [];

  for (let i = 0; i < ITERATIONS; i += 1) {
    jwtTimings.push(await time(() => runJwtCallbackQuery(user.id)));
    permissionTimings.push(await time(() => runPermissionKeysQuery(user.id)));
  }

  const jwtStats = summarize({ label: "Q1 jwt() revocation+permission", timings: jwtTimings });
  const permissionStats = summarize({ label: "Q2 getUserPermissionKeys()", timings: permissionTimings });

  for (const stats of [jwtStats, permissionStats]) {
    console.log(
      `${stats.label.padEnd(34)} min ${stats.min.toFixed(1)}ms | p50 ${stats.p50.toFixed(1)}ms | p95 ${stats.p95.toFixed(1)}ms | max ${stats.max.toFixed(1)}ms`,
    );
  }

  // Per navigation today: proxy auth() + requirePermission auth() = 2x Q1, plus 1x Q2.
  // The admin layout adds a third Q1 whenever it re-renders.
  const currentMin = jwtStats.p50 * 2 + permissionStats.p50;
  const currentWithLayout = jwtStats.p50 * 3 + permissionStats.p50;
  // After request-scoped dedupe: one Q1, Q2 dropped (session already carries the keys).
  const dedupedCost = jwtStats.p50;

  console.log("\n--- per admin navigation (p50) ---");
  console.log(`now (proxy + requirePermission)      : ${currentMin.toFixed(1)}ms  [2x Q1 + 1x Q2]`);
  console.log(`now (+ layout re-render)             : ${currentWithLayout.toFixed(1)}ms  [3x Q1 + 1x Q2]`);
  console.log(`after request-scoped dedupe          : ${dedupedCost.toFixed(1)}ms  [1x Q1]`);
  console.log(
    `saving                               : ${(currentMin - dedupedCost).toFixed(1)}ms – ${(currentWithLayout - dedupedCost).toFixed(1)}ms per click`,
  );
};

main()
  .catch((error: unknown) => {
    console.error("measurement failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
