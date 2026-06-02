import { NextResponse } from "next/server";

import { verifyLiffIdentity } from "@/lib/liff-auth";
import { resolveCustomerByLineUserId } from "@/lib/liff-customer";
import {
  clearLiffCustomerSession,
  createLiffSessionTransferToken,
  setLiffCustomerSession,
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
  const rate = await checkRateLimit({
    key: `liff-session:${clientIp(request)}`,
    limit: RATE_LIMIT_MAX_REQUESTS,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  if (!rate.ok) {
    return NextResponse.json(
      { linked: false, error: "พบคำขอบ่อยเกินไป" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rate.resetAt - Date.now()) / 1000)) } },
    );
  }

  try {
    const body = (await request.json()) as { accessToken?: unknown; idToken?: unknown };
    const accessToken = typeof body.accessToken === "string" ? body.accessToken : "";
    const idToken = typeof body.idToken === "string" ? body.idToken : "";
    const identity = await verifyLiffIdentity({ accessToken, idToken });
    const customer = await resolveCustomerByLineUserId(identity.lineUserId);

    if (!customer) {
      await clearLiffCustomerSession();
      return NextResponse.json({ linked: false });
    }

    const session = {
      customerId: customer.id,
      lineUserId: identity.lineUserId,
    };

    await setLiffCustomerSession(session);

    return NextResponse.json({
      linked: true,
      sessionToken: createLiffSessionTransferToken(session),
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        source: customer.source,
        lineLinkedAt: customer.lineLinkedAt,
      },
    });
  } catch (error) {
    console.error(
      "[liff/session]",
      error instanceof Error ? `${error.name}: ${error.message}` : "Unknown error",
    );
    await clearLiffCustomerSession();
    return NextResponse.json(
      { linked: false, error: "ไม่สามารถยืนยันตัวตน LINE ได้" },
      { status: 401 },
    );
  }
}
