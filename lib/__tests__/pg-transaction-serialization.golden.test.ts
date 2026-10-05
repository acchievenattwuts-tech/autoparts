import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";

import { FluidPrismaPg } from "@/lib/db-pool";
import { PrismaClient } from "@/lib/generated/prisma";

// Golden tests for one-at-a-time statements on a transaction connection
// (pg DeprecationWarning, production 2026-10-04 13:56–13:59 on credit-note
// create/edit). Prisma's real query interpreter runs against a fake pg
// connection, so nothing here opens a socket.

const TEXT_OID = 25;
const DUMMY_POOL_CONFIG = { connectionString: "postgresql://test:test@127.0.0.1:1/unused" };

type FakeQueryConfig = string | { text: string };
interface FakeResult {
  fields: Array<{ name: string; dataTypeID: number }>;
  rows: unknown[][];
  rowCount: number;
}

// Every column is text, so the fake needs no type parsers.
const GOLDEN_ROWS: Record<string, Array<Record<string, string>>> = {
  CreditNote: [{ id: "cn-golden", cnNo: "CN26100001", saleId: "sale-golden", customerId: "customer-golden" }],
  Sale: [{ id: "sale-golden", saleNo: "SO26100001" }],
  Customer: [{ id: "customer-golden", name: "Golden Customer" }],
  CreditNoteItem: [
    { id: "cni-1", creditNoteId: "cn-golden", productId: "product-1", lineNo: "1" },
    { id: "cni-2", creditNoteId: "cn-golden", productId: "product-2", lineNo: "2" },
  ],
};

// The root shape of rebuildCreditNoteProfitFacts (lib/profit-fact.ts): three
// sibling relations, which Prisma 7 loads with Promise.all.
const EXPECTED_CREDIT_NOTE = {
  id: "cn-golden",
  cnNo: "CN26100001",
  sale: { saleNo: "SO26100001" },
  customer: { name: "Golden Customer" },
  items: [
    { id: "cni-1", productId: "product-1" },
    { id: "cni-2", productId: "product-2" },
  ],
};

const EMPTY_RESULT: FakeResult = { fields: [], rows: [], rowCount: 0 };

const statementLabel = (text: string): string => {
  const table = /\bFROM "public"\."(\w+)"/.exec(text)?.[1];
  return table ?? text.trim().split(/\s+/).slice(0, 2).join(" ");
};

const goldenResult = (text: string): FakeResult => {
  const table = /\bFROM "public"\."(\w+)"/.exec(text)?.[1];
  if (!table) return EMPTY_RESULT;
  const selectList = text.slice(0, text.indexOf(" FROM "));
  const columns = [...selectList.matchAll(new RegExp(`"public"\\."${table}"\\."(\\w+)"`, "g"))].map(
    (match) => match[1] ?? "",
  );
  const rows = (GOLDEN_ROWS[table] ?? []).map((row) => columns.map((column) => row[column] ?? null));
  return { fields: columns.map((name) => ({ name, dataTypeID: TEXT_OID })), rows, rowCount: rows.length };
};

/** One pg connection that records overlap: pg@8 queues it with a warning, pg@9 throws. */
const createFakeConnection = (failOn?: RegExp) => {
  const started: string[] = [];
  const finished: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const connection = {
    on: (): void => undefined,
    removeListener: (): void => undefined,
    release: (): void => undefined,
    query: async (config: FakeQueryConfig): Promise<FakeResult> => {
      const text = typeof config === "string" ? config : config.text;
      const label = statementLabel(text);
      started.push(label);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        // Yield so a concurrent caller would start before this one finishes.
        await new Promise((resolve) => setImmediate(resolve));
        if (failOn?.test(text)) throw new Error(`fake failure: ${label}`);
        return goldenResult(text);
      } finally {
        inFlight -= 1;
        finished.push(label);
      }
    },
  };
  return { connection, started, finished, maxInFlight: (): number => maxInFlight };
};

type FakeConnection = ReturnType<typeof createFakeConnection>["connection"];

/** Hand Prisma's pool the fake connection instead of dialing the dummy DSN. */
const withFakeConnection = <F extends PrismaPg>(factory: F, connection: FakeConnection): F => {
  const connect = factory.connect.bind(factory);
  factory.connect = async () => {
    const adapter = await connect();
    Object.defineProperty(adapter.underlyingDriver(), "connect", { value: async () => connection });
    return adapter;
  };
  return factory;
};

