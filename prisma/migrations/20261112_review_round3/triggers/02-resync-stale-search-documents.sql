-- D1 follow-up. Phase A, run right AFTER triggers/01-search-document-triggers.sql:
--   npx prisma db execute --file prisma/migrations/20261112_review_round3/triggers/02-resync-stale-search-documents.sql
--
-- Why: the old Product trigger rebuilt the whole document on every Product update, so a document that had
-- gone stale (for example an alias row moved to another product, which the old row-level alias trigger
-- refreshed only for the new product) was healed by the product's next sale or purchase. The new stock-only
-- path keeps every column as it is, so this file heals any stale document once, now.
--
-- It refreshes ONLY products whose document differs from build_product_search_text() (every column the
-- refresh writes, except updated_at), products without a document, and documents without a product, with the
-- same refresh_product_search_document() the triggers use. A document that is already in sync is not
-- written. Expected result on a healthy database: nothing changes. Safe to re-run.
-- To only look first, run the SELECT inside ARRAY(...) on its own (read-only).

DO $resync$
BEGIN
  PERFORM refresh_product_search_documents_for_products(ARRAY(
  SELECT d.product_id
  FROM product_search_documents d
  LEFT JOIN LATERAL build_product_search_text(d.product_id) b ON TRUE
  WHERE b.product_code IS NULL
     OR (d.is_active, d.product_code, d.product_name, d.product_description, d.category_name, d.brand_name,
         d.alias_text, d.oem_text, d.keyword_text, d.car_brand_text, d.car_model_text, d.fitment_text,
         d.search_text, d.search_document, d.stock, d.product_created_at)
        IS DISTINCT FROM
        (b.is_active, b.product_code, b.product_name, b.product_description, b.category_name, b.brand_name,
         b.alias_text, b.oem_text, b.keyword_text, b.car_brand_text, b.car_model_text, b.fitment_text,
         b.search_text, b.search_document, b.stock, b.product_created_at)
  UNION
  SELECT p.id
  FROM "Product" p
  WHERE NOT EXISTS (SELECT 1 FROM product_search_documents d WHERE d.product_id = p.id)
  ));
END
$resync$;
