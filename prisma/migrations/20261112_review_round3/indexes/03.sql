-- Phase A. Run independently outside a transaction, AFTER checks/01-sale-channel-ref-duplicates.sql succeeded.
-- M9: a marketplace order number is unique among ACTIVE sales only, compared upper-case and without surrounding
-- spaces, so a cancelled sale's number can be keyed again and 'ABC' / ' abc ' cannot both be ACTIVE.
-- Effect on the deployed code: numbers it accepts today stay accepted, except an ACTIVE sale whose number differs from
-- another ACTIVE sale of the same channel only by letter case or surrounding spaces, which is now refused (the approved
-- M9 rule). The old unique index (indexes/28.sql) still blocks reusing a cancelled number until Phase C.
-- If this statement fails, it leaves an INVALID index. Drop it with
-- DROP INDEX CONCURRENTLY IF EXISTS "Sale_active_channel_ref_key" before retrying.
-- Not expressible in schema.prisma (partial expression index), listed in KNOWN_UNMODELED_DRIFT_STATEMENTS.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "Sale_active_channel_ref_key"
  ON "Sale" ("channel", upper(btrim("channelRefNo")))
  WHERE "status" = 'ACTIVE' AND "channelRefNo" IS NOT NULL;
