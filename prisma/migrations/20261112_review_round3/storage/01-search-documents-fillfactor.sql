-- D1 (storage only). Phase B, any time after triggers/01-search-document-triggers.sql:
--   npx prisma db execute --file prisma/migrations/20261112_review_round3/storage/01-search-documents-fillfactor.sql
--
-- Leaves 30% free space on each new heap page of product_search_documents so the trigger's stock-only update
-- (every sale / purchase line) can be a HOT update: the new row version stays on the same page and none of the
-- table's 13 remaining indexes gets a new entry. No query result, row or column changes.
-- Takes SHARE UPDATE EXCLUSIVE (reads and writes continue; only VACUUM / DDL wait). No table rewrite: it applies
-- to pages written from now on (rows move to such pages as they are updated, and on the next table rewrite).
-- prisma/scripts/setup-search-v2.ts sets the same value. Undo: ALTER TABLE product_search_documents RESET (fillfactor);
ALTER TABLE product_search_documents SET (fillfactor = 70);
