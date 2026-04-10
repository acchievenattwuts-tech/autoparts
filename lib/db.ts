import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const connectionLimit = Number(process.env.DB_POOL_MAX ?? 1);
  const idleTimeoutMillis = Number(process.env.DB_IDLE_TIMEOUT_MS ?? 10_000);
  const connectionTimeoutMillis = Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 15_000);

  // Pass PoolConfig directly to avoid type conflict between pg versions
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    max: Number.isFinite(connectionLimit) ? Math.max(1, connectionLimit) : 2,
    idleTimeoutMillis: Number.isFinite(idleTimeoutMillis) ? Math.max(1_000, idleTimeoutMillis) : 10_000,
    connectionTimeoutMillis: Number.isFinite(connectionTimeoutMillis)
      ? Math.max(5_000, connectionTimeoutMillis)
      : 15_000,
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
