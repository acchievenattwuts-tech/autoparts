import assert from "node:assert/strict";
import test from "node:test";

import { CashBankDirection, CashBankSourceType, Prisma } from "@/lib/generated/prisma";
import {
  clearCashBankSourceMovements,
  recalculateCashBankAccount,
  replaceCashBankSourceMovements,
} from "@/lib/cash-bank";

// Running-balance rewrites must hold the CashBankAccount row lock first, so two
// documents posting to one account serialize instead of rebalancing from stale
// snapshots (or deadlocking on each other's movement rows).

type TxClient = Prisma.TransactionClient;
type OldMovement = { accountId: string; txnDate: Date };

const OPENING_DATE = new Date("2026-01-01T00:00:00+07:00");
const DAY_1 = new Date("2026-09-10T00:00:00+07:00");
const DAY_2 = new Date("2026-09-12T00:00:00+07:00");

const LOCK_SQL = /SELECT id FROM "CashBankAccount"\s+WHERE id IN \(([?,\s]+)\)\s+ORDER BY id\s+FOR NO KEY UPDATE/;

type FakeTx = { tx: TxClient; calls: string[]; lockedIdSets: string[][]; rebalances: unknown[][] };

function createFakeTx(oldMovements: OldMovement[] = [], previousBalance: number | null = null): FakeTx {
  const calls: string[] = [];
  const lockedIdSets: string[][] = [];
  const rebalances: unknown[][] = [];
  const fake = {
    $queryRaw: async (query: Prisma.Sql) => {
      assert.match(query.sql, LOCK_SQL);
      lockedIdSets.push(query.values as string[]);
      calls.push("lock");
      return [];
    },
    $executeRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push("rebalance");
      rebalances.push(values);
      return 0;
    },
    cashBankMovement: {
      findMany: async () => {
        calls.push("movement.findMany");
        return oldMovements;
      },
      deleteMany: async () => {
        calls.push("movement.deleteMany");
        return { count: oldMovements.length };
      },
      createMany: async () => {
        calls.push("movement.createMany");
        return { count: 1 };
      },
      findFirst: async () => {
        calls.push("movement.findFirst");
        return previousBalance === null ? null : { balanceAfter: new Prisma.Decimal(previousBalance) };
      },
    },
    cashBankAccount: {
      findMany: async (args: { where: { id: { in: string[] } } }) => {
        calls.push("account.findMany");
        return args.where.id.in.map((id) => ({ id, code: id, name: id, isActive: true, openingDate: OPENING_DATE }));
      },
      findUnique: async () => {
        calls.push("account.findUnique");
        return { openingBalance: new Prisma.Decimal(100) };
      },
    },
  };
  return { tx: fake as unknown as TxClient, calls, lockedIdSets, rebalances };
}

const entry = (accountId: string, txnDate: Date, direction: CashBankDirection = CashBankDirection.IN) => ({
  accountId,
  txnDate,
  direction,
  amount: 50,
  referenceNo: "DOC-1",
});

test("replace: the account lock is the first statement after reading the source's own rows", async () => {
  const fake = createFakeTx([{ accountId: "acc-a", txnDate: DAY_1 }]);
  await replaceCashBankSourceMovements(fake.tx, CashBankSourceType.RECEIPT, "rc-1", [entry("acc-a", DAY_2)]);

  assert.deepEqual(fake.calls.slice(0, 3), ["movement.findMany", "lock", "account.findMany"]);
  const lockIndex = fake.calls.indexOf("lock");
  for (const write of ["movement.deleteMany", "movement.createMany", "movement.findFirst", "rebalance"]) {
    assert.ok(fake.calls.indexOf(write) > lockIndex, `${write} must run after the account lock`);
  }
});

test("replace: a document moved between accounts locks the old and the new account, sorted by id", async () => {
  const fake = createFakeTx([{ accountId: "acc-z", txnDate: DAY_1 }]);
  await replaceCashBankSourceMovements(fake.tx, CashBankSourceType.SALE, "sale-1", [entry("acc-b", DAY_2)]);

  assert.deepEqual(fake.lockedIdSets, [["acc-b", "acc-z"]]);
});

