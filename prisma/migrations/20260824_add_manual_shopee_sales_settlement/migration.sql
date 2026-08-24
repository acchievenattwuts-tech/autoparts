ALTER TABLE "ShopeeShop"
  ADD COLUMN "manualMode" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "defaultCustomerId" TEXT;

ALTER TABLE "Expense"
  ADD COLUMN "channel" "SaleChannel";

CREATE TABLE "ShopeeSettlement" (
  "id" TEXT NOT NULL,
  "settlementNo" TEXT NOT NULL,
  "payoutRef" TEXT NOT NULL,
  "settlementDate" TIMESTAMPTZ(3) NOT NULL,
  "shopRecordId" TEXT NOT NULL,
  "sourceAccountId" TEXT NOT NULL,
  "destinationAccountId" TEXT NOT NULL,
  "salesAmount" DECIMAL(10,2) NOT NULL,
  "feeAmount" DECIMAL(10,2) NOT NULL,
  "payoutAmount" DECIMAL(10,2) NOT NULL,
  "expenseId" TEXT,
  "cashBankTransferId" TEXT NOT NULL,
  "status" "DocStatus" NOT NULL DEFAULT 'ACTIVE',
  "cancelNote" TEXT,
  "cancelledAt" TIMESTAMPTZ(3),
  "note" TEXT,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ShopeeSettlement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShopeeSettlementSale" (
  "id" TEXT NOT NULL,
  "settlementId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "activeSaleId" TEXT,
  "saleAmount" DECIMAL(10,2) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShopeeSettlementSale_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShopeeSettlementFee" (
  "id" TEXT NOT NULL,
  "settlementId" TEXT NOT NULL,
  "lineNo" INTEGER NOT NULL,
  "feeCode" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShopeeSettlementFee_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShopeeSettlement_settlementNo_key" ON "ShopeeSettlement"("settlementNo");
CREATE UNIQUE INDEX "ShopeeSettlement_payoutRef_key" ON "ShopeeSettlement"("payoutRef");
CREATE UNIQUE INDEX "ShopeeSettlement_expenseId_key" ON "ShopeeSettlement"("expenseId");
CREATE UNIQUE INDEX "ShopeeSettlement_cashBankTransferId_key" ON "ShopeeSettlement"("cashBankTransferId");
CREATE INDEX "ShopeeSettlement_settlementDate_status_idx" ON "ShopeeSettlement"("settlementDate" DESC, "status");
CREATE INDEX "ShopeeSettlement_shopRecordId_status_settlementDate_idx" ON "ShopeeSettlement"("shopRecordId", "status", "settlementDate" DESC);
CREATE INDEX "ShopeeSettlement_sourceAccountId_settlementDate_idx" ON "ShopeeSettlement"("sourceAccountId", "settlementDate" DESC);
CREATE INDEX "ShopeeSettlement_destinationAccountId_settlementDate_idx" ON "ShopeeSettlement"("destinationAccountId", "settlementDate" DESC);

CREATE UNIQUE INDEX "ShopeeSettlementSale_activeSaleId_key" ON "ShopeeSettlementSale"("activeSaleId");
CREATE UNIQUE INDEX "ShopeeSettlementSale_settlementId_saleId_key" ON "ShopeeSettlementSale"("settlementId", "saleId");
CREATE INDEX "ShopeeSettlementSale_settlementId_idx" ON "ShopeeSettlementSale"("settlementId");
CREATE INDEX "ShopeeSettlementSale_saleId_idx" ON "ShopeeSettlementSale"("saleId");

CREATE UNIQUE INDEX "ShopeeSettlementFee_settlementId_lineNo_key" ON "ShopeeSettlementFee"("settlementId", "lineNo");
CREATE INDEX "ShopeeSettlementFee_feeCode_createdAt_idx" ON "ShopeeSettlementFee"("feeCode", "createdAt");

CREATE INDEX "Expense_channel_expenseDate_status_idx" ON "Expense"("channel", "expenseDate" DESC, "status");
CREATE INDEX "ShopeeShop_manualMode_createdAt_idx" ON "ShopeeShop"("manualMode", "createdAt");
CREATE INDEX "ShopeeShop_defaultCustomerId_idx" ON "ShopeeShop"("defaultCustomerId");
CREATE UNIQUE INDEX "Sale_channel_channelRefNo_key" ON "Sale"("channel", "channelRefNo");

ALTER TABLE "ShopeeSettlement"
  ADD CONSTRAINT "ShopeeSettlement_shopRecordId_fkey" FOREIGN KEY ("shopRecordId") REFERENCES "ShopeeShop"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ShopeeSettlement_sourceAccountId_fkey" FOREIGN KEY ("sourceAccountId") REFERENCES "CashBankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ShopeeSettlement_destinationAccountId_fkey" FOREIGN KEY ("destinationAccountId") REFERENCES "CashBankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ShopeeSettlement_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ShopeeSettlement_cashBankTransferId_fkey" FOREIGN KEY ("cashBankTransferId") REFERENCES "CashBankTransfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ShopeeSettlement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ShopeeSettlementSale"
  ADD CONSTRAINT "ShopeeSettlementSale_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "ShopeeSettlement"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ShopeeSettlementSale_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ShopeeSettlementFee"
  ADD CONSTRAINT "ShopeeSettlementFee_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "ShopeeSettlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ShopeeShop"
  ADD CONSTRAINT "ShopeeShop_defaultCustomerId_fkey" FOREIGN KEY ("defaultCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
