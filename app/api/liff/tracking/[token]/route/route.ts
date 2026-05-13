import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  estimateDeliveryRoute,
  fetchOsrmRouteWithFailover,
  isTrackingExpired,
  type TrackingRouteResponse,
} from "@/lib/delivery-tracking";

export const dynamic = "force-dynamic";

const routeParamsSchema = z.object({
  token: z.string().uuid().max(64),
});

const emptyRouteResponse = (provider: TrackingRouteResponse["provider"]): TrackingRouteResponse => ({
  status: "ok",
  coordinates: null,
  distanceMetres: null,
  durationSeconds: null,
  estimated: provider === "estimated",
  provider,
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const parsed = routeParamsSchema.safeParse(await params);
    if (!parsed.success) {
      return NextResponse.json({ error: "ลิงก์ไม่ถูกต้อง" }, { status: 400 });
    }

    const sale = await db.sale.findUnique({
      where: { trackingToken: parsed.data.token },
      select: {
        id: true,
        trackingExpiry: true,
        destLatitude: true,
        destLongitude: true,
        deliveryTracking: {
          select: { latitude: true, longitude: true },
        },
      },
    });

    if (!sale) {
      return NextResponse.json({ error: "ไม่พบข้อมูลการจัดส่ง" }, { status: 404 });
    }

    if (isTrackingExpired(sale.trackingExpiry)) {
      return NextResponse.json({ error: "ลิงก์ติดตามนี้หมดอายุแล้ว" }, { status: 410 });
    }

    const driver = sale.deliveryTracking;
    if (
      !driver ||
      sale.destLatitude === null ||
      sale.destLongitude === null
    ) {
      console.warn("Delivery route skipped", { saleId: sale.id, provider: "none" });
      return NextResponse.json(emptyRouteResponse("none"), {
        headers: { "Cache-Control": "no-store" },
      });
    }

    const route = await fetchOsrmRouteWithFailover(
      driver.latitude,
      driver.longitude,
      sale.destLatitude,
      sale.destLongitude,
    );

    if (route) {
      console.info("Delivery route resolved", { saleId: sale.id, provider: route.provider });
      return NextResponse.json(
        {
          status: "ok",
          coordinates: route.coordinates,
          distanceMetres: route.distanceMetres,
          durationSeconds: route.durationSeconds,
          estimated: false,
          provider: route.provider,
        } satisfies TrackingRouteResponse,
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const estimatedRoute = estimateDeliveryRoute(
      driver.latitude,
      driver.longitude,
      sale.destLatitude,
      sale.destLongitude,
    );
    console.warn("Delivery route estimated", { saleId: sale.id, provider: "estimated" });

    return NextResponse.json(
      {
        status: "ok",
        coordinates: null,
        distanceMetres: estimatedRoute.distanceMetres,
        durationSeconds: estimatedRoute.durationSeconds,
        estimated: true,
        provider: "estimated",
      } satisfies TrackingRouteResponse,
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Delivery route lookup failed", error);
    return NextResponse.json({ error: "ไม่สามารถคำนวณเส้นทางได้" }, { status: 500 });
  }
}
