-- V8 (owner approved 2026-09-30): purchase-return DISCOUNT/OTHER lower stock cost through a
-- value-only negative StockCard row, like a negative Supplier DN adjustment.
-- Additive and compatible with the currently deployed code; apply BEFORE deploying the V8 code.
-- Apply with: npx prisma db execute --file prisma/migrations/20261001_purchase_allowance/migration.sql
ALTER TYPE "StockCardSource" ADD VALUE IF NOT EXISTS 'PURCHASE_ALLOWANCE';
