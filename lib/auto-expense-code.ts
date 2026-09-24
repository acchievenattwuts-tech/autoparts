import { db, dbTx } from "@/lib/db";
import { isUniqueViolationOn } from "@/lib/doc-number-retry";
import { Prisma } from "@/lib/generated/prisma";

/**
 * ExpenseCode rows created automatically on first use (marketplace settlement fee
 * codes, Shopee escrow fee codes). They are looked up by `name`, which is NOT unique
 * in the schema, while `code` (@unique) is "highest existing + 1".
 *
 * Two first uses at the same moment used to create them inside the main document
 * transaction: the second hit P2002 on `code`, which aborted the whole document with
 * a misleading error and was never retried. This helper instead runs OUTSIDE the
 * document transaction, in its own short transaction:
 *
 * - fast path: every name already exists → return their ids, no lock, no write;
 * - otherwise a transaction-scoped advisory lock serializes the automatic creators,
 *   so the second request waits, re-reads by name and reuses the first one's rows
 *   (no duplicate names, no P2002 between creators);
 * - a P2002 on `code` can still come from a code typed in the master page at the
 *   same moment — that short transaction is re-run (re-read by name, next number).
 *
 * Created rows have exactly the code / name / description the callers produced before.
 */
const AUTO_EXPENSE_CODE_LOCK_KEY = "auto-expense-code";
export const AUTO_EXPENSE_CODE_MAX_ATTEMPTS = 3;

export type AutoExpenseCodeSpec = {
  name: string;
  description: string;
};

type ExpenseCodeClient = Pick<Prisma.TransactionClient, "expenseCode">;

/** Returns `count` new codes in creation order, read from the current ExpenseCode rows. */
export type AllocateExpenseCodes = (
  client: ExpenseCodeClient,
  count: number,
) => Promise<string[]>;

const readExpenseCodeIdsByName = async (
  client: ExpenseCodeClient,
  names: string[],
): Promise<Map<string, string>> => {
  const rows = await client.expenseCode.findMany({
    where: { name: { in: names } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((row) => [row.name, row.id]));
};

const createMissingExpenseCodes = async (
  specs: AutoExpenseCodeSpec[],
  allocateCodes: AllocateExpenseCodes,
): Promise<Map<string, string>> =>
  dbTx(async (tx) => {
    // $executeRaw, not $queryRaw: pg_advisory_xact_lock() returns void (see lib/doc-number.ts).
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${AUTO_EXPENSE_CODE_LOCK_KEY}))`);
    const result = await readExpenseCodeIdsByName(tx, specs.map((spec) => spec.name));
    const missing = specs.filter((spec) => !result.has(spec.name));
    if (missing.length === 0) return result;

    const codes = await allocateCodes(tx, missing.length);
    for (const [index, spec] of missing.entries()) {
      const created = await tx.expenseCode.create({
        data: { code: codes[index], name: spec.name, description: spec.description },
        select: { id: true },
      });
      result.set(spec.name, created.id);
    }
    return result;
  });

/**
 * Finds or creates one ExpenseCode per spec name and returns name → id. Must be
 * called outside any document transaction. Specs sharing a name create one row.
 */
export async function ensureExpenseCodesByName(
  specs: AutoExpenseCodeSpec[],
  allocateCodes: AllocateExpenseCodes,
): Promise<Map<string, string>> {
  const uniqueSpecs = [...new Map(specs.map((spec) => [spec.name, spec])).values()];
  const names = uniqueSpecs.map((spec) => spec.name);
  if (names.length === 0) return new Map();

  const existing = await readExpenseCodeIdsByName(db, names);
  if (existing.size === names.length) return existing;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await createMissingExpenseCodes(uniqueSpecs, allocateCodes);
    } catch (error) {
      if (attempt >= AUTO_EXPENSE_CODE_MAX_ATTEMPTS || !isUniqueViolationOn(error, "code")) throw error;
    }
  }
}
