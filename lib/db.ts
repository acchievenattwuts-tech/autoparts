import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "./generated/prisma";

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
// 15s: long enough to ride out a short Supabase pool burst, short enough that a
// request fails fast (and degrades to the Prisma fallback) instead of pinning a
// Vercel function for 45s while the pool is starved. Paired with the per-search
// statement_timeout (dbSearchRaw) that frees busy connections within 8s so
// waiters rarely reach this ceiling at all.
const DEFAULT_DB_CONNECTION_TIMEOUT_MS = 15_000;

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

// ─── Transient connection retry ────────────────────────────────────────────
// Under a bot crawl, many warm instances open connections at once and the
// Supabase pooler (Supavisor, ~200 client cap) can drop/refuse a new one while
// it is being established — surfacing as "Connection terminated due to
// connection timeout" / "Connection terminated unexpectedly". These are
// transient: the connection never carried a query, so a single retry after a
// short backoff is safe (no risk of double-applying a write) and clears almost
// all of the noise, including failed ISR cache revalidations.
//
// "is not queryable" is the Prisma driver-adapter wording for the same class of
// failure: the pooled socket died (the pooler recycled it, or a serverless
// instance was frozen while it sat idle) and the engine rejects the query before
// it ever reaches Postgres. Nothing was sent, so retrying is safe.
const TRANSIENT_DB_ERROR_PATTERN =
  /connection terminated|connection timeout|timeout exceeded when trying to connect|ECONNRESET|Connection ended|too many connections|Closed the connection|is not queryable/i;

// node-postgres throws exactly "timeout exceeded when trying to connect" when a
// caller waits longer than `connectionTimeoutMillis` for a free pool slot — the
// pool is saturated (or the pooler refused a new physical connection), the query
// never reached Postgres, so retrying is safe. It is matched separately from the
// generic transient pattern because it has already burned a full 15s
// connection-acquire window: allowing the default 2 retries could pin a Vercel
// function for ~45s. One retry (worst case ~30s) keeps the request inside the
// function budget while still riding out a short burst.
const POOL_ACQUIRE_TIMEOUT_PATTERN = /timeout exceeded when trying to connect/i;
const POOL_ACQUIRE_MAX_RETRIES = 1;

const collectErrorMessages = (error: unknown, depth = 0): string => {
  if (depth > 4 || !(error instanceof Error)) {
    return typeof error === "string" ? error : "";
  }
  const causeMessage =
    "cause" in error ? collectErrorMessages(error.cause, depth + 1) : "";
  return `${error.message} ${causeMessage}`;
};

/**
 * True when the failure is a connection-level fault that never reached Postgres
 * (dead pooled socket, refused/timed-out connect). Exported so idempotent
 * background jobs can decide to retry themselves instead of logging a hard error.
 */
export const isTransientDbError = (error: unknown): boolean =>
  TRANSIENT_DB_ERROR_PATTERN.test(collectErrorMessages(error));

const isPoolAcquireTimeoutError = (error: unknown): boolean =>
  POOL_ACQUIRE_TIMEOUT_PATTERN.test(collectErrorMessages(error));

// Base backoff, doubled per attempt (150ms → 300ms), plus random jitter up to
// one base window. A fixed backoff makes parallel revalidations (e.g. the 3 admin
// master-option dropdowns loaded together on /admin/products/new) retry in
// lockstep and collide in the same pool-starvation window; jitter spreads them so
// the second attempt lands after the transient burst has cleared.
const RETRY_BASE_BACKOFF_MS = 150;
const DEFAULT_DB_RETRIES = 2;

const computeRetryDelayMs = (attempt: number): number => {
  const exponential = RETRY_BASE_BACKOFF_MS * 2 ** attempt;
  const jitter = Math.random() * RETRY_BASE_BACKOFF_MS;
  return exponential + jitter;
};

/**
 * Run a read-only DB operation, retrying on a transient connection-level failure
 * with exponential backoff + jitter. Use ONLY for idempotent reads (counts,
 * findMany, findFirst) — never for writes, since a retry could double-apply an
 * operation that actually reached Postgres.
 */
