CREATE INDEX IF NOT EXISTS "Sale_customerId_status_saleDate_idx"
  ON "Sale"("customerId", "status", "saleDate" DESC);

CREATE INDEX IF NOT EXISTS "Sale_customerId_paymentType_status_amountRemain_idx"
  ON "Sale"("customerId", "paymentType", "status", "amountRemain");

CREATE INDEX IF NOT EXISTS "SaleItem_saleId_idx"
  ON "SaleItem"("saleId");

CREATE INDEX IF NOT EXISTS "Warranty_saleId_endDate_idx"
  ON "Warranty"("saleId", "endDate");

CREATE INDEX IF NOT EXISTS "WarrantyClaim_warrantyId_claimDate_idx"
  ON "WarrantyClaim"("warrantyId", "claimDate" DESC);

CREATE INDEX IF NOT EXISTS "WarrantyClaim_warrantyId_status_idx"
  ON "WarrantyClaim"("warrantyId", "status");

CREATE INDEX IF NOT EXISTS "CashBankAccount_type_isActive_isPrimaryTransferAccount_idx"
  ON "CashBankAccount"("type", "isActive", "isPrimaryTransferAccount");

CREATE INDEX IF NOT EXISTS "ReceiptItem_receiptId_idx"
  ON "ReceiptItem"("receiptId");
