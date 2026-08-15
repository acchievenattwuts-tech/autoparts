import QRCode from "qrcode";
import generatePromptPayPayload from "promptpay-qr";

import { getTransferDocumentState } from "./cash-bank-primary-transfer";
import { db } from "./db";

export type PrimaryTransferAccount = {
  id: string;
  name: string;
  bankName: string | null;
  accountNo: string | null;
  promptPayId: string | null;
};

export async function getPrimaryTransferAccount(): Promise<PrimaryTransferAccount | null> {
  return db.cashBankAccount.findFirst({
    where: {
      type: "BANK",
      isActive: true,
      isPrimaryTransferAccount: true,
    },
    select: {
      id: true,
      name: true,
      bankName: true,
      accountNo: true,
      promptPayId: true,
    },
  });
}

/** Intrinsic PNG width used by the print/document QR blocks. */
const DEFAULT_QR_WIDTH = 180;

export async function buildPromptPayQrDataUrl(
  promptPayId: string | null | undefined,
  amount: number,
  width: number = DEFAULT_QR_WIDTH,
): Promise<string | null> {
  const normalizedPromptPayId = promptPayId?.trim();
  if (!normalizedPromptPayId) return null;

  const payload = generatePromptPayPayload(normalizedPromptPayId, { amount });
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 1,
    width,
  });
}

/**
 * PNG bytes for the same QR, used by the public image endpoint that LINE's servers
 * fetch when a PromptPay QR is pushed into a customer chat. A data URL cannot be used
 * there — LINE image messages only accept HTTPS URLs.
 */
export async function buildPromptPayQrPngBuffer(
  promptPayId: string | null | undefined,
  amount: number,
  width: number = DEFAULT_QR_WIDTH,
): Promise<Buffer | null> {
  const normalizedPromptPayId = promptPayId?.trim();
  if (!normalizedPromptPayId) return null;

  const payload = generatePromptPayPayload(normalizedPromptPayId, { amount });
  return QRCode.toBuffer(payload, {
    errorCorrectionLevel: "M",
    margin: 1,
    width,
  });
}

export { getTransferDocumentState };
