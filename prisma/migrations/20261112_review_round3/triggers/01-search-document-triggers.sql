-- D1 (review 2026-11-12): fewer writes to product_search_documents, same documents.
-- Phase A. Safe BEFORE the code deploy: no application code reads or calls these triggers.
-- Run as one transaction (BEGIN/COMMIT below), so no statement ever runs without a refresh trigger:
--   npx prisma db execute --file prisma/migrations/20261112_review_round3/triggers/01-search-document-triggers.sql
-- Idempotent. Rollback: triggers/rollback-search-document-triggers.sql restores the row-level triggers.
--
-- The SQL between BEGIN and COMMIT is byte-identical to prisma/scripts/setup-search-v2.ts
-- (lib/__tests__/search-document-triggers.golden.test.ts compares the installed definitions).
--
-- 1. Product: an UPDATE that changes no column the document is built from except stock writes only
--    stock + updated_at (exactly what the full refresh would change); everything else refreshes as before.
-- 2. ProductAlias / ProductCarModel: statement-level triggers with transition tables refresh each affected
--    product once per statement instead of once per row (a product saved with 38 aliases: 1 refresh, not 38).
--    An UPDATE refreshes the products before AND after the change, so a row moved to another product also
--    refreshes the product it left (the row-level trigger refreshed only the new one).
-- Transition tables allow one event per trigger, hence three triggers per table.

BEGIN;

CREATE OR REPLACE FUNCTION trg_refresh_product_search_document()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM product_search_documents WHERE product_id = OLD.id;
    RETURN OLD;
  END IF;

  -- build_product_search_text reads these Product columns: id, isActive, code,
  -- name, description, categoryId, brandId, stock and createdAt. When none but
  -- stock changed (every sale, purchase, return and stock adjustment), the full
  -- refresh would rewrite each other column with the value it already holds and
  -- set updated_at = now(), so write exactly stock and updated_at. Without a
  -- document row yet, fall through to the full refresh, which inserts it.
  IF TG_OP = 'UPDATE'
     AND NEW.id IS NOT DISTINCT FROM OLD.id
     AND NEW."isActive" IS NOT DISTINCT FROM OLD."isActive"
     AND NEW.code IS NOT DISTINCT FROM OLD.code
     AND NEW.name IS NOT DISTINCT FROM OLD.name
     AND NEW.description IS NOT DISTINCT FROM OLD.description
     AND NEW."categoryId" IS NOT DISTINCT FROM OLD."categoryId"
     AND NEW."brandId" IS NOT DISTINCT FROM OLD."brandId"
     AND NEW."createdAt" IS NOT DISTINCT FROM OLD."createdAt"
  THEN
    UPDATE product_search_documents
    SET stock = NEW.stock,
        updated_at = now()
    WHERE product_id = NEW.id;
    IF FOUND THEN
      RETURN NEW;
    END IF;
  END IF;

  PERFORM refresh_product_search_document(NEW.id);
  RETURN NEW;
END;
$$;

-- Statement-level: one refresh per affected product per statement. An UPDATE
-- refreshes the product before and after the change, so a row moved to another
-- product also refreshes the product it left.
CREATE OR REPLACE FUNCTION trg_refresh_product_search_alias()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM refresh_product_search_documents_for_products(ARRAY(
      SELECT DISTINCT changed."productId" FROM product_search_new_rows changed
    ));
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM refresh_product_search_documents_for_products(ARRAY(
      SELECT changed."productId" FROM product_search_new_rows changed
      UNION
      SELECT changed."productId" FROM product_search_old_rows changed
    ));
  ELSE
    PERFORM refresh_product_search_documents_for_products(ARRAY(
      SELECT DISTINCT changed."productId" FROM product_search_old_rows changed
    ));
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trg_refresh_product_search_fitment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM refresh_product_search_documents_for_products(ARRAY(
      SELECT DISTINCT changed."productId" FROM product_search_new_rows changed
    ));
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM refresh_product_search_documents_for_products(ARRAY(
      SELECT changed."productId" FROM product_search_new_rows changed
      UNION
      SELECT changed."productId" FROM product_search_old_rows changed
    ));
  ELSE
    PERFORM refresh_product_search_documents_for_products(ARRAY(
      SELECT DISTINCT changed."productId" FROM product_search_old_rows changed
    ));
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS product_search_document_refresh_on_product ON "Product";
CREATE TRIGGER product_search_document_refresh_on_product
AFTER INSERT OR UPDATE OR DELETE ON "Product"
FOR EACH ROW
EXECUTE FUNCTION trg_refresh_product_search_document();

DROP TRIGGER IF EXISTS product_search_document_refresh_on_alias ON "ProductAlias";
DROP TRIGGER IF EXISTS product_search_document_refresh_on_alias_insert ON "ProductAlias";
CREATE TRIGGER product_search_document_refresh_on_alias_insert
AFTER INSERT ON "ProductAlias"
REFERENCING NEW TABLE AS product_search_new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION trg_refresh_product_search_alias();
DROP TRIGGER IF EXISTS product_search_document_refresh_on_alias_update ON "ProductAlias";
CREATE TRIGGER product_search_document_refresh_on_alias_update
AFTER UPDATE ON "ProductAlias"
REFERENCING OLD TABLE AS product_search_old_rows NEW TABLE AS product_search_new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION trg_refresh_product_search_alias();
DROP TRIGGER IF EXISTS product_search_document_refresh_on_alias_delete ON "ProductAlias";
CREATE TRIGGER product_search_document_refresh_on_alias_delete
AFTER DELETE ON "ProductAlias"
REFERENCING OLD TABLE AS product_search_old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION trg_refresh_product_search_alias();

DROP TRIGGER IF EXISTS product_search_document_refresh_on_fitment ON "ProductCarModel";
DROP TRIGGER IF EXISTS product_search_document_refresh_on_fitment_insert ON "ProductCarModel";
CREATE TRIGGER product_search_document_refresh_on_fitment_insert
AFTER INSERT ON "ProductCarModel"
REFERENCING NEW TABLE AS product_search_new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION trg_refresh_product_search_fitment();
DROP TRIGGER IF EXISTS product_search_document_refresh_on_fitment_update ON "ProductCarModel";
CREATE TRIGGER product_search_document_refresh_on_fitment_update
AFTER UPDATE ON "ProductCarModel"
REFERENCING OLD TABLE AS product_search_old_rows NEW TABLE AS product_search_new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION trg_refresh_product_search_fitment();
DROP TRIGGER IF EXISTS product_search_document_refresh_on_fitment_delete ON "ProductCarModel";
CREATE TRIGGER product_search_document_refresh_on_fitment_delete
AFTER DELETE ON "ProductCarModel"
REFERENCING OLD TABLE AS product_search_old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION trg_refresh_product_search_fitment();

COMMIT;
