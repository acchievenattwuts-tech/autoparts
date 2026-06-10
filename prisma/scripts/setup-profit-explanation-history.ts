import { Client } from "pg";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProfitExplanationStatus') THEN
          CREATE TYPE "ProfitExplanationStatus" AS ENUM ('SUCCESS', 'FAILED');
        END IF;
      END
      $$;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "ProfitExplanationHistory" (
        "id" TEXT NOT NULL,
        "filterHash" TEXT NOT NULL,
        "fromDate" TEXT NOT NULL,
        "toDate" TEXT NOT NULL,
        "basis" TEXT NOT NULL,
        "requestedById" TEXT,
        "promptVersion" TEXT NOT NULL,
        "keyRef" TEXT,
        "status" "ProfitExplanationStatus" NOT NULL DEFAULT 'SUCCESS',
        "evidence" JSONB NOT NULL,
        "result" JSONB,
        "errorCode" TEXT,
        "errorMessage" TEXT,
        "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "expiresAt" TIMESTAMPTZ(3) NOT NULL,
        CONSTRAINT "ProfitExplanationHistory_pkey" PRIMARY KEY ("id")
      );
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'ProfitExplanationHistory_requestedById_fkey'
        ) THEN
          ALTER TABLE "ProfitExplanationHistory"
          ADD CONSTRAINT "ProfitExplanationHistory_requestedById_fkey"
          FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
      END
      $$;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS "ProfitExplanationHistory_filterHash_createdAt_idx"
      ON "ProfitExplanationHistory" ("filterHash", "createdAt");
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS "ProfitExplanationHistory_expiresAt_idx"
      ON "ProfitExplanationHistory" ("expiresAt");
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS "ProfitExplanationHistory_requestedById_createdAt_idx"
      ON "ProfitExplanationHistory" ("requestedById", "createdAt");
    `);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
