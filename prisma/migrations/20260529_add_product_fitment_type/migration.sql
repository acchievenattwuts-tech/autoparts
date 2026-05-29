DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProductFitmentType') THEN
    CREATE TYPE "ProductFitmentType" AS ENUM (
      'DIRECT',
      'COMPATIBLE'
    );
  END IF;
END
$$;

ALTER TABLE "ProductCarModel"
  ADD COLUMN IF NOT EXISTS "fitmentType" "ProductFitmentType" NOT NULL DEFAULT 'DIRECT';

ALTER TABLE "ProductCarModel"
  ALTER COLUMN "fitmentType" SET DEFAULT 'DIRECT';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = '"ProductCarModel"'::regclass
      AND contype = 'u'
      AND conname = 'ProductCarModel_productId_carModelId_submodel_yearStart_yearEnd_engineCode_key'
  ) THEN
    ALTER TABLE "ProductCarModel"
      DROP CONSTRAINT "ProductCarModel_productId_carModelId_submodel_yearStart_yearEnd_engineCode_key";
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = '"ProductCarModel"'::regclass
      AND contype = 'u'
      AND conname = 'ProductCarModel_productId_carModelId_submodel_yearStart_yearEnd_engineCode_fitmentType_key'
  ) THEN
    ALTER TABLE "ProductCarModel"
      ADD CONSTRAINT "ProductCarModel_productId_carModelId_submodel_yearStart_yearEnd_engineCode_fitmentType_key"
      UNIQUE ("productId", "carModelId", submodel, "yearStart", "yearEnd", "engineCode", "fitmentType");
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "ProductCarModel_productId_fitmentType_idx"
  ON "ProductCarModel"("productId", "fitmentType");
