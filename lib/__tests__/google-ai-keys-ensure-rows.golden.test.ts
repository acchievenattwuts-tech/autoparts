import assert from "node:assert/strict";
import test, { after, before, mock } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma";

/**
 * D3 (2026-11-12): ensureKeyRows() now sends one createMany({ skipDuplicates })
 * instead of one upsert({ update: {} }) per configured Gemini key. This golden
 * test runs the previous upsert sweep and the new code with the real Prisma
 * client against the same seeded in-process Postgres (PGlite) and requires the
 * resulting AiApiKeyState table to be identical: existing rows untouched (same
 * id, counters, timestamps), missing rows created with the same data.
 */

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

const CONFIGURED_KEY_COUNT = 15;
const PREEXISTING_KEY_COUNT = 10;

// PGlite serves one socket at a time: close idle pool connections at once so
// the adapter's next connection is not queued behind the pg default 10 s idle.
const createQueryLoggingClient = (serverConn: string) =>
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: `postgresql://postgres:postgres@${serverConn}/postgres`,
      max: 1,
      idleTimeoutMillis: 1,
    }),
    log: [{ emit: "event", level: "query" }],
  });

let pg: PGlite;
let server: PGLiteSocketServer;
let client: ReturnType<typeof createQueryLoggingClient>;
const queries: string[] = [];
const savedEnv = new Map<string, string | undefined>();

type KeysModule = typeof import("@/lib/google-ai-keys");
let keys: KeysModule;

const keyRef = (index: number): string => `google-gemini-${index}`;

before(async () => {
  if (moduleMocksUnavailable) return;
  pg = new PGlite();
  await pg.exec(`
    SET TIME ZONE 'UTC';
    CREATE TYPE "AiApiKeyProvider" AS ENUM ('GOOGLE_GEMINI');
    CREATE TYPE "AiApiKeyStatus" AS ENUM ('AVAILABLE', 'COOLING_DOWN', 'DISABLED');
    CREATE TABLE "AiApiKeyState" (
      "id" TEXT PRIMARY KEY,
      "keyRef" TEXT NOT NULL UNIQUE,
      "provider" "AiApiKeyProvider" NOT NULL DEFAULT 'GOOGLE_GEMINI',
      "status" "AiApiKeyStatus" NOT NULL DEFAULT 'AVAILABLE',
      "cooldownUntil" TIMESTAMPTZ(3),
      "lastError" TEXT,
      "requestCount" INTEGER NOT NULL DEFAULT 0,
      "successCount" INTEGER NOT NULL DEFAULT 0,
      "errorCount" INTEGER NOT NULL DEFAULT 0,
      "rateLimitCount" INTEGER NOT NULL DEFAULT 0,
      "lastUsedAt" TIMESTAMPTZ(3),
      "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMPTZ(3) NOT NULL
    );
  `);
  server = new PGLiteSocketServer({ db: pg, port: 0, host: "127.0.0.1" });
  await server.start();
  client = createQueryLoggingClient(server.getServerConn());
  client.$on("query", (event) => {
    queries.push(event.query);
  });
  await mock.module("@/lib/db", { namedExports: { db: client } });
  for (let index = 1; index <= CONFIGURED_KEY_COUNT; index += 1) {
    const name = `GOOGLE_AI_API_KEY_${index}`;
    savedEnv.set(name, process.env[name]);
    process.env[name] = `test-secret-${index}`;
  }
  keys = await import("@/lib/google-ai-keys");
});

after(async () => {
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await client?.$disconnect();
  await server?.stop();
  await pg?.close();
});

