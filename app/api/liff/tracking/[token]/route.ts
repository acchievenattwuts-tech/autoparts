import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { isTrackingExpired, isStale } from "@/lib/delivery-tracking";

export const dynamic = "force-dynamic";

// Simple in-memory rate limiter (resets on server restart, suitable for Vercel serverless)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_MAX = 10; // requests per window
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute window

function checkRateLimit(identifier: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(identifier);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(identifier, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }

  if (record.count >= RATE_LIMIT_MAX) {
    return false;
  }

  record.count++;
  return true;
}

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
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || req.headers.get("x-real-ip") || "unknown";
  if (!checkRateLimit(ip)) {
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
