import assert from "node:assert/strict";
import test, { after, before, beforeEach, mock } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { Prisma } from "@/lib/generated/prisma";
import {
  PURCHASE_BUDGET_CAP_KEY,
  PURCHASE_BUDGET_STARTED_ON_KEY,
  PURCHASE_BUDGET_THRESHOLD_KEY,
} from "@/lib/purchase-budget-core";

/**
 * R8 (review 2026-11-12):
 * - getCashBankBalanceTotal() reads the latest balance of every active cash/bank account with one
 *   DISTINCT ON statement instead of a findFirst per account. The test runs that SQL on an in-process
 *   Postgres (PGlite) and compares it with the previous algorithm — the same findFirst ordering
 *   (txnDate, sorder, createdAt, id descending) run per account on the same rows, the opening balance
 *   when an account has no movement, summed in account order — including ties on txnDate, sorder and
 *   createdAt, an inactive account and a negative balance. getCashHealth() keeps its three numbers.
 * - The purchase budget tab reads its settings once and passes them to the snapshot; the tab's data
 *   equals what the separate settings + snapshot + getCashHealth() reads gave.
 */
const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" && "requires --experimental-test-module-mocks";

let pg: PGlite;
let settingsReads = 0;
let movementFindFirstCalls = 0;
const D = (value: unknown): Prisma.Decimal => new Prisma.Decimal(String(value));

type OrderBy = Array<Record<string, "asc" | "desc">>;

const db = {
  $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
    const query = Prisma.sql(strings, ...values);
    if (query.text.includes(`"CashBankMovement"`)) {
      const rows = (await pg.query<{ accountId: string; balanceAfter: string }>(query.text, query.values)).rows;
      return rows.map((row) => ({ ...row, balanceAfter: D(row.balanceAfter) }));
    }
    if (query.text.includes(`"Product" p`)) return [{ value: 98765.43 }];
    if (query.text.includes(`"salesCost"`)) return [{ purchases: 40000, salesCost: 12500.5, otherEffect: -320.25 }];
    throw new Error(`unexpected raw query: ${query.text}`);
  },
  cashBankAccount: {
    findMany: async (): Promise<Array<{ id: string; openingBalance: Prisma.Decimal }>> =>
      (await pg.query<{ id: string; openingBalance: string }>(
        `SELECT "id", "openingBalance" FROM "CashBankAccount" WHERE "isActive" = true`,
      )).rows.map((row) => ({ id: row.id, openingBalance: D(row.openingBalance) })),
  },
  cashBankMovement: {
    // The previous per-account read, with Prisma's ORDER BY built from the same orderBy list.
    findFirst: async (args: { where: { accountId: string }; orderBy: OrderBy }): Promise<{ balanceAfter: Prisma.Decimal } | null> => {
      movementFindFirstCalls += 1;
      const orderBy = args.orderBy.map((entry) => {
        const [[field, direction]] = Object.entries(entry);
        return `"${field}" ${direction.toUpperCase()}`;
      }).join(", ");
      const row = (await pg.query<{ balanceAfter: string }>(
        `SELECT "balanceAfter" FROM "CashBankMovement" WHERE "accountId" = $1 ORDER BY ${orderBy} LIMIT 1`,
        [args.where.accountId],
      )).rows[0];
      return row ? { balanceAfter: D(row.balanceAfter) } : null;
    },
  },
  sale: { aggregate: async () => ({ _sum: { amountRemain: D("15234.567") } }) },
  purchase: { aggregate: async () => ({ _sum: { amountRemain: D("8000.10") } }) },
  supplierDebitNote: { aggregate: async () => ({ _sum: { amountRemain: D("-120.05") } }) },
  supplierAdvance: {
    findMany: async () => [{ id: "adv-1", advanceNo: "SA2611-0001", advanceDate: new Date("2026-11-03T00:00:00+07:00"),
      totalAmount: D(5000), amountRemain: D(1250.5), supplier: { name: "ซัพพลายเออร์ ก" } }],
    aggregate: async () => ({ _sum: { amountRemain: D(1250.5) } }),
  },
  auditLog: { findMany: async () => [] },
  siteContent: {
    findMany: async () => {
      settingsReads += 1;
      return [
        { key: PURCHASE_BUDGET_CAP_KEY, value: "50000" },
        { key: PURCHASE_BUDGET_THRESHOLD_KEY, value: "15" },
        { key: PURCHASE_BUDGET_STARTED_ON_KEY, value: "2026-11-01" },
      ];
    },
    findUnique: async () => null,
  },
};

