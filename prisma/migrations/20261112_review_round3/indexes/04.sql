-- Phase A. Run independently outside a transaction, BEFORE the old unique index is dropped (indexes/28.sql).
-- M9: plain lookup index replacing the old unique index (matches @@index([channel, channelRefNo])).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Sale_channel_channelRefNo_idx" ON "Sale" ("channel", "channelRefNo");
