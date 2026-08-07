import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { isTrackingExpired, isStale } from "@/lib/delivery-tracking";
import { getClientIp } from "@/lib/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// This endpoint exists to be guessed at: the token is the only credential, so
// the ceiling is what makes enumeration impractical. It used to be a per-process
// Map, which on Vercel means one counter per warm instance — the real ceiling
// was 10 × however many instances were up, i.e. not a ceiling. Backed by the
// shared ApiThrottle table it is now enforced across every instance.
//
// Traffic here is low (a customer opening their own delivery link), so the extra
// round-trip per request is not on any hot path.
const RATE_LIMIT_MAX = 10; // requests per window
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  if (!token || token.length > 64) {
    return NextResponse.json({ error: "ลิงก์ไม่ถูกต้อง" }, { status: 400 });
  }

  // Validate UUID format (basic validation: 8-4-4-4-12 hex pattern)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(token)) {
    return NextResponse.json({ error: "ลิงก์ไม่ถูกต้อง" }, { status: 400 });
  }

  // Rate limiting by IP address
  const ip = getClientIp(req.headers);
  const rate = await checkRateLimit({
    key: `liff-tracking:${ip}`,
    limit: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  if (!rate.ok) {
    return NextResponse.json(
      { error: "ขอข้อมูลบ่อยเกินไป กรุณารอสักครู่" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const sale = await db.sale.findUnique({
    where: { trackingToken: token },
    select: {
      id: true,
      saleNo: true,
      shippingStatus: true,
      shippingAddress: true,
      trackingExpiry: true,
      deliveryTracking: {
        select: { latitude: true, longitude: true, accuracy: true, updatedAt: true },
      },
      deliveryStaff: { select: { name: true, phone: true } },
    },
  });

  if (!sale) {
    return NextResponse.json({ error: "ไม่พบข้อมูลการจัดส่ง" }, { status: 404 });
  }

  if (isTrackingExpired(sale.trackingExpiry)) {
    return NextResponse.json({ error: "ลิงก์ติดตามนี้หมดอายุแล้ว" }, { status: 410 });
  }

  const driver = sale.deliveryTracking
    ? {
        lat: sale.deliveryTracking.latitude,
        lon: sale.deliveryTracking.longitude,
        accuracy: sale.deliveryTracking.accuracy,
        updatedAt: sale.deliveryTracking.updatedAt.toISOString(),
        stale: isStale(sale.deliveryTracking.updatedAt),
      }
    : null;

  return NextResponse.json(
    {
      saleNo: sale.saleNo,
      status: sale.shippingStatus,
      destination: sale.shippingAddress ?? null,
      driver,
      driverName: sale.deliveryStaff?.name ?? null,
      driverPhone: sale.deliveryStaff?.phone ?? null,
    },
    {
      headers: {
        // Cache for 30 seconds to reduce server load while keeping data reasonably fresh
        "Cache-Control": "public, max-age=30, s-maxage=30",
      },
    },
  );
}
