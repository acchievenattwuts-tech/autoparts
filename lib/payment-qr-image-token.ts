import crypto from "node:crypto";

import { getAppBaseUrl } from "./verify-token";

/**
 * The PromptPay QR image endpoint has to be reachable without cookies: when a QR is
 * pushed into a customer chat, LINE's own servers fetch the URL, and when the customer
 * opens it in an external browser the LIFF session cookie is not carried over either.
 *
 * A short-lived HMAC token keeps the URL unguessable, and it deliberately carries only
 * the amount — never a customer id or sale id — so a leaked link says nothing about who
 * it was built for. The window is short enough that a stale outstanding balance cannot
 * be replayed for long.
 */
const PAYMENT_QR_IMAGE_TOKEN_MAX_AGE_SECONDS = 30 * 60;

/** Guards against a malformed signed payload asking for an absurd QR. */
const MAX_PAYMENT_QR_AMOUNT = 10_000_000;

export type PaymentQrImageTokenPayload = {
  amount: number;
};

function getPaymentQrImageSecret(): string | null {
  const secret = process.env.DOC_VERIFY_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

function isValidAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_PAYMENT_QR_AMOUNT;
}

export function signPaymentQrImageToken(amount: number): string | null {
  const secret = getPaymentQrImageSecret();
  if (!secret || !isValidAmount(amount)) return null;

  const expiresAt = Math.floor(Date.now() / 1000) + PAYMENT_QR_IMAGE_TOKEN_MAX_AGE_SECONDS;
  const body = Buffer.from(JSON.stringify({ amount, expiresAt })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyPaymentQrImageToken(
  token: string | null | undefined,
): PaymentQrImageTokenPayload | null {
  const secret = getPaymentQrImageSecret();
  if (!secret || !token) return null;

  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (
    expectedBuffer.length !== signatureBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<{
      amount: unknown;
      expiresAt: unknown;
    }>;

    const expiresAt = typeof payload.expiresAt === "number" ? payload.expiresAt : 0;
    if (expiresAt < Math.floor(Date.now() / 1000)) return null;
    if (!isValidAmount(payload.amount)) return null;

    return { amount: payload.amount };
  } catch {
    return null;
  }
}

/**
 * `download` switches the image response to `Content-Disposition: attachment`, which is
 * what makes the external browser save the PNG straight to the device instead of just
 * displaying it. Leave it off for the LINE chat push — LINE's media proxy expects an
 * inline image.
 */
export function buildPaymentQrImageUrl(
  amount: number,
  options?: { download?: boolean },
): string | null {
  const token = signPaymentQrImageToken(amount);
  if (!token) return null;

  const url = `${getAppBaseUrl()}/api/liff/payments/qr/image?token=${encodeURIComponent(token)}`;
  return options?.download ? `${url}&download=1` : url;
}
