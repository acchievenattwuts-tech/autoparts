-- E7 (owner approved 2026-09-30): fractional sale quantities.
-- Run ONLY AFTER the code that reads SaleItem.quantity as Decimal is deployed to production (owner's instruction).
-- Rewrites the SaleItem table under an ACCESS EXCLUSIVE lock; integer values convert exactly.
-- Apply with: npx prisma db execute --file prisma/migrations/20260930_sale_item_quantity_decimal/migration.sql
ALTER TABLE "SaleItem" ALTER COLUMN "quantity" TYPE DECIMAL(12,4) USING "quantity"::DECIMAL(12,4);
