ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "isStorefrontVisible" BOOLEAN NOT NULL DEFAULT true;

UPDATE "Product"
SET "isStorefrontVisible" = true
WHERE "isStorefrontVisible" IS DISTINCT FROM true;
