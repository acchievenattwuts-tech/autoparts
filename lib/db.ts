import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  // Pass PoolConfig directly to avoid type conflict between pg versions
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    max: 1,                      // 1 connection per serverless instance
    idleTimeoutMillis: 10_000,   // release idle connection after 10s
    connectionTimeoutMillis: 5_000,
  });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

const TX_TIMEOUT = 30_000; // 30s — Supabase serverless needs more time for multi-step transactions

type TxFn<T> = Parameters<typeof db.$transaction>[0] & ((tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<T>);

export function dbTx<T>(fn: TxFn<T>): Promise<T> {
  return db.$transaction(fn, { timeout: TX_TIMEOUT }) as Promise<T>;
}
