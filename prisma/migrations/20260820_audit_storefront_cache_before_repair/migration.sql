ALTER TABLE "ProductStorefrontSyncState"
ADD COLUMN "initialObservedAt" TIMESTAMPTZ(3),
ADD COLUMN "initialObservedStock" INTEGER,
ADD COLUMN "expectedStockAtAudit" INTEGER,
ADD COLUMN "mismatchDetectedAt" TIMESTAMPTZ(3),
ADD COLUMN "mismatchReason" TEXT,
ADD COLUMN "repairCount" INTEGER NOT NULL DEFAULT 0;