export async function withDbRetry<T>(
  fn: () => Promise<T>,
  retries = DEFAULT_DB_RETRIES,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const maxRetriesForError = isPoolAcquireTimeoutError(error)
        ? Math.min(retries, POOL_ACQUIRE_MAX_RETRIES)
        : retries;
      if (attempt < maxRetriesForError && isTransientDbError(error)) {
        await new Promise((resolve) => setTimeout(resolve, computeRetryDelayMs(attempt)));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

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
      await tx.$executeRaw`
        SELECT set_config('lock_timeout', ${String(TX_LOCK_TIMEOUT_MS)}, true)
      `;
      await tx.$executeRaw`
        SELECT set_config('idle_in_transaction_session_timeout', ${String(TX_IDLE_IN_TX_TIMEOUT_MS)}, true)
      `;
      return fn(tx);
    },
    { timeout: options?.timeout ?? TX_TIMEOUT },
  ) as Promise<T>;
}

// ─── Search query guardrail ────────────────────────────────────────────────
// Product search runs several heavy raw queries (trigram similarity + EXISTS
// subqueries over product_search_documents). Under a search/bot burst a single
// slow query can pin one of the small per-instance pool's connections for the
// full Supabase statement_timeout (120s), starving every other request until
// they hit the connection-acquire timeout — a cascade outage.
//
// SEARCH_STATEMENT_TIMEOUT_MS caps each search query at 8s server-side: Postgres
// cancels it and releases the connection, and the caller degrades to the Prisma
// contains fallback. The cap must be enforced inside a transaction because on
// the Supabase transaction pooler (pgbouncer) a bare `SET LOCAL` in a separate
// statement would land on a different backend and silently do nothing.
const SEARCH_STATEMENT_TIMEOUT_MS = 8_000;
const SEARCH_TX_MAX_WAIT_MS = 10_000;
// Server-side backstop for a serverless runtime that is frozen between two
// statements in an interactive search transaction. Prisma's JS timeout cannot
// fire while the event loop is suspended, but Postgres continues counting idle
// transaction time and releases the pooled connection independently.
const SEARCH_IDLE_IN_TX_TIMEOUT_MS = 20_000;
// Prisma's interactive-transaction timeout defaults to 5s — below our 8s
// statement cap, so it would abort the query first. Give the transaction a
// little headroom past the statement timeout so Postgres is the one that fires.
const SEARCH_TX_TIMEOUT_MS = SEARCH_STATEMENT_TIMEOUT_MS + 2_000;
// Bundled search transaction (dbSearchTx): semantic recall + primary ranked
// query share one connection. Two heavy statements can each run up to the 8s
// statement_timeout, so the transaction envelope must cover both plus a buffer.
const SEARCH_BUNDLE_TX_TIMEOUT_MS = SEARCH_STATEMENT_TIMEOUT_MS * 2 + 2_000;

/**
 * Run a single raw search query under an 8s statement_timeout so a slow query
 * can never hold its pool connection long enough to starve other requests.
 * Holds exactly one connection for the duration of the query and no longer.
 */
export async function dbSearchRaw<T>(query: Prisma.Sql): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        SELECT
          set_config('statement_timeout', ${String(SEARCH_STATEMENT_TIMEOUT_MS)}, true),
          set_config('idle_in_transaction_session_timeout', ${String(SEARCH_IDLE_IN_TX_TIMEOUT_MS)}, true)
      `;
      return tx.$queryRaw<T>(query);
    },
    { maxWait: SEARCH_TX_MAX_WAIT_MS, timeout: SEARCH_TX_TIMEOUT_MS },
  ) as Promise<T>;
}

/**
 * Run several raw search queries inside a SINGLE transaction (one connection
 * checkout, one statement_timeout setup) instead of one transaction per query.
 * Used by the product-search engine to bundle the semantic-recall query and the
 * primary ranked query so a single search holds exactly one pooled connection
 * across its DB work — sharply cutting the connection churn that exhausts the
 * small per-instance pool under a burst (the P2028 "unable to start a
 * transaction" cascade).
 *
 * The callback receives the transaction client and MUST NOT perform any non-DB
 * I/O (e.g. an embedding API call) inside it — doing so would pin the connection
 * while waiting on the network. The 8s statement_timeout still caps every
 * individual query, and the wider bundle timeout caps the whole transaction.
 */
export async function dbSearchTx<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        SELECT
          set_config('statement_timeout', ${String(SEARCH_STATEMENT_TIMEOUT_MS)}, true),
          set_config('idle_in_transaction_session_timeout', ${String(SEARCH_IDLE_IN_TX_TIMEOUT_MS)}, true)
      `;
      return fn(tx);
    },
    { maxWait: SEARCH_TX_MAX_WAIT_MS, timeout: SEARCH_BUNDLE_TX_TIMEOUT_MS },
  ) as Promise<T>;
}