const loadGoldenCreditNote = async (factory: PrismaPg): Promise<unknown> => {
  const prisma = new PrismaClient({ adapter: factory });
  try {
    return await prisma.$transaction(async (tx) =>
      tx.creditNote.findUnique({
        where: { id: "cn-golden" },
        select: {
          id: true,
          cnNo: true,
          sale: { select: { saleNo: true } },
          customer: { select: { name: true } },
          items: { orderBy: { lineNo: "asc" }, select: { id: true, productId: true } },
        },
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
};

const query = (sql: string) => ({ sql, args: [], argTypes: [] });

test("golden: a 3-relation load inside a transaction runs one statement at a time with the same result", async () => {
  const fake = createFakeConnection();
  const creditNote = await loadGoldenCreditNote(withFakeConnection(new FluidPrismaPg(DUMMY_POOL_CONFIG), fake.connection));

  assert.deepEqual(creditNote, EXPECTED_CREDIT_NOTE);
  assert.equal(fake.maxInFlight(), 1);
  // Each statement finished before the next one started.
  assert.deepEqual(fake.finished, fake.started);
  assert.equal(fake.started[0], "BEGIN");
  assert.equal(fake.started[1], "CreditNote");
  assert.equal(fake.started.at(-1), "COMMIT");
  assert.deepEqual(fake.started.slice(2, -1).sort(), ["CreditNoteItem", "Customer", "Sale"]);
});

test("canary: plain @prisma/adapter-pg still overlaps sibling relation loads on the transaction connection", async () => {
  const fake = createFakeConnection();
  const creditNote = await loadGoldenCreditNote(withFakeConnection(new PrismaPg(DUMMY_POOL_CONFIG), fake.connection));

  assert.deepEqual(creditNote, EXPECTED_CREDIT_NOTE);
  assert.ok(
    fake.maxInFlight() > 1,
    "@prisma/adapter-pg now serializes transaction queries itself (prisma/orm#29979 shipped): " +
      "remove serializeTransactionQueries from lib/db-pool.ts and this canary.",
  );
});

test("statements, savepoints and COMMIT on a transaction run in call order", async () => {
  const fake = createFakeConnection();
  const adapter = await withFakeConnection(new FluidPrismaPg(DUMMY_POOL_CONFIG), fake.connection).connect();
  try {
    const tx = await adapter.startTransaction();
    assert.ok(tx.createSavepoint, "pg transactions support savepoints");
    await Promise.all([
      tx.queryRaw(query('SELECT "public"."Sale"."id" FROM "public"."Sale"')),
      tx.createSavepoint("prisma_sp_0"),
      tx.executeRaw(query('UPDATE "public"."Customer" SET "name" = $1')),
      tx.queryRaw(query('SELECT "public"."CreditNote"."id" FROM "public"."CreditNote"')),
      tx.executeRaw(query("COMMIT")),
    ]);
    await tx.commit();

    assert.equal(fake.maxInFlight(), 1);
    assert.deepEqual(fake.started, ["BEGIN", "Sale", "SAVEPOINT prisma_sp_0", "UPDATE \"public\".\"Customer\"", "CreditNote", "COMMIT"]);
    assert.deepEqual(fake.finished, fake.started);
  } finally {
    await adapter.dispose();
  }
});

test("a failed statement rejects only its own caller and does not block the next one", async () => {
  const fake = createFakeConnection(/"public"\."Sale"/);
  const adapter = await withFakeConnection(new FluidPrismaPg(DUMMY_POOL_CONFIG), fake.connection).connect();
  try {
    const tx = await adapter.startTransaction();
    const failing = tx.queryRaw(query('SELECT "public"."Sale"."id" FROM "public"."Sale"'));
    const following = tx.queryRaw(query('SELECT "public"."CreditNote"."id" FROM "public"."CreditNote"'));

    // The caller gets the adapter's own error, untouched by the queue.
    await assert.rejects(failing, /fake failure: Sale/);
    const result = await following;
    assert.deepEqual(result.rows, [["cn-golden"]]);
    assert.equal(fake.maxInFlight(), 1);
    await tx.rollback();
  } finally {
    await adapter.dispose();
  }
});

test("queries outside a transaction stay concurrent on the pool", async () => {
  const fake = createFakeConnection();
  const adapter = await new FluidPrismaPg(DUMMY_POOL_CONFIG).connect();
  try {
    // The pool gives every query its own connection; serializing here would cap
    // the whole instance at one query at a time.
    Object.defineProperty(adapter.underlyingDriver(), "query", { value: fake.connection.query });
    await Promise.all([
      adapter.queryRaw(query('SELECT "public"."Sale"."id" FROM "public"."Sale"')),
      adapter.queryRaw(query('SELECT "public"."Customer"."id" FROM "public"."Customer"')),
      adapter.queryRaw(query('SELECT "public"."CreditNote"."id" FROM "public"."CreditNote"')),
    ]);

    assert.equal(fake.maxInFlight(), 3);
  } finally {
    await adapter.dispose();
  }
});
