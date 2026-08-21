ALTER TYPE "CashBankSourceType" ADD VALUE 'CUSTOMER_ADVANCE_REFUND';
ALTER TYPE "CashBankSourceType" ADD VALUE 'SUPPLIER_ADVANCE_REFUND';
ALTER TYPE "DocumentPaymentDocType" ADD VALUE 'CUSTOMER_ADVANCE_REFUND';
ALTER TYPE "DocumentPaymentDocType" ADD VALUE 'SUPPLIER_ADVANCE_REFUND';

CREATE TABLE "CustomerAdvanceRefund" (
  "id" TEXT NOT NULL,
  "refundNo" TEXT NOT NULL,
  "refundDate" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "customerAdvanceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "refundAmount" DECIMAL(10,2) NOT NULL,
  "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'TRANSFER',
  "note" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "cancelNote" TEXT,
  "cancelledAt" TIMESTAMPTZ(3),
  "status" "DocStatus" NOT NULL DEFAULT 'ACTIVE',
  "cashBankAccountId" TEXT,
  CONSTRAINT "CustomerAdvanceRefund_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplierAdvanceRefund" (
  "id" TEXT NOT NULL,
  "refundNo" TEXT NOT NULL,
  "refundDate" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "supplierAdvanceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "refundAmount" DECIMAL(10,2) NOT NULL,
  "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'TRANSFER',
  "note" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "cancelNote" TEXT,
  "cancelledAt" TIMESTAMPTZ(3),
  "status" "DocStatus" NOT NULL DEFAULT 'ACTIVE',
  "cashBankAccountId" TEXT,
  CONSTRAINT "SupplierAdvanceRefund_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerAdvanceRefund_refundNo_key" ON "CustomerAdvanceRefund"("refundNo");
CREATE INDEX "CustomerAdvanceRefund_refundDate_status_idx" ON "CustomerAdvanceRefund"("refundDate" DESC, "status");
CREATE INDEX "CustomerAdvanceRefund_customerAdvanceId_status_idx" ON "CustomerAdvanceRefund"("customerAdvanceId", "status");
CREATE INDEX "CustomerAdvanceRefund_cashBankAccountId_refundDate_status_idx" ON "CustomerAdvanceRefund"("cashBankAccountId", "refundDate" DESC, "status");
CREATE INDEX "CustomerAdvanceRefund_cashBankAccountId_idx" ON "CustomerAdvanceRefund"("cashBankAccountId");
CREATE INDEX "CustomerAdvanceRefund_userId_idx" ON "CustomerAdvanceRefund"("userId");

CREATE UNIQUE INDEX "SupplierAdvanceRefund_refundNo_key" ON "SupplierAdvanceRefund"("refundNo");
CREATE INDEX "SupplierAdvanceRefund_refundDate_status_idx" ON "SupplierAdvanceRefund"("refundDate" DESC, "status");
CREATE INDEX "SupplierAdvanceRefund_supplierAdvanceId_status_idx" ON "SupplierAdvanceRefund"("supplierAdvanceId", "status");
CREATE INDEX "SupplierAdvanceRefund_cashBankAccountId_refundDate_status_idx" ON "SupplierAdvanceRefund"("cashBankAccountId", "refundDate" DESC, "status");
CREATE INDEX "SupplierAdvanceRefund_cashBankAccountId_idx" ON "SupplierAdvanceRefund"("cashBankAccountId");
CREATE INDEX "SupplierAdvanceRefund_userId_idx" ON "SupplierAdvanceRefund"("userId");

ALTER TABLE "CustomerAdvanceRefund" ADD CONSTRAINT "CustomerAdvanceRefund_customerAdvanceId_fkey" FOREIGN KEY ("customerAdvanceId") REFERENCES "CustomerAdvance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerAdvanceRefund" ADD CONSTRAINT "CustomerAdvanceRefund_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerAdvanceRefund" ADD CONSTRAINT "CustomerAdvanceRefund_cashBankAccountId_fkey" FOREIGN KEY ("cashBankAccountId") REFERENCES "CashBankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SupplierAdvanceRefund" ADD CONSTRAINT "SupplierAdvanceRefund_supplierAdvanceId_fkey" FOREIGN KEY ("supplierAdvanceId") REFERENCES "SupplierAdvance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierAdvanceRefund" ADD CONSTRAINT "SupplierAdvanceRefund_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierAdvanceRefund" ADD CONSTRAINT "SupplierAdvanceRefund_cashBankAccountId_fkey" FOREIGN KEY ("cashBankAccountId") REFERENCES "CashBankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