test("replace: a transfer locks both sides in one sorted statement", async () => {
  const fake = createFakeTx();
  await replaceCashBankSourceMovements(fake.tx, CashBankSourceType.TRANSFER, "tr-1", [
    entry("acc-to", DAY_1, CashBankDirection.IN),
    entry("acc-from", DAY_1, CashBankDirection.OUT),
  ]);

  assert.deepEqual(fake.lockedIdSets, [["acc-from", "acc-to"]]);
  assert.equal(fake.calls.filter((call) => call === "lock").length, 1);
});

test("replace: accounts already locked in the same transaction are not locked again", async () => {
  const fake = createFakeTx();
  await replaceCashBankSourceMovements(fake.tx, CashBankSourceType.EXPENSE, "ex-1", [entry("acc-h", DAY_1)]);
  await replaceCashBankSourceMovements(fake.tx, CashBankSourceType.ADJUSTMENT, "adj-1", [entry("acc-h", DAY_1)]);
  await replaceCashBankSourceMovements(fake.tx, CashBankSourceType.TRANSFER, "tr-1", [
    entry("acc-h", DAY_1, CashBankDirection.OUT),
    entry("acc-d", DAY_1),
  ]);

  assert.deepEqual(fake.lockedIdSets, [["acc-h"], ["acc-d"]]);

  // A new transaction (a new tx client) must lock again.
  const nextTx = createFakeTx();
  await replaceCashBankSourceMovements(nextTx.tx, CashBankSourceType.EXPENSE, "ex-2", [entry("acc-h", DAY_1)]);
  assert.deepEqual(nextTx.lockedIdSets, [["acc-h"]]);
});

test("replace: zero-amount entries post nothing and lock nothing new", async () => {
  const fake = createFakeTx();
  await replaceCashBankSourceMovements(fake.tx, CashBankSourceType.SALE, "sale-2", [
    { ...entry("acc-a", DAY_1), amount: 0 },
  ]);

  assert.deepEqual(fake.lockedIdSets, []);
  assert.equal(fake.calls.includes("movement.createMany"), false);
});

test("clear: locks the source's accounts before deleting and rebalancing", async () => {
  const fake = createFakeTx([
    { accountId: "acc-y", txnDate: DAY_2 },
    { accountId: "acc-x", txnDate: DAY_1 },
  ]);
  await clearCashBankSourceMovements(fake.tx, CashBankSourceType.TRANSFER, "tr-2");

  assert.deepEqual(fake.lockedIdSets, [["acc-x", "acc-y"]]);
  assert.deepEqual(fake.calls.slice(0, 3), ["movement.findMany", "lock", "movement.deleteMany"]);
});

test("clear: nothing to clear means no lock", async () => {
  const fake = createFakeTx();
  await clearCashBankSourceMovements(fake.tx, CashBankSourceType.TRANSFER, "tr-3");

  assert.deepEqual(fake.lockedIdSets, []);
  assert.deepEqual(fake.calls, ["movement.findMany"]);
});

test("recalculateCashBankAccount locks the account before reading the opening balance", async () => {
  const fake = createFakeTx();
  await recalculateCashBankAccount(fake.tx, "acc-a");

  assert.deepEqual(fake.calls, ["lock", "account.findUnique", "rebalance"]);
  assert.deepEqual(fake.lockedIdSets, [["acc-a"]]);
});

test("rebalance inputs are unchanged: earliest dirty date per account, seeded from the previous balance", async () => {
  const fake = createFakeTx(
    [
      { accountId: "acc-a", txnDate: DAY_2 },
      { accountId: "acc-b", txnDate: DAY_2 },
    ],
    250,
  );
  await replaceCashBankSourceMovements(fake.tx, CashBankSourceType.SALE, "sale-3", [entry("acc-a", DAY_1)]);

  // Values follow the SQL: startingBalance, accountId, startDate, startDate.
  const byAccount = new Map(fake.rebalances.map((values) => [values[1], values]));
  const accountA = byAccount.get("acc-a");
  const accountB = byAccount.get("acc-b");
  assert.ok(accountA && accountB);
  assert.equal(String(accountA[0]), "250");
  assert.deepEqual(accountA.slice(2), [DAY_1, DAY_1]);
  assert.equal(String(accountB[0]), "250");
  assert.deepEqual(accountB.slice(2), [DAY_2, DAY_2]);
});