const ACCOUNTS: Array<[id: string, isActive: boolean, openingBalance: string]> = [
  ["acc-a", true, "1000.00"], ["acc-b", true, "250.50"], ["acc-c", false, "99.00"],
  ["acc-d", true, "0.00"], ["acc-e", true, "10.00"], ["acc-f", true, "0.10"], ["acc-g", true, "0.20"],
];
const MOVEMENTS: Array<[id: string, accountId: string, txnDate: string, sorder: number, createdAt: string, balanceAfter: string]> = [
  ["m-a1", "acc-a", "2026-11-01T10:00:00Z", 1, "2026-11-01T10:00:00Z", "1100.00"],
  ["m-a2", "acc-a", "2026-11-02T00:00:00Z", 1, "2026-11-02T03:00:00Z", "1200.50"],
  // Same txnDate and sorder: createdAt decides; with createdAt equal too, the larger id wins.
  ["m-a3", "acc-a", "2026-11-02T00:00:00Z", 2, "2026-11-01T09:00:00Z", "1300.25"],
  ["m-a4", "acc-a", "2026-11-02T00:00:00Z", 2, "2026-11-01T09:00:00Z", "1350.75"],
  ["m-a5", "acc-a", "2026-11-02T00:00:00Z", 2, "2026-10-30T09:00:00Z", "1999.99"],
  ["m-c1", "acc-c", "2026-11-04T00:00:00Z", 1, "2026-11-04T00:00:00Z", "5000.00"],
  // A later txnDate beats a larger sorder on an earlier date.
  ["m-d1", "acc-d", "2026-11-05T00:00:00Z", 9, "2026-11-05T00:00:00Z", "500.10"],
  ["m-d2", "acc-d", "2026-11-06T00:00:00Z", 1, "2026-11-06T00:00:00Z", "480.20"],
  ["m-e1", "acc-e", "2026-11-07T00:00:00Z", 1, "2026-11-07T00:00:00Z", "-35.40"],
];

let distribution: typeof import("@/lib/profit-distribution");
let budget: typeof import("@/lib/purchase-budget");
let budgetDashboard: typeof import("@/lib/purchase-budget-dashboard");

