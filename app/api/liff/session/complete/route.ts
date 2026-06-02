import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import {
  clearLiffCustomerSession,
  setLiffCustomerSessionFromTransferToken,
} from "@/lib/liff-session";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for") ?? "";
  return fwd.split(",")[0].trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function POST(request: Request) {
  const redirectUrl = new URL("/liff/orders", request.url);
  const linkUrl = new URL("/liff/link", request.url);

  const rate = await checkRateLimit({
    key: `liff-session-complete:${clientIp(request)}`,
    limit: RATE_LIMIT_MAX_REQUESTS,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  if (!rate.ok) {
    return NextResponse.redirect(linkUrl, 303);
  }

  try {
    const formData = await request.formData();
    const sessionToken = formData.get("sessionToken");
    const session = await setLiffCustomerSessionFromTransferToken(
      typeof sessionToken === "string" ? sessionToken : "",
    );
    const customer = await db.customer.findFirst({
      where: {
        id: session.customerId,
        lineUserId: session.lineUserId,
        isActive: true,
      },
      select: { id: true },
    });

    if (!customer) {
      await clearLiffCustomerSession();
      return NextResponse.redirect(linkUrl, 303);
    }

    return NextResponse.redirect(redirectUrl, 303);
  } catch (error) {
    console.error(
      "[liff/session/complete]",
      error instanceof Error ? `${error.name}: ${error.message}` : "Unknown error",
    );
    await clearLiffCustomerSession();
    return NextResponse.redirect(linkUrl, 303);
  }
}
