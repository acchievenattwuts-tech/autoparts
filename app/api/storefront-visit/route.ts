import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  getBangkokDayKey,
  isStorefrontPath,
  isTrackedStorefrontHost,
  normalizeStorefrontPath,
} from "@/lib/storefront-visitor";

export const dynamic = "force-dynamic";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;

interface StorefrontVisitPayload {
  visitorKey?: unknown;
  pathname?: unknown;
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for") ?? "";
  return fwd.split(",")[0].trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function POST(request: Request) {
  let payload: StorefrontVisitPayload;

  try {
    payload = (await request.json()) as StorefrontVisitPayload;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const visitorKey = asString(payload.visitorKey);
  const pathname = normalizeStorefrontPath(asString(payload.pathname));
  const visitDay = getBangkokDayKey();
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  const requestHost = (() => {
    try {
      if (origin) {
        return new URL(origin).hostname;
      }

      if (referer) {
        return new URL(referer).hostname;
      }
    } catch {
      return null;
    }

    return null;
  })();

  if (
    visitorKey.length < 16 ||
    visitorKey.length > 100 ||
    pathname.length === 0 ||
    pathname.length > 300 ||
    !isStorefrontPath(pathname) ||
    (requestHost !== null && !isTrackedStorefrontHost(requestHost))
  ) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const rate = await checkRateLimit({
    key: `storefront-visit:${clientIp(request)}`,
    limit: RATE_LIMIT_MAX_REQUESTS,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rate.resetAt - Date.now()) / 1000)) } },
    );
  }

  await db.storefrontVisitDaily.createMany({
    data: [
      {
        visitorKey,
        visitDay,
        entryPath: pathname,
        lastPath: pathname,
      },
    ],
    skipDuplicates: true,
  });

  return NextResponse.json({ ok: true }, { status: 202 });
}