/** Keys 1..10 already have health rows (with real usage data); 11..15 are new. */
async function seedPreexistingRows(): Promise<void> {
  await pg.exec(`TRUNCATE "AiApiKeyState"`);
  for (let index = 1; index <= PREEXISTING_KEY_COUNT; index += 1) {
    await pg.query(
      `INSERT INTO "AiApiKeyState"
         ("id", "keyRef", "status", "cooldownUntil", "lastError", "requestCount", "successCount", "errorCount",
          "rateLimitCount", "lastUsedAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3::"AiApiKeyStatus", $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        `seed-${index}`,
        keyRef(index),
        index % 3 === 0 ? "COOLING_DOWN" : index % 5 === 0 ? "DISABLED" : "AVAILABLE",
        index % 3 === 0 ? "2026-11-12 05:00:00" : null,
        index % 5 === 0 ? "API_KEY_INVALID" : null,
        index * 10,
        index * 7,
        index,
        index * 2,
        "2026-11-11 10:00:00",
        "2026-03-24 08:00:00",
        "2026-11-11 10:00:00",
      ],
    );
  }
  // A row for a key that is no longer configured must stay as it is.
  await pg.query(
    `INSERT INTO "AiApiKeyState" ("id", "keyRef", "status", "createdAt", "updatedAt")
     VALUES ('seed-20', 'google-gemini-20', 'DISABLED', '2026-03-24 08:00:00', '2026-04-01 00:00:00')`,
  );
}

type Row = Record<string, unknown>;

async function readRows(): Promise<Row[]> {
  const result = await pg.query<Row>(`SELECT * FROM "AiApiKeyState" ORDER BY "keyRef"`);
  return result.rows;
}

/** New rows get a fresh cuid and creation time on every run; compare everything else. */
function comparable(rows: Row[]): Row[] {
  return rows.map((row) =>
    String(row.id).startsWith("seed-") ? row : { ...row, id: "<generated>", createdAt: "<now>", updatedAt: "<now>" },
  );
}

const configuredRefs = (): string[] =>
  Array.from({ length: CONFIGURED_KEY_COUNT }, (_, offset) => keyRef(offset + 1));

/** The implementation ensureKeyRows() had before D3. */
async function previousEnsureKeyRows(refs: string[]): Promise<void> {
  await Promise.all(
    refs.map((ref) =>
      client.aiApiKeyState.upsert({
        where: { keyRef: ref },
        create: { keyRef: ref, provider: "GOOGLE_GEMINI" },
        update: {},
      }),
    ),
  );
}

test("createMany leaves the same AiApiKeyState rows as the previous upsert sweep", { skip: moduleMocksUnavailable }, async () => {
  await seedPreexistingRows();
  await previousEnsureKeyRows(configuredRefs());
  const before = await readRows();

  await seedPreexistingRows();
  const listed = await keys.listAiApiKeyStates();
  const afterRows = await readRows();

  assert.deepEqual(comparable(afterRows), comparable(before));
  assert.equal(afterRows.length, CONFIGURED_KEY_COUNT + 1);
  for (const row of afterRows.filter((candidate) => !String(candidate.id).startsWith("seed-"))) {
    assert.match(String(row.id), /^c[a-z0-9]{20,}$/);
    assert.equal(row.status, "AVAILABLE");
    assert.equal(row.provider, "GOOGLE_GEMINI");
  }
  // The monitoring page reads the same rows it read before.
  assert.deepEqual(
    listed.map((row) => [row.keyRef, row.configured, row.status, row.requestCount]),
    afterRows.map((row) => [row.keyRef, row.keyRef !== "google-gemini-20", row.status, row.requestCount]),
  );
});

test("a second sweep changes nothing, like the previous upsert", { skip: moduleMocksUnavailable }, async () => {
  await seedPreexistingRows();
  await keys.listAiApiKeyStates();
  const first = await readRows();
  await keys.listAiApiKeyStates();
  assert.deepEqual(await readRows(), first);
});

test("the first Gemini key lookup ensures all rows with one INSERT, later lookups skip it", { skip: moduleMocksUnavailable }, async () => {
  await pg.exec(`TRUNCATE "AiApiKeyState"`);
  queries.length = 0;
  const handles = await keys.getAvailableGeminiKeys();
  const inserts = queries.filter((query) => query.startsWith("INSERT"));

  assert.equal(inserts.length, 1);
  assert.match(inserts[0], /ON CONFLICT DO NOTHING/);
  assert.equal(handles.length, CONFIGURED_KEY_COUNT);
  assert.equal((await readRows()).length, CONFIGURED_KEY_COUNT);

  queries.length = 0;
  keys.invalidateGeminiKeyStateCache();
  await keys.getAvailableGeminiKeys();
  assert.equal(queries.filter((query) => query.startsWith("INSERT")).length, 0);
});
