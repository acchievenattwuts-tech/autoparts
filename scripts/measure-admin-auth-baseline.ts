/**
 * Baseline measurement for the admin navigation auth overhead.
 *
 * Read-only. Times the two DB round-trips that every admin navigation pays
 * before the page's own data query starts:
 *
 *   legacy  Previous jwt() relation refresh, retained here only as a read-only
 *           comparison baseline.
 *   current Current jwt() scalar revocation check.
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

/** Mirrors the relation-heavy jwt() query before the scalar revision change. */
const runLegacyJwtCallbackQuery = (userId: string) =>
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

/** Mirrors the current jwt() callback query in auth.config.ts. */
const runJwtCallbackQuery = (userId: string) =>
  db.user.findUnique({
    where: { id: userId },
    select: {
      authVersion: true,
      isActive: true,
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
    await runLegacyJwtCallbackQuery(user.id);
    await runJwtCallbackQuery(user.id);
  }

  const legacyTimings: number[] = [];
  const jwtTimings: number[] = [];

  for (let i = 0; i < ITERATIONS; i += 1) {
    legacyTimings.push(await time(() => runLegacyJwtCallbackQuery(user.id)));
    jwtTimings.push(await time(() => runJwtCallbackQuery(user.id)));
  }

  const legacyStats = summarize({ label: "legacy jwt() relations", timings: legacyTimings });
  const jwtStats = summarize({ label: "current jwt() scalar revision", timings: jwtTimings });

  for (const stats of [legacyStats, jwtStats]) {
    console.log(
      `${stats.label.padEnd(34)} min ${stats.min.toFixed(1)}ms | p50 ${stats.p50.toFixed(1)}ms | p95 ${stats.p95.toFixed(1)}ms | max ${stats.max.toFixed(1)}ms`,
    );
  }

  const saving = legacyStats.p50 - jwtStats.p50;
  console.log(`\np50 saving per auth() call: ${saving.toFixed(1)}ms (${((saving / legacyStats.p50) * 100).toFixed(1)}%)`);
};

main()
  .catch((error: unknown) => {
    console.error("measurement failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
