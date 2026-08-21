ALTER TYPE "CashBankSourceType" ADD VALUE 'CUSTOMER_ADVANCE';
ALTER TYPE "DocumentPaymentDocType" ADD VALUE 'CUSTOMER_ADVANCE';

CREATE TABLE "CustomerAdvance" (
  "id" TEXT NOT NULL,
  "advanceNo" TEXT NOT NULL,
  "advanceDate" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "customerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "totalAmount" DECIMAL(10,2) NOT NULL,
  "amountRemain" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'TRANSFER',
  "note" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "cancelNote" TEXT,
  "cancelledAt" TIMESTAMPTZ(3),
  "status" "DocStatus" NOT NULL DEFAULT 'ACTIVE',
  "cashBankAccountId" TEXT,
  CONSTRAINT "CustomerAdvance_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ReceiptItem" ADD COLUMN "customerAdvanceId" TEXT;

CREATE UNIQUE INDEX "CustomerAdvance_advanceNo_key" ON "CustomerAdvance"("advanceNo");
CREATE INDEX "CustomerAdvance_advanceDate_status_idx" ON "CustomerAdvance"("advanceDate" DESC, "status");
CREATE INDEX "CustomerAdvance_cashBankAccountId_advanceDate_status_idx" ON "CustomerAdvance"("cashBankAccountId", "advanceDate" DESC, "status");
CREATE INDEX "CustomerAdvance_customerId_status_idx" ON "CustomerAdvance"("customerId", "status");
CREATE INDEX "CustomerAdvance_cashBankAccountId_idx" ON "CustomerAdvance"("cashBankAccountId");
CREATE INDEX "CustomerAdvance_userId_idx" ON "CustomerAdvance"("userId");
CREATE INDEX "ReceiptItem_customerAdvanceId_idx" ON "ReceiptItem"("customerAdvanceId");

ALTER TABLE "CustomerAdvance" ADD CONSTRAINT "CustomerAdvance_cashBankAccountId_fkey" FOREIGN KEY ("cashBankAccountId") REFERENCES "CashBankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerAdvance" ADD CONSTRAINT "CustomerAdvance_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerAdvance" ADD CONSTRAINT "CustomerAdvance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReceiptItem" ADD CONSTRAINT "ReceiptItem_customerAdvanceId_fkey" FOREIGN KEY ("customerAdvanceId") REFERENCES "CustomerAdvance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
