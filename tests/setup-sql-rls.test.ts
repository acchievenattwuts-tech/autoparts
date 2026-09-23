import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// Tables created outside prisma migrations must enable RLS in the same script,
// otherwise Supabase's anon/authenticated Data API roles can read and write them.
const SETUP_FILES = [
  "prisma/scripts/setup-knowledge-rag.ts",
  "prisma/sql/2026-06-08-ai-api-key-state.sql",
];

const normalizeIdentifier = (name: string): string => name.replace(/"/g, "").trim();

for (const relativePath of SETUP_FILES) {
  test(`${relativePath} enables RLS for every table it creates`, () => {
    const source = readFileSync(path.join(process.cwd(), relativePath), "utf8");
    const created = [...source.matchAll(/CREATE TABLE IF NOT EXISTS\s+("?[\w]+"?)/gi)].map((match) =>
      normalizeIdentifier(match[1]),
    );
    const rlsEnabled = new Set(
      [...source.matchAll(/ALTER TABLE\s+("?[\w]+"?)\s+ENABLE ROW LEVEL SECURITY/gi)].map((match) =>
        normalizeIdentifier(match[1]),
      ),
    );

    assert.ok(created.length > 0, "expected at least one CREATE TABLE");
    assert.deepEqual(
      created.filter((table) => !rlsEnabled.has(table)),
      [],
    );
  });
}
