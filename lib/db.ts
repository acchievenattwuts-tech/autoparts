import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Supabase pooler (Supavisor) caps total client connections at 200. With the
// transaction pooler (port 6543, pgbouncer) each query checks out a server
// connection only for its transaction, so a small per-instance pool is enough —
// 15 let ~13 warm instances exhaust the 200 limit and 500 the whole site under a
// bot crawl of the /product detail pages (cache misses fan out across instances).
// 5 raises that ceiling to ~40 instances
// while still giving each instance headroom for concurrent saves/recalcs (a
// purchase save/edit holds exactly one connection for its whole transaction).
const DEFAULT_DB_POOL_MAX = 5;
const DEFAULT_DB_IDLE_TIMEOUT_MS = 10_000;
const DEFAULT_DB_CONNECTION_TIMEOUT_MS = 45_000; // let short Supabase pool bursts drain before failing

let hasWarnedAboutSupabaseSessionPooler = false;

const getPositiveNumber = (value: string | undefined, fallback: number, min: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, parsed) : fallback;
};

const isServerlessRuntime = (): boolean =>
  Boolean(process.env.VERCEL || process.env.AWS_EXECUTION_ENV || process.env.LAMBDA_TASK_ROOT);

const normalizeDatabaseUrl = (rawUrl: string | undefined): string => {
  if (!rawUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  const isSupabasePoolerHost =
    parsedUrl.hostname.endsWith(".pooler.supabase.com") || parsedUrl.hostname.endsWith(".pooler.supabase.in");
  const shouldAutoSwitchToTransactionPool =
    isServerlessRuntime() &&
    isSupabasePoolerHost &&
    parsedUrl.port === "5432" &&
    process.env.SUPABASE_POOLER_MODE !== "session";

  if (!shouldAutoSwitchToTransactionPool) {
    return rawUrl;
  }

  parsedUrl.port = "6543";
  if (!parsedUrl.searchParams.has("pgbouncer")) {
    parsedUrl.searchParams.set("pgbouncer", "true");
  }

  if (!hasWarnedAboutSupabaseSessionPooler) {
    hasWarnedAboutSupabaseSessionPooler = true;
    console.warn(
      "DATABASE_URL points to the Supabase session pooler (5432) in a serverless runtime. " +
        "Prisma is automatically switching to the transaction pooler (6543) with pgbouncer=true. " +
        "Update the production DATABASE_URL to the transaction pooler to avoid connection exhaustion.",
    );
  }

  return parsedUrl.toString();
};

function createPrismaClient() {
  const connectionLimit = getPositiveNumber(process.env.DB_POOL_MAX, DEFAULT_DB_POOL_MAX, 1);
  const idleTimeoutMillis = getPositiveNumber(process.env.DB_IDLE_TIMEOUT_MS, DEFAULT_DB_IDLE_TIMEOUT_MS, 1_000);
  const connectionTimeoutMillis = getPositiveNumber(
    process.env.DB_CONNECTION_TIMEOUT_MS,
    DEFAULT_DB_CONNECTION_TIMEOUT_MS,
    5_000,
  );
  const connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);

  // Pass PoolConfig directly to avoid type conflict between pg versions
  const adapter = new PrismaPg({
    connectionString,
    max: connectionLimit,
    idleTimeoutMillis,
    connectionTimeoutMillis,
  });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const db = globalForPrisma.prisma ?? createPrismaClient();

// Cache in all environments — serverless instances reuse the same module context
// when warm, avoiding connection churn. Each cold start gets a fresh instance anyway.
globalForPrisma.prisma = db;

// Supabase statement_timeout = 2min (120s). TX_TIMEOUT must stay under that.
// For normal routes (maxDuration=60s) this is still the effective ceiling.
// For stock/bf (maxDuration=180s), multiple sequential transactions can each use up to 110s.
const TX_TIMEOUT = 110_000; // 110s — safely under Supabase 120s statement_timeout

// Per-transaction guardrails (Supabase ships with both disabled: 0).
//  - lock_timeout: a statement waiting longer than this on a row lock fails
//    fast instead of hanging until the whole-transaction timeout. Turns
//    concurrent-save contention (e.g. a double-submitted edit form competing
//    for the same `Product` FOR UPDATE lock) into a quick, logged error rather
//    than a 180s stall that Vercel may kill before any log is flushed.
//  - idle_in_transaction_session_timeout: if a serverless function instance is
//    frozen/recycled mid-transaction, Postgres aborts the orphaned session and
//    releases its locks, so later writes on the same rows stop blocking forever.
const TX_LOCK_TIMEOUT_MS = 8_000;
const TX_IDLE_IN_TX_TIMEOUT_MS = 30_000;

type TxFn<T> = Parameters<typeof db.$transaction>[0] & ((tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<T>);

export function dbTx<T>(fn: TxFn<T>, options?: { timeout?: number }): Promise<T> {
  return db.$transaction(
    async (tx) => {
      // SET LOCAL is scoped to this transaction; on the Supabase transaction
      // pooler the backend stays pinned for the transaction, so it applies.
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = ${TX_LOCK_TIMEOUT_MS}`);
      await tx.$executeRawUnsafe(
        `SET LOCAL idle_in_transaction_session_timeout = ${TX_IDLE_IN_TX_TIMEOUT_MS}`,
      );
      return fn(tx);
    },
    { timeout: options?.timeout ?? TX_TIMEOUT },
  ) as Promise<T>;
}
