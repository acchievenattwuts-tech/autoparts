-- Phase B (any time). Run independently outside a transaction.
-- D2: GIN trigram index on the RAW search_text column (8 scans since Feb 2026, none from current code). Every search compares
-- f_unaccent(lower(search_text)), served by the idx_psd_*_unaccent_trgm indexes, so no query can use this one,
-- it only costs a write on every document change. setup-search-v2.ts no longer creates it.
DROP INDEX CONCURRENTLY IF EXISTS "idx_product_search_documents_text_trgm";
