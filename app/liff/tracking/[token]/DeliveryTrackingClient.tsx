"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Clock, Loader2, MapPin, Navigation, Phone, Truck } from "lucide-react";

import {
  fetchOsrmRoute,
  formatDistance,
  formatEta,
  haversineDistance,
  isNearby,
  shouldRecalcRoute,
} from "@/lib/delivery-tracking";

const POLL_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes
const STALE_MINUTES = 30;

type ShippingStatus = "PENDING" | "PREPARING" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";

type Driver = { lat: number; lon: number; accuracy: number; updatedAt: string };

type TrackingData = {
  status: ShippingStatus;
  driver: Driver | null;
  driverName: string | null;
  driverPhone: string | null;
  destination: string | null;
};

type Props = {
  token: string;
  saleNo: string;
  status: ShippingStatus;
  destination: string | null;
  destLat: number | null;
  destLon: number | null;
  driver: Driver | null;
  driverName: string | null;
  driverPhone: string | null;
};

const STATUS_LABEL: Record<ShippingStatus, string> = {
  PENDING: "รอจัดส่ง",
  PREPARING: "เตรียมสินค้า",
  OUT_FOR_DELIVERY: "กำลังจัดส่ง",
  DELIVERED: "จัดส่งแล้ว ✓",
  CANCELLED: "ยกเลิก",
};

const STATUS_COLOR: Record<ShippingStatus, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  PREPARING: "bg-blue-100 text-blue-800",
  OUT_FOR_DELIVERY: "bg-blue-100 text-blue-800",
  DELIVERED: "bg-green-100 text-green-800",
  CANCELLED: "bg-red-100 text-red-800",
};

function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  const minutesAgo = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutesAgo < 1) return "เมื่อสักครู่";
  if (minutesAgo < 60) return `${minutesAgo} นาทีที่แล้ว`;
  return date.toLocaleTimeString("th-TH-u-ca-gregory", { hour: "2-digit", minute: "2-digit" });
}

