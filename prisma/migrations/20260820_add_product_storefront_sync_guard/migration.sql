CREATE TYPE "ProductStorefrontSyncStatus" AS ENUM ('PENDING', 'PROCESSING', 'RETRYING', 'VERIFIED', 'FAILED');

CREATE TABLE "ProductStorefrontSyncState" (
    "productId" TEXT NOT NULL,
    "expectedUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
    "canonicalPath" TEXT NOT NULL,
    "status" "ProductStorefrontSyncStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastObservedUpdatedAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "verifiedAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "telegramNotifiedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProductStorefrontSyncState_pkey" PRIMARY KEY ("productId")
);

CREATE TABLE "ProductStorefrontStockInvalidation" (
    "productId" TEXT NOT NULL,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductStorefrontStockInvalidation_pkey" PRIMARY KEY ("productId")
);

CREATE INDEX "ProductStorefrontSyncState_status_nextAttemptAt_idx"
ON "ProductStorefrontSyncState"("status", "nextAttemptAt");

CREATE INDEX "ProductStorefrontStockInvalidation_requestedAt_idx"
ON "ProductStorefrontStockInvalidation"("requestedAt");

ALTER TABLE "ProductStorefrontSyncState"
ADD CONSTRAINT "ProductStorefrontSyncState_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductStorefrontStockInvalidation"
ADD CONSTRAINT "ProductStorefrontStockInvalidation_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
