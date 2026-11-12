-- Phase C. Run independently outside a transaction, only AFTER the new code is live and indexes/03.sql + 04.sql succeeded.
-- M9: drop the old unique index that also blocked keying a cancelled sale's order number again.
-- Prisma created it with CREATE UNIQUE INDEX (prisma/migrations/20260824_add_manual_shopee_sales_settlement), not as a
-- table constraint, so DROP INDEX is the matching statement.
DROP INDEX CONCURRENTLY IF EXISTS "Sale_channel_channelRefNo_key";
