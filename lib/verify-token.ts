import crypto from "node:crypto";
import QRCode from "qrcode";

export type VerifyDocumentType = "sale" | "receipt";
export type PrintDocumentVerifyVariant = "ORIGINAL" | "LIFF_COPY";

export type PrintDocumentVerifyBadge = {
  variant: PrintDocumentVerifyVariant;
  verifyUrl: string;
  qrSvg: string;
};

const VERIFY_TOKEN_SEPARATOR = "|";

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

export async function buildPrintDocumentVerifyBadge({
  type,
  docNo,
  variant,
}: {
  type: VerifyDocumentType;
  docNo: string;
  variant: PrintDocumentVerifyVariant;
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
    variant,
    verifyUrl,
    qrSvg,
  };
}
