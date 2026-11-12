-- ROLLBACK ONLY for triggers/01-search-document-triggers.sql (D1). Not part of the normal run.
-- Restores the row-level search-document triggers exactly as prisma/scripts/setup-search-v2.ts defined them
-- before 2026-11-12 (function bodies copied verbatim). Documents stay correct either way; only the number of
-- refreshes per statement changes back.
--   npx prisma db execute --file prisma/migrations/20261112_review_round3/triggers/rollback-search-document-triggers.sql
-- After a rollback, revert the matching part of prisma/scripts/setup-search-v2.ts too, or its next run re-applies D1.
-- lib/__tests__/search-document-triggers.golden.test.ts uses this file as the "old trigger set".

BEGIN;

DROP TRIGGER IF EXISTS product_search_document_refresh_on_alias_insert ON "ProductAlias";
DROP TRIGGER IF EXISTS product_search_document_refresh_on_alias_update ON "ProductAlias";
DROP TRIGGER IF EXISTS product_search_document_refresh_on_alias_delete ON "ProductAlias";
DROP TRIGGER IF EXISTS product_search_document_refresh_on_fitment_insert ON "ProductCarModel";
DROP TRIGGER IF EXISTS product_search_document_refresh_on_fitment_update ON "ProductCarModel";
DROP TRIGGER IF EXISTS product_search_document_refresh_on_fitment_delete ON "ProductCarModel";

CREATE OR REPLACE FUNCTION trg_refresh_product_search_document()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM product_search_documents WHERE product_id = OLD.id;
    RETURN OLD;
  END IF;

  PERFORM refresh_product_search_document(NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION trg_refresh_product_search_alias()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_product_id text;
BEGIN
  target_product_id := COALESCE(NEW."productId", OLD."productId");
  PERFORM refresh_product_search_document(target_product_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION trg_refresh_product_search_fitment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_product_id text;
BEGIN
  target_product_id := COALESCE(NEW."productId", OLD."productId");
  PERFORM refresh_product_search_document(target_product_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS product_search_document_refresh_on_product ON "Product";
CREATE TRIGGER product_search_document_refresh_on_product
AFTER INSERT OR UPDATE OR DELETE ON "Product"
FOR EACH ROW
EXECUTE FUNCTION trg_refresh_product_search_document();

DROP TRIGGER IF EXISTS product_search_document_refresh_on_alias ON "ProductAlias";
CREATE TRIGGER product_search_document_refresh_on_alias
AFTER INSERT OR UPDATE OR DELETE ON "ProductAlias"
FOR EACH ROW
EXECUTE FUNCTION trg_refresh_product_search_alias();

DROP TRIGGER IF EXISTS product_search_document_refresh_on_fitment ON "ProductCarModel";
CREATE TRIGGER product_search_document_refresh_on_fitment
AFTER INSERT OR UPDATE OR DELETE ON "ProductCarModel"
FOR EACH ROW
EXECUTE FUNCTION trg_refresh_product_search_fitment();

COMMIT;
