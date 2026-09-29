-- Additive only. Sale status and dispatch creation commit together.
CREATE TABLE IF NOT EXISTS "SaleLineDeliveryDispatch" (
  "id" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "eventStatus" "ShippingStatus" NOT NULL,
  "customerId" TEXT,
  "recipientLineUserId" TEXT,
  "payload" JSONB NOT NULL,
  "retryKey" UUID NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastErrorCode" TEXT,
  "lineRequestId" TEXT,
  "eventAt" TIMESTAMPTZ(3) NOT NULL,
  "firstAttemptAt" TIMESTAMPTZ(3),
  "nextAttemptAt" TIMESTAMPTZ(3),
  "leaseUntil" TIMESTAMPTZ(3),
  "acceptedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "SaleLineDeliveryDispatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SaleLineDeliveryDispatch_retryKey_key" UNIQUE ("retryKey"),
  CONSTRAINT "SaleLineDeliveryDispatch_saleId_eventStatus_key" UNIQUE ("saleId", "eventStatus"),
  CONSTRAINT "SaleLineDeliveryDispatch_saleId_fkey" FOREIGN KEY ("saleId")
    REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- Customer delivery payloads and LINE ids are server-only, like existing LINE tables.
ALTER TABLE "SaleLineDeliveryDispatch" ENABLE ROW LEVEL SECURITY;
-- Run each index-*.sql separately, outside a transaction (.rules section 6).
