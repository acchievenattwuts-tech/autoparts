-- Run independently outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProductAlias_oem_alias_norm_idx"
  ON "ProductAlias" ((f_unaccent(lower(regexp_replace(btrim(alias), '[[:space:]]+', ' ', 'g')))))
  WHERE kind IN ('OEM', 'PART_NO', 'CROSS_REF');
