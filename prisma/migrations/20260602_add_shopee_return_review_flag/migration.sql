ALTER TABLE "ShopeeOrderImport"
  ADD COLUMN "returnReviewRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "returnReviewReason" TEXT,
  ADD COLUMN "returnReviewFlaggedAt" TIMESTAMPTZ(3);

CREATE INDEX "ShopeeOrderImport_returnReviewRequired_updatedAt_idx"
  ON "ShopeeOrderImport"("returnReviewRequired", "updatedAt");
