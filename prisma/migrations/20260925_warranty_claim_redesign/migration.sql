-- Warranty claim redesign (2026-09-25).
-- Additive and idempotent: new enum, three nullable/defaulted columns, one index.
-- No data is rewritten or dropped.
--   * Sale.claimCancelNotes   — append-only text history of claims cancelled
--                                (deleted) from a sale's warranties.
--   * Warranty.status/cancelledAt/cancelNote — on-site (MANUAL) warranties are
--                                cancelled in place instead of being deleted.
-- Applied with narrow SQL rather than `prisma db push`, because the push still
-- proposes dropping `product_search_documents.trgm_text` and the search indexes
-- (see docs/specs/sales-quotations.md). Names match Prisma's defaults.

DO $$
BEGIN
  CREATE TYPE "WarrantyStatus" AS ENUM ('ACTIVE', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "claimCancelNotes" TEXT;

ALTER TABLE "Warranty"
  ADD COLUMN IF NOT EXISTS "status" "WarrantyStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "cancelNote" TEXT;

-- CONCURRENTLY: never blocks writes, but it MUST run outside a transaction —
-- execute this statement on its own, after the statements above.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Warranty_status_endDate_idx" ON "Warranty"("status", "endDate");
