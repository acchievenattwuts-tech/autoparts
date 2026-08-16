import crypto from "node:crypto";
import QRCode from "qrcode";

export type VerifyDocumentType = "sale" | "receipt";
export type LiffPrintDocumentKind = "invoice" | "receipt";

export type PrintDocumentVerifyBadge = {
  verifyUrl: string;
  qrSvg: string;
};

const VERIFY_TOKEN_SEPARATOR = "|";
const LIFF_PRINT_TOKEN_MAX_AGE_SECONDS = 10 * 60;

function getDocVerifySecret() {
  const secret = process.env.DOC_VERIFY_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

export function getAppBaseUrl() {
  return (
    process.env.APP_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    "http://localhost:3000"
  ).replace(/\/+$/, "");
}

export function signDocumentVerifyToken({
  type,
  docNo,
}: {
  type: VerifyDocumentType;
  docNo: string;
}) {
  const secret = getDocVerifySecret();
  if (!secret) return null;

  return crypto
    .createHmac("sha256", secret)
    .update([type, docNo].join(VERIFY_TOKEN_SEPARATOR))
    .digest("base64url");
}

export function verifyDocumentToken({
  type,
  docNo,
  token,
}: {
  type: VerifyDocumentType;
  docNo: string;
  token: string;
}) {
  const expected = signDocumentVerifyToken({ type, docNo });
  if (!expected) return false;

  const expectedBuffer = Buffer.from(expected);
  const tokenBuffer = Buffer.from(token);

  return expectedBuffer.length === tokenBuffer.length && crypto.timingSafeEqual(expectedBuffer, tokenBuffer);
}

export type LiffPrintDocumentTokenPayload = {
  kind: LiffPrintDocumentKind;
  saleId: string;
  customerId: string;
  receiptId?: string;
};

export function signLiffPrintDocumentToken(payload: LiffPrintDocumentTokenPayload) {
  const secret = getDocVerifySecret();
  if (!secret) return null;

  const expiresAt = Math.floor(Date.now() / 1000) + LIFF_PRINT_TOKEN_MAX_AGE_SECONDS;
  const body = Buffer.from(JSON.stringify({ ...payload, expiresAt })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyLiffPrintDocumentToken({
  token,
  kind,
  saleId,
  receiptId,
}: {
  token?: string | null;
  kind: LiffPrintDocumentKind;
  saleId: string;
  receiptId?: string | null;
}): LiffPrintDocumentTokenPayload | null {
  const secret = getDocVerifySecret();
  if (!secret || !token) return null;

  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<
      LiffPrintDocumentTokenPayload & { expiresAt: unknown }
    >;
    const expiresAt = typeof payload.expiresAt === "number" ? payload.expiresAt : 0;
    if (expiresAt < Math.floor(Date.now() / 1000)) return null;
    if (payload.kind !== kind || payload.saleId !== saleId || typeof payload.customerId !== "string") return null;
    if ((receiptId ?? null) !== (payload.receiptId ?? null)) return null;

    return {
      kind: payload.kind,
      saleId: payload.saleId,
      customerId: payload.customerId,
      receiptId: payload.receiptId,
    };
  } catch {
    return null;
  }
}

export function buildLiffPrintDocumentUrl({
  kind,
  saleId,
  customerId,
  receiptId,
}: LiffPrintDocumentTokenPayload) {
  const token = signLiffPrintDocumentToken({ kind, saleId, customerId, receiptId });
  if (!token) return null;

  const receiptQuery = receiptId ? `&receiptId=${encodeURIComponent(receiptId)}` : "";
  return `${getAppBaseUrl()}/liff-print/orders/${encodeURIComponent(saleId)}/${kind}?printToken=${encodeURIComponent(token)}${receiptQuery}`;
}

export async function buildPrintDocumentVerifyBadge({
  type,
  docNo,
}: {
  type: VerifyDocumentType;
  docNo: string;
}): Promise<PrintDocumentVerifyBadge | null> {
  const token = signDocumentVerifyToken({ type, docNo });
  if (!token) return null;

  const verifyUrl = `${getAppBaseUrl()}/verify/${type}/${encodeURIComponent(docNo)}/${token}`;
  const qrSvg = await QRCode.toString(verifyUrl, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 92,
  });

  return {
    verifyUrl,
    qrSvg,
  };
}
