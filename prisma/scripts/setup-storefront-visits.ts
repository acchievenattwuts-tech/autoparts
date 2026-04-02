import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to set up storefront visits.");
}

const setupSql = `
CREATE TABLE IF NOT EXISTS "StorefrontVisitDaily" (
  id text PRIMARY KEY,
  "visitorKey" text NOT NULL,
  "visitDay" text NOT NULL,
  "entryPath" text NOT NULL,
  "lastPath" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "lastSeenAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "StorefrontVisitDaily_visitorKey_visitDay_key"
  ON "StorefrontVisitDaily" ("visitorKey", "visitDay");

CREATE INDEX IF NOT EXISTS "StorefrontVisitDaily_visitDay_idx"
  ON "StorefrontVisitDaily" ("visitDay");

CREATE INDEX IF NOT EXISTS "StorefrontVisitDaily_lastSeenAt_idx"
  ON "StorefrontVisitDaily" ("lastSeenAt");

ALTER TABLE "StorefrontVisitDaily" ENABLE ROW LEVEL SECURITY;
`;

async function main() {
  const pool = new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });

  try {
    await pool.query(setupSql);
    console.log("Storefront visit tracking setup complete.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Storefront visit tracking setup failed.");
  console.error(error);
  process.exitCode = 1;
});
