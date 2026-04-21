import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const DEFAULT_DB_POOL_MAX = 1;
const DEFAULT_DB_IDLE_TIMEOUT_MS = 10_000;
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

const TX_TIMEOUT = 30_000; // 30s — Supabase serverless needs more time for multi-step transactions

type TxFn<T> = Parameters<typeof db.$transaction>[0] & ((tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<T>);

export function dbTx<T>(fn: TxFn<T>): Promise<T> {
  return db.$transaction(fn, { timeout: TX_TIMEOUT }) as Promise<T>;
}
