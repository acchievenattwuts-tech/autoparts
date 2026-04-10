import { CashBankAccountType, SalePaymentType, type CashBankAccountType as CashBankAccountTypeValue, type SalePaymentType as SalePaymentTypeValue } from "@/lib/generated/prisma";

export type PrimaryTransferRuleCode =
  | "PRIMARY_REQUIRES_BANK"
  | "PRIMARY_REQUIRES_ACTIVE"
  | "PRIMARY_REQUIRES_PROMPTPAY"
  | "PRIMARY_ALREADY_EXISTS";

export type PrimaryTransferRuleInput = {
  type: CashBankAccountTypeValue;
  isActive: boolean;
  isPrimaryTransferAccount: boolean;
  promptPayId?: string | null;
  hasAnotherPrimary?: boolean;
};

export type TransferDocumentStateInput = {
  paymentType: SalePaymentTypeValue;
  netAmount: number;
  primaryTransferAccount?: {
    promptPayId: string | null;
  } | null;
};

export function getPrimaryTransferRuleViolation(
  input: PrimaryTransferRuleInput,
): PrimaryTransferRuleCode | null {
  if (!input.isPrimaryTransferAccount) return null;
  if (input.type !== CashBankAccountType.BANK) return "PRIMARY_REQUIRES_BANK";
  if (!input.isActive) return "PRIMARY_REQUIRES_ACTIVE";
  if (!input.promptPayId?.trim()) return "PRIMARY_REQUIRES_PROMPTPAY";
  if (input.hasAnotherPrimary) return "PRIMARY_ALREADY_EXISTS";
  return null;
}

export function getTransferDocumentState(input: TransferDocumentStateInput) {
  const qrAmount = Number(input.netAmount);
  const shouldShowTransferSection =
    input.paymentType === SalePaymentType.CREDIT_SALE && Boolean(input.primaryTransferAccount);
  const hasPromptPayId = Boolean(input.primaryTransferAccount?.promptPayId?.trim());

  return {
    qrAmount,
    shouldShowTransferSection,
    shouldGenerateQr: shouldShowTransferSection && hasPromptPayId,
  };
}