/** The previous cash/bank total: one findFirst per active account, summed in account order. */
async function previousCashBankBalance(): Promise<number> {
  const accounts = await db.cashBankAccount.findMany();
  const latest = await Promise.all(accounts.map((account) => db.cashBankMovement.findFirst({
    where: { accountId: account.id },
    orderBy: [{ txnDate: "desc" }, { sorder: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  })));
  const total = accounts.reduce((sum, account, index) => sum + Number(latest[index]?.balanceAfter ?? account.openingBalance), 0);
  return distribution.roundMoney(total);
}

before(async () => {
  if (moduleMocksUnavailable) return;
  pg = new PGlite();
  await pg.exec(`
    CREATE TABLE "CashBankAccount" ("id" TEXT PRIMARY KEY, "isActive" BOOLEAN NOT NULL, "openingBalance" DECIMAL(10,2) NOT NULL);
    CREATE TABLE "CashBankMovement" (
      "id" TEXT PRIMARY KEY, "accountId" TEXT NOT NULL, "txnDate" TIMESTAMPTZ(3) NOT NULL, "sorder" INTEGER NOT NULL,
      "createdAt" TIMESTAMPTZ(3) NOT NULL, "balanceAfter" DECIMAL(10,2) NOT NULL
    );
  `);
  for (const [id, isActive, openingBalance] of ACCOUNTS) {
    await pg.query(`INSERT INTO "CashBankAccount" VALUES ($1, $2, $3)`, [id, isActive, openingBalance]);
  }
  for (const row of MOVEMENTS) {
    await pg.query(`INSERT INTO "CashBankMovement" VALUES ($1, $2, $3, $4, $5, $6)`, row);
  }
  await mock.module("next/cache", {
    namedExports: {
      unstable_cache: <Args extends unknown[], Result>(callback: (...args: Args) => Promise<Result>) => callback,
      revalidateTag: (): void => undefined,
      updateTag: (): void => undefined,
    },
  });
  await mock.module("@/lib/db", { namedExports: { db, withDbRetry: <T>(operation: () => Promise<T>): Promise<T> => operation() } });
  distribution = await import("@/lib/profit-distribution");
  budget = await import("@/lib/purchase-budget");
  budgetDashboard = await import("@/lib/purchase-budget-dashboard");
});

after(async () => {
  await pg?.close();
});

beforeEach(() => {
  settingsReads = 0;
  movementFindFirstCalls = 0;
});

test("the DISTINCT ON total equals the per-account findFirst total", { skip: moduleMocksUnavailable }, async () => {
  const expected = await previousCashBankBalance();
  movementFindFirstCalls = 0;
  const total = await distribution.getCashBankBalanceTotal();
  assert.equal(total, expected);
  // acc-a 1350.75 (id tie-break) + acc-b opening 250.50 + acc-d 480.20 + acc-e -35.40 + acc-f 0.10 + acc-g 0.20.
  assert.equal(total, 2046.35);
  assert.equal(movementFindFirstCalls, 0, "no per-account query is left");
});

test("getCashHealth keeps cash/bank, receivables and stock value", { skip: moduleMocksUnavailable }, async () => {
  const health = await distribution.getCashHealth();
  assert.deepEqual(health, {
    cashBankBalance: await previousCashBankBalance(),
    arOutstanding: distribution.roundMoney(15234.567),
    stockValue: distribution.roundMoney(98765.43),
  });
});

test("with no active account the total is 0 and no movement is read", { skip: moduleMocksUnavailable }, async () => {
  await pg.exec(`UPDATE "CashBankAccount" SET "isActive" = false`);
  try {
    assert.equal(await distribution.getCashBankBalanceTotal(), await previousCashBankBalance());
    assert.equal(await distribution.getCashBankBalanceTotal(), 0);
  } finally {
    await pg.exec(`UPDATE "CashBankAccount" SET "isActive" = ("id" <> 'acc-c')`);
  }
});

test("the purchase budget tab reads its settings once and shows the same figures and cash view", { skip: moduleMocksUnavailable }, async () => {
  const now = new Date("2026-11-12T05:00:00Z");
  const previousSettings = await budget.getPurchaseBudgetSettings();
  const previousSnapshot = await budget.getPurchaseBudgetSnapshot();
  const previousHealth = await distribution.getCashHealth();
  settingsReads = 0;

  const data = await budgetDashboard.getPurchaseBudgetDashboardData({ canViewCash: true, now });
  assert.equal(settingsReads, 1, "settings are read once per tab load (twice before)");
  assert.deepEqual(data.settings, previousSettings);
  assert.deepEqual(data.figures, previousSnapshot?.figures ?? null);
  assert.deepEqual(data.cash, {
    cashBankBalance: previousHealth.cashBankBalance,
    apOutstanding: 7880.05,
    arOutstanding: 15234.57,
  });

  const hidden = await budgetDashboard.getPurchaseBudgetDashboardData({ canViewCash: false, now });
  assert.equal(hidden.cash.cashBankBalance, null);
  assert.deepEqual({ ...hidden, cash: data.cash }, data);
});
