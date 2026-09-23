import assert from "node:assert/strict";
import test, { mock } from "node:test";

// The seed scripts keep an in-memory map from every known term/synonym to its
// SearchSynonym row. After merging one cluster into a row, a later cluster that
// reaches the same row through a *different* key must merge on top of the new
// list, never the stale pre-update copy (the scripts promise "additive only").

type Row = { id: string; term: string; synonyms: string[]; language: string | null };

const SCRIPT = process.env.SEED_SYNONYMS_SCRIPT ?? "../prisma/scripts/seed-brand-synonyms.ts";

test("brand synonym seed never drops synonyms added by an earlier cluster", async (t) => {
  if (typeof (mock as { module?: unknown }).module !== "function") {
    t.skip("requires --experimental-test-module-mocks");
    return;
  }

  // One pre-existing row that owns the ATC cluster's term AND a K.AIR-cluster key.
  const rows: Row[] = [{ id: "r1", term: "ATC", synonyms: ["K.AIR"], language: null }];
  let finished: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    finished = resolve;
  });

  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        searchSynonym: {
          findMany: async () => rows.map((row) => ({ ...row, synonyms: [...row.synonyms] })),
          update: async ({ where, data }: { where: { id: string }; data: { synonyms: string[] } }) => {
            const row = rows.find((candidate) => candidate.id === where.id);
            assert.ok(row);
            row.synonyms = [...data.synonyms];
            return row;
          },
          create: async ({ data }: { data: Omit<Row, "id"> }) => {
            const row = { id: `new-${rows.length}`, ...data };
            rows.push(row);
            return row;
          },
        },
        $disconnect: async () => {
          finished();
        },
      },
    },
  });
  await mock.module("@/lib/audit-log", {
    namedExports: { safeWriteAuditLog: async () => undefined },
  });

  const log = mock.method(console, "log", () => undefined);
  try {
    await import(SCRIPT);
    await done;
  } finally {
    log.mock.restore();
  }

  const merged = rows.find((row) => row.id === "r1");
  assert.ok(merged);
  // Added by the ATC cluster, must survive the later K.AIR cluster update.
  assert.ok(merged.synonyms.includes("เอทีซี"), JSON.stringify(merged.synonyms));
  assert.ok(merged.synonyms.includes("A T C"), JSON.stringify(merged.synonyms));
  // Added by the K.AIR cluster.
  assert.ok(merged.synonyms.includes("เคแอร์"), JSON.stringify(merged.synonyms));
  assert.ok(merged.synonyms.includes("K.AIR"));
});
