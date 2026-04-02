import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ALLOWED_METRICS = new Set(["CLS", "FCP", "FID", "INP", "LCP", "TTFB"]);

interface WebVitalsPayload {
  id?: unknown;
  name?: unknown;
  value?: unknown;
  delta?: unknown;
  rating?: unknown;
  navigationType?: unknown;
  pathname?: unknown;
  href?: unknown;
  capturedAt?: unknown;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function POST(request: Request) {
  let payload: WebVitalsPayload;

  try {
    payload = (await request.json()) as WebVitalsPayload;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const name = asString(payload.name);
  const id = asString(payload.id);
  const pathname = asString(payload.pathname);
  const href = asString(payload.href);
  const capturedAt = asString(payload.capturedAt);
  const rating = asString(payload.rating);
  const navigationType = asString(payload.navigationType);
  const value = asNumber(payload.value);
  const delta = asNumber(payload.delta);

  if (!name || !ALLOWED_METRICS.has(name) || !id || !pathname || value === null || delta === null) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  console.info(
    "[web-vitals]",
    JSON.stringify({
      id,
      name,
      value,
      delta,
      rating,
      navigationType,
      pathname,
      href,
      capturedAt,
    }),
  );

  return NextResponse.json({ ok: true }, { status: 202 });
}