export default function DeliveryTrackingClient({
  token,
  saleNo,
  status: initialStatus,
  destination,
  destLat,
  destLon,
  driver: initialDriver,
  driverName,
  driverPhone,
}: Props) {
  // Tracking state — only text fields use useState (map uses refs)
  const [data, setData] = useState<TrackingData>({
    status: initialStatus,
    destination: destination ?? null,
    driver: initialDriver ?? null,
    driverName: driverName ?? null,
    driverPhone: driverPhone ?? null,
  });
  const [pollError, setPollError] = useState(false);
  const [eta, setEta] = useState<{ duration: number; distance: number } | null>(null);
  const [pollInterval, setPollInterval] = useState(POLL_INTERVAL_MS);
  const [consecutiveErrors, setConsecutiveErrors] = useState(0);
  const [mapLoading, setMapLoading] = useState(true);

  // Map refs — never recreated
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const driverMarkerRef = useRef<import("leaflet").Marker | null>(null);
  const destMarkerRef = useRef<import("leaflet").Marker | null>(null);
  const routeLayerRef = useRef<import("leaflet").Polyline | null>(null);
  const prevDriverPosRef = useRef<{ lat: number; lon: number } | null>(null);
  const driverIconRef = useRef<import("leaflet").DivIcon | null>(null);
  const destIconRef = useRef<import("leaflet").DivIcon | null>(null);

  // Initialize Leaflet map exactly once
  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;

    let isMounted = true;

    (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");

      if (!isMounted || !mapContainerRef.current) return;

      const initialCenter: [number, number] =
        initialDriver
          ? [initialDriver.lat, initialDriver.lon]
          : destLat && destLon
          ? [destLat, destLon]
          : [13.7563, 100.5018]; // Bangkok fallback

      const map = L.map(mapContainerRef.current, {
        center: initialCenter,
        zoom: 14,
        zoomControl: false,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;
      setMapLoading(false);

      // Cache icons in refs to avoid recreating on re-renders
      if (!driverIconRef.current) {
        driverIconRef.current = L.divIcon({
          className: "",
          html: '<div style="font-size:28px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,.4))">🚚</div>',
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        });
      }

      if (!destIconRef.current) {
        destIconRef.current = L.divIcon({
          className: "",
          html: '<div style="font-size:28px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,.4))">📦</div>',
          iconSize: [36, 36],
          iconAnchor: [18, 36],
        });
      }

      if (initialDriver) {
        driverMarkerRef.current = L.marker([initialDriver.lat, initialDriver.lon], {
          icon: driverIconRef.current,
          zIndexOffset: 1000,
        })
          .addTo(map)
          .bindPopup("ตำแหน่งพนักงานส่ง");
        prevDriverPosRef.current = { lat: initialDriver.lat, lon: initialDriver.lon };
      }

      if (destLat && destLon) {
        destMarkerRef.current = L.marker([destLat, destLon], { icon: destIconRef.current })
          .addTo(map)
          .bindPopup("ปลายทาง");
      }

      // Fit bounds to show both markers
      if (initialDriver && destLat && destLon) {
        map.fitBounds(
          [
            [initialDriver.lat, initialDriver.lon],
            [destLat, destLon],
          ],
          { padding: [40, 40] },
        );
      }

      mapRef.current = map;

      // Draw initial route
      if (initialDriver && destLat && destLon) {
        const route = await fetchOsrmRoute(initialDriver.lat, initialDriver.lon, destLat, destLon);
        if (route && isMounted && mapRef.current) {
          routeLayerRef.current = L.polyline(route.coordinates, {
            color: "#1e3a5f",
            weight: 4,
            opacity: 0.8,
          }).addTo(map);
          setEta({ duration: route.durationSeconds, distance: route.distanceMetres });
        }
      }
    })();

    return () => {
      isMounted = false;
      mapRef.current?.remove();
      mapRef.current = null;
      driverMarkerRef.current = null;
      destMarkerRef.current = null;
      routeLayerRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update map markers without recreating the map
  const updateMapMarkers = useCallback(
    async (driver: Driver) => {
      const L = (await import("leaflet")).default;
      const map = mapRef.current;
      if (!map) return;

      const driverIcon = L.divIcon({
        className: "",
        html: '<div style="font-size:28px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,.4))">🚚</div>',
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });

      if (driverMarkerRef.current) {
        driverMarkerRef.current.setLatLng([driver.lat, driver.lon]);
      } else {
        driverMarkerRef.current = L.marker([driver.lat, driver.lon], {
          icon: driverIcon,
          zIndexOffset: 1000,
        })
          .addTo(map)
          .bindPopup("ตำแหน่งพนักงานส่ง");
      }

      // Recalculate route only when driver moved > 100 m
      const prev = prevDriverPosRef.current;
      const needsRoute =
        destLat &&
        destLon &&
        (!prev || shouldRecalcRoute(prev.lat, prev.lon, driver.lat, driver.lon));

      if (needsRoute && destLat && destLon) {
        prevDriverPosRef.current = { lat: driver.lat, lon: driver.lon };
        const route = await fetchOsrmRoute(driver.lat, driver.lon, destLat, destLon);
        if (route && mapRef.current) {
          if (routeLayerRef.current) {
            routeLayerRef.current.setLatLngs(route.coordinates);
          } else {
            routeLayerRef.current = L.polyline(route.coordinates, {
              color: "#1e3a5f",
              weight: 4,
              opacity: 0.8,
            }).addTo(map);
          }
          setEta({ duration: route.durationSeconds, distance: route.distanceMetres });
        }
      }
    },
    [destLat, destLon],
  );

  // Poll tracking API every 3 minutes with adaptive backoff on errors
  useEffect(() => {
    const abortController = new AbortController();

    const poll = async () => {
      try {
        const res = await fetch(`/api/liff/tracking/${token}`, {
          cache: "no-store",
          signal: abortController.signal,
        });
        if (!res.ok) throw new Error("API error");
        const json = (await res.json()) as TrackingData;
        setPollError(false);
        setConsecutiveErrors(0);
        setPollInterval(POLL_INTERVAL_MS); // Reset to default on success
        setData(json);
        if (json.driver) await updateMapMarkers(json.driver);
      } catch {
        setPollError(true);
        setConsecutiveErrors((prev) => prev + 1);
        // Exponential backoff: double interval on errors, max 10 minutes
        const newInterval = Math.min(
          POLL_INTERVAL_MS * Math.pow(2, consecutiveErrors),
          10 * 60 * 1000,
        );
        setPollInterval(newInterval);
      }
    };

    const id = setInterval(poll, pollInterval);
    return () => {
      clearInterval(id);
      abortController.abort();
    };
  }, [token, updateMapMarkers, pollInterval, consecutiveErrors]);

  const driver = data.driver;
  const stale = driver
    ? Date.now() - new Date(driver.updatedAt).getTime() > STALE_MINUTES * 60 * 1000
    : false;

  const nearby =
    driver && destLat && destLon ? isNearby(driver.lat, driver.lon, destLat, destLon) : false;

  return (
    <main className="flex min-h-dvh flex-col bg-gradient-to-b from-white via-sky-50 to-white">
      {/* Header */}
      <section className="border-b border-blue-100 bg-gradient-to-br from-white via-sky-50 to-blue-100 px-5 pb-5 pt-6 shadow-sm">
        <p className="font-mono text-xs text-slate-400">{saleNo}</p>
        <h1 className="mt-1 font-kanit text-2xl font-bold text-[#083a78]">ติดตามการจัดส่ง</h1>
      </section>

      <div className="flex flex-col gap-4 px-4 py-4">
        {/* Status card */}
        <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">สถานะการจัดส่ง</p>
          <div className="mt-1.5 flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold ${STATUS_COLOR[data.status] ?? "bg-slate-100 text-slate-700"}`}
            >
              <Truck size={14} />
              {STATUS_LABEL[data.status] ?? data.status}
            </span>
            {nearby && data.status === "OUT_FOR_DELIVERY" && (
              <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-bold text-orange-700">
                🔔 ใกล้แล้ว!
              </span>
            )}
          </div>
        </div>

        {/* ETA card — only when we have route info */}
        {eta && driver && data.status === "OUT_FOR_DELIVERY" && (
          <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-blue-600" />
              <p className="text-xs text-slate-500">เวลาโดยประมาณ</p>
            </div>
            <p className="mt-1.5 font-kanit text-2xl font-bold text-slate-900">
              ถึงใน ~{formatEta(eta.duration)}
            </p>
            <p className="mt-0.5 text-sm text-slate-500">
              ระยะทาง {formatDistance(eta.distance)}
            </p>
          </div>
        )}

        {/* Stale warning */}
        {stale && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>ตำแหน่งไม่ได้รับการอัปเดตมากกว่า 30 นาที อาจไม่ตรงกับตำแหน่งจริง</span>
          </div>
        )}

        {pollError && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>ไม่สามารถรับข้อมูลล่าสุดได้ กำลังลองใหม่อัตโนมัติ</span>
          </div>
        )}

        {/* Map */}
        <div className="overflow-hidden rounded-2xl border border-blue-100 shadow-sm">
          {mapLoading ? (
            <div className="flex h-[50vh] flex-col items-center justify-center gap-2 bg-slate-50 text-slate-400">
              <Loader2 size={32} className="animate-spin" />
              <p className="text-sm">กำลังโหลดแผนที่...</p>
            </div>
          ) : !driver && !destLat ? (
            <div className="flex h-[50vh] flex-col items-center justify-center gap-2 bg-slate-50 text-slate-400">
              <MapPin size={32} />
              <p className="text-sm">รอรับตำแหน่งพนักงานส่ง...</p>
            </div>
          ) : (
            <div ref={mapContainerRef} className="h-[50vh] w-full" />
          )}
        </div>

        {/* Destination address */}
        {destination && (
          <div className="flex items-start gap-3 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
            <MapPin size={18} className="mt-0.5 shrink-0 text-blue-600" />
            <div>
              <p className="text-xs text-slate-500">ที่อยู่จัดส่ง</p>
              <p className="mt-0.5 text-sm font-medium text-slate-800">{destination}</p>
            </div>
          </div>
        )}

        {/* Driver info card */}
        {(data.driverName || data.driverPhone) && (
          <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs text-slate-500">พนักงานจัดส่ง</p>
                {data.driverName && (
                  <p className="mt-0.5 font-semibold text-slate-900">{data.driverName}</p>
                )}
                {driver && (
                  <p className="mt-0.5 text-xs text-slate-400">
                    <Navigation size={10} className="mr-0.5 inline" />
                    อัปเดต {formatUpdatedAt(driver.updatedAt)}
                  </p>
                )}
              </div>
              {data.driverPhone && (
                <a
                  href={`tel:${data.driverPhone}`}
                  className="flex shrink-0 items-center gap-2 rounded-xl bg-green-50 px-4 py-3 font-bold text-green-700 active:bg-green-100"
                >
                  <Phone size={18} />
                  โทรหาคนขับ
                </a>
              )}
            </div>
          </div>
        )}

        {/* Auto-refresh note */}
        <p className="text-center text-xs text-slate-400">
          ข้อมูลจะอัปเดตอัตโนมัติทุก 3 นาที
        </p>
      </div>
    </main>
  );
}
