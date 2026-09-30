-- ก5 (owner approved 2026-09-30): fractional purchase quantities, same rollout as SaleItem (E7).
-- Run ONLY AFTER the code that reads PurchaseItem.quantity as Decimal is deployed to production.
-- Rewrites the PurchaseItem table under an ACCESS EXCLUSIVE lock; integer values convert exactly.
-- Apply with: npx prisma db execute --file prisma/migrations/20260930_purchase_item_quantity_decimal/migration.sql
ALTER TABLE "PurchaseItem" ALTER COLUMN "quantity" TYPE DECIMAL(12,4) USING "quantity"::DECIMAL(12,4);
