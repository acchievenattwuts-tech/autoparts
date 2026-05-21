/**
 * Phase C migration: ProductCarModel → ProductFitment (rename + extend)
 *
 * Run BEFORE `prisma db push` so the schema diff is empty.
 *
 * Changes applied to underlying SQL table "ProductCarModel" (name preserved
 * via @@map):
 *  1. Add nullable `id TEXT` column, populate with cuid-like values, set NOT NULL.
 *  2. Drop composite primary key (productId, carModelId).
 *  3. Add `id` as new primary key.
 *  4. Add fitment columns: submodel, yearStart, yearEnd, engineCode, engineSize, note.
 *  5. Add `createdAt timestamptz` default now (Phase A/§8 compliance).
 *  6. Add composite UNIQUE (productId, carModelId, submodel, yearStart, yearEnd, engineCode).
 *  7. Add index (carModelId, yearStart, yearEnd).
 *
 * Safe to run multiple times — every statement is idempotent.
 */

import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for Phase C migration.");
}

const sql = `
-- 1. Add id column nullable (Prisma cuid default is app-side, so we generate here)
ALTER TABLE "ProductCarModel" ADD COLUMN IF NOT EXISTS id TEXT;

-- 2. Populate existing rows with cuid-like ids
UPDATE "ProductCarModel"
   SET id = 'cfit_' || encode(gen_random_bytes(12), 'hex')
 WHERE id IS NULL;

ALTER TABLE "ProductCarModel" ALTER COLUMN id SET NOT NULL;

-- 3. Drop composite PK if still present
DO $$
DECLARE
  pk_name text;
BEGIN
  SELECT conname INTO pk_name
    FROM pg_constraint
   WHERE conrelid = '"ProductCarModel"'::regclass
     AND contype = 'p';
  IF pk_name IS NOT NULL THEN
    -- Drop the composite PK only if it is composite (covers productId + carModelId)
    IF EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = pk_name
         AND conrelid = '"ProductCarModel"'::regclass
         AND cardinality(conkey) > 1
    ) THEN
      EXECUTE format('ALTER TABLE "ProductCarModel" DROP CONSTRAINT %I CASCADE', pk_name);
    END IF;
  END IF;
END
$$;

-- 4. Add id as PK if not already
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = '"ProductCarModel"'::regclass
       AND contype = 'p'
  ) THEN
    ALTER TABLE "ProductCarModel" ADD CONSTRAINT "ProductCarModel_pkey" PRIMARY KEY (id);
  END IF;
END
$$;

-- 5. Add fitment columns (all nullable, safe for existing rows)
ALTER TABLE "ProductCarModel" ADD COLUMN IF NOT EXISTS submodel    TEXT;
ALTER TABLE "ProductCarModel" ADD COLUMN IF NOT EXISTS "yearStart" INTEGER;
ALTER TABLE "ProductCarModel" ADD COLUMN IF NOT EXISTS "yearEnd"   INTEGER;
ALTER TABLE "ProductCarModel" ADD COLUMN IF NOT EXISTS "engineCode" TEXT;
ALTER TABLE "ProductCarModel" ADD COLUMN IF NOT EXISTS "engineSize" TEXT;
ALTER TABLE "ProductCarModel" ADD COLUMN IF NOT EXISTS note         TEXT;

-- 6. createdAt timestamptz default now()
ALTER TABLE "ProductCarModel" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now();

-- 7. Composite UNIQUE for fitment dedupe (Postgres treats NULLs as distinct,
--    so multiple all-null rows could exist — admin controls via UI).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = '"ProductCarModel"'::regclass
       AND contype = 'u'
       AND conname = 'ProductCarModel_productId_carModelId_submodel_yearStart_yearEnd_engineCode_key'
  ) THEN
    ALTER TABLE "ProductCarModel"
      ADD CONSTRAINT "ProductCarModel_productId_carModelId_submodel_yearStart_yearEnd_engineCode_key"
      UNIQUE ("productId", "carModelId", submodel, "yearStart", "yearEnd", "engineCode");
  END IF;
END
$$;

-- 8. Index for year-range queries
CREATE INDEX IF NOT EXISTS "ProductCarModel_carModelId_yearStart_yearEnd_idx"
  ON "ProductCarModel" ("carModelId", "yearStart", "yearEnd");
`;

async function main() {
  const pool = new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });

  try {
    await pool.query(sql);
    const counts = await pool.query<{ rows: string }>(
      `SELECT COUNT(*)::text AS rows FROM "ProductCarModel"`,
    );
    console.log(
      `Phase C migration applied. ProductCarModel rows: ${counts.rows[0]?.rows ?? "0"}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Phase C migration failed.");
  console.error(error);
  process.exitCode = 1;
});
