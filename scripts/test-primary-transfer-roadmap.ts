import assert from "node:assert/strict";

import { CashBankAccountType, SalePaymentType } from "../lib/generated/prisma";
import { getPrimaryTransferRuleViolation, getTransferDocumentState } from "../lib/cash-bank-primary-transfer";

function runPrimaryTransferRuleChecks() {
  assert.equal(
    getPrimaryTransferRuleViolation({
      type: CashBankAccountType.BANK,
      isActive: true,
      isPrimaryTransferAccount: false,
      promptPayId: null,
      hasAnotherPrimary: true,
    }),
    null,
  );

  assert.equal(
    getPrimaryTransferRuleViolation({
      type: CashBankAccountType.CASH,
      isActive: true,
      isPrimaryTransferAccount: true,
      promptPayId: "0812345678",
    }),
    "PRIMARY_REQUIRES_BANK",
  );

  assert.equal(
    getPrimaryTransferRuleViolation({
      type: CashBankAccountType.BANK,
      isActive: false,
      isPrimaryTransferAccount: true,
      promptPayId: "0812345678",
    }),
    "PRIMARY_REQUIRES_ACTIVE",
  );

  assert.equal(
    getPrimaryTransferRuleViolation({
      type: CashBankAccountType.BANK,
      isActive: true,
      isPrimaryTransferAccount: true,
      promptPayId: "",
    }),
    "PRIMARY_REQUIRES_PROMPTPAY",
  );

  assert.equal(
    getPrimaryTransferRuleViolation({
      type: CashBankAccountType.BANK,
      isActive: true,
      isPrimaryTransferAccount: true,
      promptPayId: "0812345678",
      hasAnotherPrimary: true,
    }),
    "PRIMARY_ALREADY_EXISTS",
  );

  assert.equal(
    getPrimaryTransferRuleViolation({
      type: CashBankAccountType.BANK,
      isActive: true,
      isPrimaryTransferAccount: true,
      promptPayId: "0812345678",
      hasAnotherPrimary: false,
    }),
    null,
  );
}

function runTransferDocumentChecks() {
  const withPrimary = {
    promptPayId: "0812345678",
  };

  const noPrimaryCreditSale = getTransferDocumentState({
    paymentType: SalePaymentType.CREDIT_SALE,
    netAmount: 1250.5,
    primaryTransferAccount: null,
  });
  assert.equal(noPrimaryCreditSale.shouldShowTransferSection, false);
  assert.equal(noPrimaryCreditSale.shouldGenerateQr, false);

  const withPrimaryCreditSale = getTransferDocumentState({
    paymentType: SalePaymentType.CREDIT_SALE,
    netAmount: 1250.5,
    primaryTransferAccount: withPrimary,
  });
  assert.equal(withPrimaryCreditSale.shouldShowTransferSection, true);
  assert.equal(withPrimaryCreditSale.shouldGenerateQr, true);
  assert.equal(withPrimaryCreditSale.qrAmount, 1250.5);

  const withoutPromptPay = getTransferDocumentState({
    paymentType: SalePaymentType.CREDIT_SALE,
    netAmount: 999.99,
    primaryTransferAccount: { promptPayId: null },
  });
  assert.equal(withoutPromptPay.shouldShowTransferSection, true);
  assert.equal(withoutPromptPay.shouldGenerateQr, false);
  assert.equal(withoutPromptPay.qrAmount, 999.99);

  const cashSale = getTransferDocumentState({
    paymentType: SalePaymentType.CASH_SALE,
    netAmount: 777,
    primaryTransferAccount: withPrimary,
  });
  assert.equal(cashSale.shouldShowTransferSection, false);
  assert.equal(cashSale.shouldGenerateQr, false);
}

runPrimaryTransferRuleChecks();
runTransferDocumentChecks();

console.log("Primary transfer roadmap checks passed");
