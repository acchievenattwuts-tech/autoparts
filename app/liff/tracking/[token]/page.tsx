import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { isTrackingExpired } from "@/lib/delivery-tracking";
import DeliveryTrackingClient from "./DeliveryTrackingClient";

export const dynamic = "force-dynamic";

export default async function LiffTrackingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const sale = await db.sale.findUnique({
    where: { trackingToken: token },
    select: {
      saleNo: true,
      shippingStatus: true,
      shippingAddress: true,
      trackingExpiry: true,
      destLatitude: true,
      destLongitude: true,
      deliveryTracking: {
        select: { latitude: true, longitude: true, accuracy: true, updatedAt: true },
      },
      deliveryStaff: { select: { name: true, phone: true } },
    },
  });

  if (!sale) notFound();

  if (isTrackingExpired(sale.trackingExpiry)) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-gradient-to-b from-white via-sky-50 to-white px-6 text-center">
        <div className="text-5xl">⏰</div>
        <h1 className="font-kanit text-xl font-bold text-slate-800">ลิงก์หมดอายุแล้ว</h1>
        <p className="text-sm text-slate-500">ลิงก์ติดตามการจัดส่งนี้หมดอายุแล้ว</p>
      </main>
    );
  }

  const driver = sale.deliveryTracking
    ? {
        lat: sale.deliveryTracking.latitude,
        lon: sale.deliveryTracking.longitude,
        accuracy: sale.deliveryTracking.accuracy,
        updatedAt: sale.deliveryTracking.updatedAt.toISOString(),
      }
    : null;

  return (
    <DeliveryTrackingClient
      token={token}
      saleNo={sale.saleNo}
      status={sale.shippingStatus}
      destination={sale.shippingAddress ?? null}
      destLat={sale.destLatitude ?? null}
      destLon={sale.destLongitude ?? null}
      driver={driver}
      driverName={sale.deliveryStaff?.name ?? null}
      driverPhone={sale.deliveryStaff?.phone ?? null}
    />
  );
}
