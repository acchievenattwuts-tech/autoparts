-- Phase A guard, read-only. Run BEFORE indexes/03.sql:
--   npx prisma db execute --file prisma/migrations/20261112_review_round3/checks/01-sale-channel-ref-duplicates.sql
-- Fails, naming the sales, when two ACTIVE sales of one channel hold the same order number once compared upper-case
-- without surrounding spaces. indexes/03.sql cannot be built over such rows: stop and ask the owner which sale keeps
-- the number. Succeeds silently otherwise. Writes nothing.
DO $check$
DECLARE
  duplicates text;
BEGIN
  SELECT string_agg(format('%s %s: %s', dup.channel, dup.ref_key, dup.sale_nos), E'\n' ORDER BY dup.channel, dup.ref_key)
    INTO duplicates
  FROM (
    SELECT s."channel"::text AS channel,
           upper(btrim(s."channelRefNo")) AS ref_key,
           string_agg(s."saleNo", ', ' ORDER BY s."saleNo") AS sale_nos
    FROM "Sale" s
    WHERE s."status" = 'ACTIVE' AND s."channelRefNo" IS NOT NULL
    GROUP BY s."channel", upper(btrim(s."channelRefNo"))
    HAVING count(*) > 1
  ) dup;

  IF duplicates IS NOT NULL THEN
    RAISE EXCEPTION 'ACTIVE sales share a marketplace order number (compared upper-case, trimmed):%', E'\n' || duplicates;
  END IF;
  RAISE NOTICE 'OK: no ACTIVE sales share a marketplace order number.';
END
$check$;
