import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

const LIFF_CUSTOMER_SESSION_COOKIE = "sriwan_liff_customer";
const LIFF_CUSTOMER_PARTITIONED_SESSION_COOKIE = "sriwan_liff_customer_partitioned";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export type LiffCustomerSession = {
  customerId: string;
  lineUserId: string;
};

function getSessionSecret() {
  const secret = process.env.DOC_VERIFY_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("DOC_VERIFY_SECRET must be at least 32 characters for LIFF sessions");
  }
  return secret;
}

function signSessionPayload(payload: string) {
  return createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function getLiffSessionCookieOptions() {
  const isProduction = process.env.NODE_ENV === "production";

  return {
    httpOnly: true,
    priority: "high" as const,
    sameSite: isProduction ? ("none" as const) : ("lax" as const),
    secure: isProduction,
    path: "/",
  };
}

function getLiffPartitionedSessionCookieOptions() {
  return {
    ...getLiffSessionCookieOptions(),
    partitioned: process.env.NODE_ENV === "production",
  };
}

export function createLiffSessionValue(session: LiffCustomerSession) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({ customerId: session.customerId, lineUserId: session.lineUserId, issuedAt }),
  ).toString("base64url");
  const signature = signSessionPayload(payload);
  return `${payload}.${signature}`;
}

export function createLiffSessionTransferToken(session: LiffCustomerSession) {
  return createLiffSessionValue(session);
}

export function parseLiffSessionValue(value?: string | null): LiffCustomerSession | null {
  if (!value) return null;

  const [payload, signature] = value.split(".");
  if (!payload || !signature || !safeEqual(signSessionPayload(payload), signature)) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      customerId?: unknown;
      lineUserId?: unknown;
      issuedAt?: unknown;
    };
    const issuedAt = typeof decoded.issuedAt === "number" ? decoded.issuedAt : 0;
    const isExpired = issuedAt + SESSION_MAX_AGE_SECONDS < Math.floor(Date.now() / 1000);

    if (
      isExpired ||
      typeof decoded.customerId !== "string" ||
      typeof decoded.lineUserId !== "string"
    ) {
      return null;
    }

    return {
      customerId: decoded.customerId,
      lineUserId: decoded.lineUserId,
    };
  } catch {
    return null;
  }
}

export function parseLiffSessionTransferToken(value?: string | null) {
  return parseLiffSessionValue(value);
}

export async function getLiffCustomerSession() {
  const cookieStore = await cookies();
  return (
    parseLiffSessionValue(cookieStore.get(LIFF_CUSTOMER_SESSION_COOKIE)?.value) ??
    parseLiffSessionValue(cookieStore.get(LIFF_CUSTOMER_PARTITIONED_SESSION_COOKIE)?.value)
  );
}

async function setLiffCustomerSessionValue(sessionValue: string) {
  const cookieStore = await cookies();

  cookieStore.set(LIFF_CUSTOMER_SESSION_COOKIE, sessionValue, {
    ...getLiffSessionCookieOptions(),
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  cookieStore.set(LIFF_CUSTOMER_PARTITIONED_SESSION_COOKIE, sessionValue, {
    ...getLiffPartitionedSessionCookieOptions(),
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function setLiffCustomerSession(session: LiffCustomerSession) {
  await setLiffCustomerSessionValue(createLiffSessionValue(session));
}

export async function setLiffCustomerSessionFromTransferToken(value: string) {
  const session = parseLiffSessionTransferToken(value);
  if (!session) {
    throw new Error("INVALID_LIFF_SESSION_TRANSFER_TOKEN");
  }

  await setLiffCustomerSessionValue(value);
  return session;
}

export async function clearLiffCustomerSession() {
  const cookieStore = await cookies();
  cookieStore.set(LIFF_CUSTOMER_SESSION_COOKIE, "", {
    ...getLiffSessionCookieOptions(),
    maxAge: 0,
  });
  cookieStore.set(LIFF_CUSTOMER_PARTITIONED_SESSION_COOKIE, "", {
    ...getLiffPartitionedSessionCookieOptions(),
    maxAge: 0,
  });
}
