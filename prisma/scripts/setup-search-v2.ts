import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to set up Search V2.");
}

const setupSql = `
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- IMMUTABLE wrapper around unaccent so it can be used in expression indexes.
-- (unaccent() itself is marked STABLE which prevents direct use in CREATE INDEX.)
CREATE OR REPLACE FUNCTION f_unaccent(text)
  RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $func$ SELECT public.unaccent('public.unaccent', $1) $func$;

CREATE TABLE IF NOT EXISTS product_search_documents (
  product_id text PRIMARY KEY,
  is_active boolean NOT NULL,
  product_code text NOT NULL,
  product_name text NOT NULL,
  product_description text NOT NULL DEFAULT '',
  category_name text NOT NULL DEFAULT '',
  brand_name text NOT NULL DEFAULT '',
  alias_text text NOT NULL DEFAULT '',
  oem_text text NOT NULL DEFAULT '',
  keyword_text text NOT NULL DEFAULT '',
  car_brand_text text NOT NULL DEFAULT '',
  car_model_text text NOT NULL DEFAULT '',
  fitment_text text NOT NULL DEFAULT '',
  search_text text NOT NULL DEFAULT '',
  search_document tsvector NOT NULL,
  stock integer NOT NULL DEFAULT 0,
  sales_count integer NOT NULL DEFAULT 0,
  product_created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Phase B: ensure new columns exist when upgrading from older schemas
ALTER TABLE product_search_documents
  ADD COLUMN IF NOT EXISTS oem_text text NOT NULL DEFAULT '';
ALTER TABLE product_search_documents
  ADD COLUMN IF NOT EXISTS keyword_text text NOT NULL DEFAULT '';
-- Phase Q7: popularity / availability ranking signals.
-- stock is refreshed in real time via build_product_search_text (Product
-- updates fire the refresh trigger). sales_count is a rolling 90-day units-
-- sold figure maintained out-of-band by the refresh-search-popularity script
-- (cron) -- the build function deliberately never overwrites it.
ALTER TABLE product_search_documents
  ADD COLUMN IF NOT EXISTS stock integer NOT NULL DEFAULT 0;
ALTER TABLE product_search_documents
  ADD COLUMN IF NOT EXISTS sales_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_product_search_documents_is_active
  ON product_search_documents (is_active);

CREATE INDEX IF NOT EXISTS idx_product_search_documents_created_at
  ON product_search_documents (product_created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_search_documents_code_lower
  ON product_search_documents (lower(product_code));

CREATE INDEX IF NOT EXISTS idx_product_search_documents_name_lower
  ON product_search_documents (lower(product_name));

CREATE INDEX IF NOT EXISTS idx_product_search_documents_document
  ON product_search_documents
  USING GIN (search_document);

CREATE INDEX IF NOT EXISTS idx_product_search_documents_text_trgm
  ON product_search_documents
  USING GIN (search_text gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_product_search_documents_oem_trgm
  ON product_search_documents
  USING GIN (oem_text gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_product_search_documents_keyword_trgm
  ON product_search_documents
  USING GIN (keyword_text gin_trgm_ops);

-- Phase Q2: accent-insensitive trigram indexes (use f_unaccent IMMUTABLE wrapper)
CREATE INDEX IF NOT EXISTS idx_psd_search_text_unaccent_trgm
  ON product_search_documents
  USING GIN (f_unaccent(search_text) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_psd_name_unaccent_trgm
  ON product_search_documents
  USING GIN (f_unaccent(product_name) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_psd_oem_unaccent_trgm
  ON product_search_documents
  USING GIN (f_unaccent(oem_text) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_psd_keyword_unaccent_trgm
  ON product_search_documents
  USING GIN (f_unaccent(keyword_text) gin_trgm_ops);

-- Phase Q6: accent-insensitive trigram indexes on the "did you mean" candidate
-- sources. Lets suggestDidYouMean filter with the % operator (index scan)
-- instead of computing similarity() over EVERY Product / ProductAlias /
-- SearchSynonym row on each (already-failed) query.
CREATE INDEX IF NOT EXISTS idx_product_name_unaccent_trgm
  ON "Product" USING GIN (f_unaccent(lower(name)) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_product_alias_unaccent_trgm
  ON "ProductAlias" USING GIN (f_unaccent(lower(alias)) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_search_synonym_term_unaccent_trgm
  ON "SearchSynonym" USING GIN (f_unaccent(lower(term)) gin_trgm_ops);

-- Phase B: return-type changed (added oem_text, keyword_text) — must drop first
DROP FUNCTION IF EXISTS build_product_search_text(text);

CREATE OR REPLACE FUNCTION build_product_search_text(target_product_id text)
RETURNS TABLE (
  is_active boolean,
  product_code text,
  product_name text,
  product_description text,
  category_name text,
  brand_name text,
  alias_text text,
  oem_text text,
  keyword_text text,
  car_brand_text text,
  car_model_text text,
  fitment_text text,
  search_text text,
  search_document tsvector,
  stock integer,
  product_created_at timestamptz
)
LANGUAGE sql
AS $$
  WITH alias_docs AS (
    SELECT
      pa."productId" AS product_id,
      COALESCE(string_agg(CASE WHEN pa.kind = 'ALIAS' THEN pa.alias END, ' '), '') AS alias_text,
      COALESCE(string_agg(CASE WHEN pa.kind IN ('OEM', 'PART_NO', 'CROSS_REF') THEN pa.alias END, ' '), '') AS oem_text,
      COALESCE(string_agg(CASE WHEN pa.kind IN ('KEYWORD', 'MISSPELL', 'EN', 'TH') THEN pa.alias END, ' '), '') AS keyword_text
    FROM "ProductAlias" pa
    WHERE pa."productId" = target_product_id
    GROUP BY pa."productId"
  ),
  fitment_docs AS (
    SELECT
      pcm."productId" AS product_id,
      COALESCE(string_agg(DISTINCT cb.name, ' '), '') AS car_brand_text,
      COALESCE(string_agg(DISTINCT cm.name, ' '), '') AS car_model_text,
      COALESCE(
        string_agg(
          DISTINCT concat_ws(
            ' ',
            cb.name,
            cm.name,
            pcm.submodel,
            CASE
              WHEN pcm."yearStart" IS NOT NULL AND pcm."yearEnd" IS NOT NULL
                THEN pcm."yearStart"::text || '-' || pcm."yearEnd"::text
              WHEN pcm."yearStart" IS NOT NULL
                THEN pcm."yearStart"::text || '+'
              WHEN pcm."yearEnd" IS NOT NULL
                THEN '-' || pcm."yearEnd"::text
              ELSE NULL
            END,
            pcm."engineCode",
            pcm."engineSize",
            pcm.note
          ),
          ' '
        ),
        ''
      ) AS fitment_text
    FROM "ProductCarModel" pcm
    INNER JOIN "CarModel" cm ON cm.id = pcm."carModelId"
    INNER JOIN "CarBrand" cb ON cb.id = cm."carBrandId"
    WHERE pcm."productId" = target_product_id
    GROUP BY pcm."productId"
  ),
  base AS (
    SELECT
      p."isActive" AS is_active,
      p.code AS product_code,
      p.name AS product_name,
      COALESCE(p.description, '') AS product_description,
      COALESCE(c.name, '') AS category_name,
      COALESCE(pb.name, '') AS brand_name,
      COALESCE(ad.alias_text, '') AS alias_text,
      COALESCE(ad.oem_text, '') AS oem_text,
      COALESCE(ad.keyword_text, '') AS keyword_text,
      COALESCE(fd.car_brand_text, '') AS car_brand_text,
      COALESCE(fd.car_model_text, '') AS car_model_text,
      COALESCE(fd.fitment_text, '') AS fitment_text,
      p.stock AS stock,
      p."createdAt" AS product_created_at
    FROM "Product" p
    INNER JOIN "Category" c ON c.id = p."categoryId"
    LEFT JOIN "PartsBrand" pb ON pb.id = p."brandId"
    LEFT JOIN alias_docs ad ON ad.product_id = p.id
    LEFT JOIN fitment_docs fd ON fd.product_id = p.id
    WHERE p.id = target_product_id
  )
  SELECT
    base.is_active,
    base.product_code,
    base.product_name,
    base.product_description,
    base.category_name,
    base.brand_name,
    base.alias_text,
    base.oem_text,
    base.keyword_text,
    base.car_brand_text,
    base.car_model_text,
    base.fitment_text,
    trim(concat_ws(
      ' ',
      base.product_code,
      base.product_name,
      base.product_description,
      base.category_name,
      base.brand_name,
      base.alias_text,
      base.oem_text,
      base.keyword_text,
      base.car_brand_text,
      base.car_model_text,
      base.fitment_text
    )) AS search_text,
    to_tsvector(
      'simple',
      f_unaccent(trim(concat_ws(
        ' ',
        base.product_code,
        base.product_name,
        base.product_description,
        base.category_name,
        base.brand_name,
        base.alias_text,
        base.oem_text,
        base.keyword_text,
        base.car_brand_text,
        base.car_model_text,
        base.fitment_text
      )))
    ) AS search_document,
    base.stock,
    base.product_created_at
  FROM base;
$$;

CREATE OR REPLACE FUNCTION refresh_product_search_document(target_product_id text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM product_search_documents
  WHERE product_id = target_product_id
    AND NOT EXISTS (SELECT 1 FROM "Product" p WHERE p.id = target_product_id);

  INSERT INTO product_search_documents (
    product_id,
    is_active,
    product_code,
    product_name,
    product_description,
    category_name,
    brand_name,
    alias_text,
    oem_text,
    keyword_text,
    car_brand_text,
    car_model_text,
    fitment_text,
    search_text,
    search_document,
    stock,
    product_created_at,
    updated_at
  )
  SELECT
    target_product_id,
    built.is_active,
    built.product_code,
    built.product_name,
    built.product_description,
    built.category_name,
    built.brand_name,
    built.alias_text,
    built.oem_text,
    built.keyword_text,
    built.car_brand_text,
    built.car_model_text,
    built.fitment_text,
    built.search_text,
    built.search_document,
    built.stock,
    built.product_created_at,
    now()
  FROM build_product_search_text(target_product_id) built
  ON CONFLICT (product_id) DO UPDATE SET
    is_active = EXCLUDED.is_active,
    product_code = EXCLUDED.product_code,
    product_name = EXCLUDED.product_name,
    product_description = EXCLUDED.product_description,
    category_name = EXCLUDED.category_name,
    brand_name = EXCLUDED.brand_name,
    alias_text = EXCLUDED.alias_text,
    oem_text = EXCLUDED.oem_text,
    keyword_text = EXCLUDED.keyword_text,
    car_brand_text = EXCLUDED.car_brand_text,
    car_model_text = EXCLUDED.car_model_text,
    fitment_text = EXCLUDED.fitment_text,
    search_text = EXCLUDED.search_text,
    search_document = EXCLUDED.search_document,
    stock = EXCLUDED.stock,
    product_created_at = EXCLUDED.product_created_at,
    updated_at = now();
  -- NOTE: sales_count is intentionally NOT touched here; it is owned by the
  -- popularity refresh job so per-product edits never reset it.
END;
$$;

CREATE OR REPLACE FUNCTION refresh_product_search_documents_for_products(target_product_ids text[])
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  target_product_id text;
BEGIN
  IF target_product_ids IS NULL OR array_length(target_product_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  FOREACH target_product_id IN ARRAY target_product_ids LOOP
    PERFORM refresh_product_search_document(target_product_id);
  END LOOP;
END;
$$;

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

CREATE OR REPLACE FUNCTION trg_refresh_product_search_category()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_product_search_documents_for_products(
    ARRAY(
      SELECT p.id
      FROM "Product" p
      WHERE p."categoryId" = COALESCE(NEW.id, OLD.id)
    )
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION trg_refresh_product_search_parts_brand()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_product_search_documents_for_products(
    ARRAY(
      SELECT p.id
      FROM "Product" p
      WHERE p."brandId" = COALESCE(NEW.id, OLD.id)
    )
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION trg_refresh_product_search_car_model()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_product_search_documents_for_products(
    ARRAY(
      SELECT pcm."productId"
      FROM "ProductCarModel" pcm
      WHERE pcm."carModelId" = COALESCE(NEW.id, OLD.id)
    )
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION trg_refresh_product_search_car_brand()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_product_search_documents_for_products(
    ARRAY(
      SELECT DISTINCT pcm."productId"
      FROM "ProductCarModel" pcm
      INNER JOIN "CarModel" cm ON cm.id = pcm."carModelId"
      WHERE cm."carBrandId" = COALESCE(NEW.id, OLD.id)
    )
  );
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

DROP TRIGGER IF EXISTS product_search_document_refresh_on_category ON "Category";
CREATE TRIGGER product_search_document_refresh_on_category
AFTER UPDATE ON "Category"
FOR EACH ROW
EXECUTE FUNCTION trg_refresh_product_search_category();

DROP TRIGGER IF EXISTS product_search_document_refresh_on_parts_brand ON "PartsBrand";
CREATE TRIGGER product_search_document_refresh_on_parts_brand
AFTER UPDATE ON "PartsBrand"
FOR EACH ROW
EXECUTE FUNCTION trg_refresh_product_search_parts_brand();

DROP TRIGGER IF EXISTS product_search_document_refresh_on_car_model ON "CarModel";
CREATE TRIGGER product_search_document_refresh_on_car_model
AFTER UPDATE ON "CarModel"
FOR EACH ROW
EXECUTE FUNCTION trg_refresh_product_search_car_model();

DROP TRIGGER IF EXISTS product_search_document_refresh_on_car_brand ON "CarBrand";
CREATE TRIGGER product_search_document_refresh_on_car_brand
AFTER UPDATE ON "CarBrand"
FOR EACH ROW
EXECUTE FUNCTION trg_refresh_product_search_car_brand();

-- Phase B mini-step: zero-downtime batch rebuild (no TRUNCATE)
-- Removes only orphan rows; upserts active products in batches of BATCH_SIZE.
DELETE FROM product_search_documents
WHERE product_id NOT IN (SELECT id FROM "Product");

DO $rebuild$
DECLARE
  BATCH_SIZE CONSTANT INT := 500;
  last_id TEXT := '';
  processed INT;
BEGIN
  LOOP
    WITH next_batch AS (
      SELECT p.id
      FROM "Product" p
      WHERE p.id > last_id
      ORDER BY p.id
      LIMIT BATCH_SIZE
    ),
    inserted AS (
      INSERT INTO product_search_documents (
        product_id,
        is_active,
        product_code,
        product_name,
        product_description,
        category_name,
        brand_name,
        alias_text,
        oem_text,
        keyword_text,
        car_brand_text,
        car_model_text,
        fitment_text,
        search_text,
        search_document,
        stock,
        product_created_at,
        updated_at
      )
      SELECT
        nb.id,
        built.is_active,
        built.product_code,
        built.product_name,
        built.product_description,
        built.category_name,
        built.brand_name,
        built.alias_text,
        built.oem_text,
        built.keyword_text,
        built.car_brand_text,
        built.car_model_text,
        built.fitment_text,
        built.search_text,
        built.search_document,
        built.stock,
        built.product_created_at,
        now()
      FROM next_batch nb
      INNER JOIN LATERAL build_product_search_text(nb.id) built ON TRUE
      ON CONFLICT (product_id) DO UPDATE SET
        is_active = EXCLUDED.is_active,
        product_code = EXCLUDED.product_code,
        product_name = EXCLUDED.product_name,
        product_description = EXCLUDED.product_description,
        category_name = EXCLUDED.category_name,
        brand_name = EXCLUDED.brand_name,
        alias_text = EXCLUDED.alias_text,
        oem_text = EXCLUDED.oem_text,
        keyword_text = EXCLUDED.keyword_text,
        car_brand_text = EXCLUDED.car_brand_text,
        car_model_text = EXCLUDED.car_model_text,
        fitment_text = EXCLUDED.fitment_text,
        search_text = EXCLUDED.search_text,
        search_document = EXCLUDED.search_document,
        stock = EXCLUDED.stock,
        product_created_at = EXCLUDED.product_created_at,
        updated_at = now()
      RETURNING product_id
    )
    SELECT COUNT(*), COALESCE(MAX(product_id), last_id)
      INTO processed, last_id
    FROM inserted;

    EXIT WHEN processed = 0;
    RAISE NOTICE 'product_search_documents: processed batch up to id=%, count=%', last_id, processed;
  END LOOP;
END
$rebuild$;
`;

async function main() {
  const pool = new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });

  try {
    await pool.query(setupSql);
    const { rows } = await pool.query<{ doc_total: string; product_total: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM product_search_documents) AS doc_total,
         (SELECT COUNT(*)::text FROM "Product") AS product_total`,
    );
    const docTotal = rows[0]?.doc_total ?? "0";
    const productTotal = rows[0]?.product_total ?? "0";
    if (docTotal !== productTotal) {
      console.warn(
        `Search V2 setup WARNING: docs=${docTotal} but products=${productTotal} — counts do not match.`,
      );
    }
    console.log(
      `Search V2 setup complete. Indexed products: ${docTotal} (of ${productTotal})`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Search V2 setup failed.");
  console.error(error);
  process.exitCode = 1;
});
