import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getBangkokDayKey,
  isStorefrontPath,
  isTrackedStorefrontHost,
  normalizeStorefrontPath,
} from "@/lib/storefront-visitor";

export const dynamic = "force-dynamic";

interface StorefrontVisitPayload {
  visitorKey?: unknown;
  pathname?: unknown;
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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

  await db.storefrontVisitDaily.upsert({
    where: {
      visitorKey_visitDay: {
        visitorKey,
        visitDay,
      },
    },
    update: {
      lastPath: pathname,
    },
    create: {
      visitorKey,
      visitDay,
      entryPath: pathname,
      lastPath: pathname,
    },
  });

  return NextResponse.json({ ok: true }, { status: 202 });
}
