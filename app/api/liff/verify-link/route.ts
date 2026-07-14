import { NextResponse } from "next/server";

import { verifyLiffIdentity } from "@/lib/liff-auth";
import {
  getLiffPhoneLookupThrottleKeys,
  isLiffCustomerVisibleError,
  resolveLiffCustomerFromPhone,
} from "@/lib/liff-customer";
import { createLiffSessionTransferToken, setLiffCustomerSession } from "@/lib/liff-session";
import { checkRateLimit } from "@/lib/rate-limit";
import { revalidateTransactionCustomerOptions } from "@/lib/transaction-options";

export const dynamic = "force-dynamic";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for") ?? "";
  return fwd.split(",")[0].trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
}

function getVerifyLinkErrorMessage(error: unknown) {
  if (isLiffCustomerVisibleError(error)) {
    return error.message;
  }

  return "ไม่สามารถยืนยันบัญชี LINE ได้ กรุณาลองใหม่อีกครั้ง";
}

function safelyRevalidateCustomerOptions() {
  try {
    revalidateTransactionCustomerOptions();
  } catch (error) {
    // The customer link is already committed at this point. Cache maintenance
    // must not turn a successful registration into a 400 or prevent the LIFF
    // session from being created.
    console.warn(
      "[liff/verify-link] Customer option cache revalidation skipped:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
}

export async function POST(request: Request) {
  const rate = await checkRateLimit({
    key: `liff-verify-link:${clientIp(request)}`,
    limit: RATE_LIMIT_MAX_REQUESTS,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  if (!rate.ok) {
    return NextResponse.json(
      { status: "ERROR", message: "พบคำขอบ่อยเกินไป กรุณาลองใหม่ภายหลัง" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rate.resetAt - Date.now()) / 1000)) } },
    );
  }

  try {
    const body = (await request.json()) as { accessToken?: unknown; idToken?: unknown; phone?: unknown };
    const accessToken = typeof body.accessToken === "string" ? body.accessToken : "";
    const idToken = typeof body.idToken === "string" ? body.idToken : "";
    const phone = typeof body.phone === "string" ? body.phone : "";
    const identity = await verifyLiffIdentity({ accessToken, idToken });
    const result = await resolveLiffCustomerFromPhone({
      lineUserId: identity.lineUserId,
      displayName: identity.displayName,
      phone,
      throttleKeys: getLiffPhoneLookupThrottleKeys(identity.lineUserId, request),
    });

    if (result.status === "LINKED" || result.status === "REGISTERED") {
      safelyRevalidateCustomerOptions();

      const session = {
        customerId: result.customerId,
        lineUserId: identity.lineUserId,
      };

      await setLiffCustomerSession(session);

      return NextResponse.json(
        { ...result, sessionToken: createLiffSessionTransferToken(session) },
        { status: 200 },
      );
    }

    return NextResponse.json(result, {
      status: result.status === "BLOCKED" || result.status === "AMBIGUOUS" ? 409 : 200,
    });
  } catch (error) {
    console.error(
      "[liff/verify-link]",
      error instanceof Error ? `${error.name}: ${error.message}` : "Unknown error",
    );
    return NextResponse.json(
      { status: "ERROR", message: getVerifyLinkErrorMessage(error) },
      { status: 400 },
    );
  }
}
