-- CN return cancels warranties (owner approved 2026-10-03).
-- Additive and idempotent: one nullable column, its FK and one index. No data is rewritten or dropped.
--   * Warranty.cancelledByCreditNoteId — set when an ACTIVE RETURN credit note (goods received back)
--     cancels the returned units' warranties; cancelling or editing that CN restores them.
-- Apply BEFORE deploying the code that reads the column.
-- Applied with narrow SQL rather than `prisma db push` (the push drops the search indexes).
-- Names match Prisma's defaults.
-- Apply with: npx prisma db execute --file prisma/migrations/20261003_cn_return_warranty/migration.sql
-- Then run indexes/01.sql on its own (outside a transaction).

ALTER TABLE "Warranty" ADD COLUMN IF NOT EXISTS "cancelledByCreditNoteId" TEXT;

DO $$
BEGIN
  ALTER TABLE "Warranty"
    ADD CONSTRAINT "Warranty_cancelledByCreditNoteId_fkey"
    FOREIGN KEY ("cancelledByCreditNoteId") REFERENCES "CreditNote"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
