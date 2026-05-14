"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Clock,
  Crosshair,
  Loader2,
  MapPin,
  Navigation,
  Phone,
  RefreshCw,
  Truck,
} from "lucide-react";

import {
  estimateDeliveryRoute,
  fetchTrackingRoute,
  formatDistance,
  formatEta,
  isNearby,
  shouldRecalcRoute,
} from "@/lib/delivery-tracking";

const POLL_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes
const STALE_MINUTES = 30;
const RESUME_REFRESH_DEBOUNCE_MS = 5000;
const DRIVER_ICON_HTML =
  '<div class="liff-driver-marker"><div class="liff-driver-marker__pulse"></div><div class="liff-driver-marker__ring"></div><div class="liff-driver-marker__vehicle">🚚</div></div>';
const DESTINATION_ICON_HTML =
  '<div class="liff-destination-marker"><div class="liff-destination-marker__label">ปลายทางของคุณ</div><div class="liff-destination-marker__pin"><span>📦</span></div></div>';

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
  PENDING: "bg-yellow-100 text-yellow-800 dark:bg-yellow-400/15 dark:text-yellow-200",
  PREPARING: "bg-sky-100 text-sky-800 dark:bg-sky-400/20 dark:text-sky-100",
  OUT_FOR_DELIVERY: "bg-sky-100 text-sky-800 dark:bg-sky-400/20 dark:text-sky-100",
  DELIVERED: "bg-green-100 text-green-800 dark:bg-green-400/15 dark:text-green-100",
  CANCELLED: "bg-red-100 text-red-800 dark:bg-red-400/15 dark:text-red-100",
};

function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  const minutesAgo = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutesAgo < 1) return "เมื่อสักครู่";
  if (minutesAgo < 60) return `${minutesAgo} นาทีที่แล้ว`;
  return date.toLocaleTimeString("th-TH-u-ca-gregory", { hour: "2-digit", minute: "2-digit" });
}

function formatClockTime(date: Date): string {
  return date.toLocaleTimeString("th-TH-u-ca-gregory", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatEtaArrival(updatedAt: string, durationSeconds: number): string {
  const baseTime = new Date(updatedAt).getTime();
  if (Number.isNaN(baseTime)) return "";
  return formatClockTime(new Date(baseTime + durationSeconds * 1000));
}

function formatRefreshTime(date: Date | null): string {
  if (!date) return "ยังไม่ได้รีเฟรช";
  return `รีเฟรชล่าสุด ${formatClockTime(date)}`;
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
  const [eta, setEta] = useState<{ duration: number; distance: number; estimated?: boolean } | null>(null);
  const [pollInterval, setPollInterval] = useState(POLL_INTERVAL_MS);
  const [consecutiveErrors, setConsecutiveErrors] = useState(0);
  const [mapLoading, setMapLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(new Date());

  // Map refs — never recreated
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const driverMarkerRef = useRef<import("leaflet").Marker | null>(null);
  const destMarkerRef = useRef<import("leaflet").Marker | null>(null);
  const routeHaloLayerRef = useRef<import("leaflet").Polyline | null>(null);
  const routeLayerRef = useRef<import("leaflet").Polyline | null>(null);
  const prevDriverPosRef = useRef<{ lat: number; lon: number } | null>(null);
  const driverIconRef = useRef<import("leaflet").DivIcon | null>(null);
  const destIconRef = useRef<import("leaflet").DivIcon | null>(null);
  const refreshInFlightRef = useRef(false);
  const lastResumeRefreshRef = useRef(0);

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
          html: DRIVER_ICON_HTML,
          iconSize: [52, 52],
          iconAnchor: [26, 26],
        });
      }

      if (!destIconRef.current) {
        destIconRef.current = L.divIcon({
          className: "",
          html: DESTINATION_ICON_HTML,
          iconSize: [136, 62],
          iconAnchor: [68, 62],
        });
      }

      if (initialDriver) {
        driverMarkerRef.current = L.marker([initialDriver.lat, initialDriver.lon], {
          icon: driverIconRef.current,
          zIndexOffset: 1000,
        })
          .addTo(map)
          .bindTooltip("ตำแหน่งพนักงานส่ง", { direction: "top", offset: [0, -18] });
        prevDriverPosRef.current = { lat: initialDriver.lat, lon: initialDriver.lon };
      }

      if (destLat && destLon) {
        destMarkerRef.current = L.marker([destLat, destLon], { icon: destIconRef.current })
          .addTo(map)
          .bindTooltip("ปลายทางของคุณ", {
            permanent: true,
            direction: "top",
            offset: [0, -52],
            className: "liff-destination-tooltip",
          });
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
        const route = await fetchTrackingRoute(token);
        if (route?.coordinates && isMounted && mapRef.current) {
          routeHaloLayerRef.current = L.polyline(route.coordinates, {
            color: "#ffffff",
            weight: 10,
            opacity: 0.95,
            lineCap: "round",
            lineJoin: "round",
            className: "liff-route-halo",
          }).addTo(map);
          routeLayerRef.current = L.polyline(route.coordinates, {
            color: "#0b7cff",
            weight: 5,
            opacity: 0.95,
            lineCap: "round",
            lineJoin: "round",
            className: "liff-route-line",
          }).addTo(map);
          setEta({ duration: route.durationSeconds ?? 0, distance: route.distanceMetres ?? 0 });
        } else if (route?.durationSeconds && route.distanceMetres !== null && isMounted) {
          setEta({
            duration: route.durationSeconds,
            distance: route.distanceMetres,
            estimated: route.estimated,
          });
        } else if (isMounted) {
          const estimatedRoute = estimateDeliveryRoute(initialDriver.lat, initialDriver.lon, destLat, destLon);
          setEta({
            duration: estimatedRoute.durationSeconds,
            distance: estimatedRoute.distanceMetres,
            estimated: true,
          });
        }
      }
    })();

    return () => {
      isMounted = false;
      mapRef.current?.remove();
      mapRef.current = null;
      driverMarkerRef.current = null;
      destMarkerRef.current = null;
      routeHaloLayerRef.current = null;
      routeLayerRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update map markers without recreating the map
  const updateMapMarkers = useCallback(
    async (driver: Driver, options: { forceRoute?: boolean; recenter?: boolean } = {}) => {
      const L = (await import("leaflet")).default;
      const map = mapRef.current;
      if (!map) return;

      if (!driverIconRef.current) {
        driverIconRef.current = L.divIcon({
          className: "",
          html: DRIVER_ICON_HTML,
          iconSize: [52, 52],
          iconAnchor: [26, 26],
        });
      }

      if (driverMarkerRef.current) {
        driverMarkerRef.current.setLatLng([driver.lat, driver.lon]);
      } else {
        driverMarkerRef.current = L.marker([driver.lat, driver.lon], {
          icon: driverIconRef.current,
          zIndexOffset: 1000,
        })
          .addTo(map)
          .bindTooltip("ตำแหน่งพนักงานส่ง", { direction: "top", offset: [0, -18] });
      }

      // Recalculate route only when driver moved > 100 m
      const prev = prevDriverPosRef.current;
      const needsRoute =
        destLat &&
        destLon &&
        (options.forceRoute || !prev || shouldRecalcRoute(prev.lat, prev.lon, driver.lat, driver.lon));

      if (needsRoute && destLat && destLon) {
        prevDriverPosRef.current = { lat: driver.lat, lon: driver.lon };
        const route = await fetchTrackingRoute(token);
        if (route?.coordinates && mapRef.current) {
          if (routeHaloLayerRef.current) {
            routeHaloLayerRef.current.setLatLngs(route.coordinates);
          } else {
            routeHaloLayerRef.current = L.polyline(route.coordinates, {
              color: "#ffffff",
              weight: 10,
              opacity: 0.95,
              lineCap: "round",
              lineJoin: "round",
              className: "liff-route-halo",
            }).addTo(map);
          }
          if (routeLayerRef.current) {
            routeLayerRef.current.setLatLngs(route.coordinates);
          } else {
            routeLayerRef.current = L.polyline(route.coordinates, {
              color: "#0b7cff",
              weight: 5,
              opacity: 0.95,
              lineCap: "round",
              lineJoin: "round",
              className: "liff-route-line",
            }).addTo(map);
          }
          setEta({ duration: route.durationSeconds ?? 0, distance: route.distanceMetres ?? 0 });
        } else if (route?.durationSeconds && route.distanceMetres !== null) {
          routeHaloLayerRef.current?.remove();
          routeHaloLayerRef.current = null;
          routeLayerRef.current?.remove();
          routeLayerRef.current = null;
          setEta({
            duration: route.durationSeconds,
            distance: route.distanceMetres,
            estimated: route.estimated,
          });
        } else {
          routeHaloLayerRef.current?.remove();
          routeHaloLayerRef.current = null;
          routeLayerRef.current?.remove();
          routeLayerRef.current = null;
          const estimatedRoute = estimateDeliveryRoute(driver.lat, driver.lon, destLat, destLon);
          setEta({
            duration: estimatedRoute.durationSeconds,
            distance: estimatedRoute.distanceMetres,
            estimated: true,
          });
        }
      }

      map.invalidateSize();
      if (options.recenter && destLat && destLon) {
        map.fitBounds(
          [
            [driver.lat, driver.lon],
            [destLat, destLon],
          ],
          { padding: [44, 44] },
        );
      }
    },
    [destLat, destLon, token],
  );

  const refreshTracking = useCallback(
    async (options: { forceRoute?: boolean; recenter?: boolean; showSpinner?: boolean } = {}) => {
      if (refreshInFlightRef.current) return;
      refreshInFlightRef.current = true;
      if (options.showSpinner) setIsRefreshing(true);

      try {
        const res = await fetch(`/api/liff/tracking/${token}`, { cache: "no-store" });
        if (!res.ok) throw new Error("API error");
        const json = (await res.json()) as TrackingData;
        setPollError(false);
        setConsecutiveErrors(0);
        setPollInterval(POLL_INTERVAL_MS);
        setData(json);
        setLastRefreshedAt(new Date());
        if (json.driver) {
          await updateMapMarkers(json.driver, {
            forceRoute: options.forceRoute,
            recenter: options.recenter,
          });
        } else {
          mapRef.current?.invalidateSize();
        }
      } catch {
        setPollError(true);
        setConsecutiveErrors((prev) => {
          const next = prev + 1;
          setPollInterval(Math.min(POLL_INTERVAL_MS * 2 ** next, 10 * 60 * 1000));
          return next;
        });
      } finally {
        refreshInFlightRef.current = false;
        if (options.showSpinner) setIsRefreshing(false);
      }
    },
    [token, updateMapMarkers],
  );

  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return;
      void refreshTracking();
    }, pollInterval);
    return () => clearInterval(id);
  }, [pollInterval, refreshTracking]);

  useEffect(() => {
    const refreshAfterResume = () => {
      if (document.hidden) return;
      const now = Date.now();
      if (now - lastResumeRefreshRef.current < RESUME_REFRESH_DEBOUNCE_MS) return;
      lastResumeRefreshRef.current = now;
      window.setTimeout(() => {
        mapRef.current?.invalidateSize();
        void refreshTracking({ forceRoute: true, recenter: true });
      }, 250);
    };

    document.addEventListener("visibilitychange", refreshAfterResume);
    window.addEventListener("focus", refreshAfterResume);
    window.addEventListener("pageshow", refreshAfterResume);
    window.addEventListener("online", refreshAfterResume);

    return () => {
      document.removeEventListener("visibilitychange", refreshAfterResume);
      window.removeEventListener("focus", refreshAfterResume);
      window.removeEventListener("pageshow", refreshAfterResume);
      window.removeEventListener("online", refreshAfterResume);
    };
  }, [refreshTracking]);

  const driver = data.driver;
  const stale = driver
    ? Date.now() - new Date(driver.updatedAt).getTime() > STALE_MINUTES * 60 * 1000
    : false;

  const nearby =
    driver && destLat && destLon ? isNearby(driver.lat, driver.lon, destLat, destLon) : false;
  const driverPhoneHref = data.driverPhone?.replace(/[^0-9+]/g, "") ?? "";
  const driverUpdatedClock = driver ? formatClockTime(new Date(driver.updatedAt)) : "";
  const etaArrivalClock = driver && eta ? formatEtaArrival(driver.updatedAt, eta.duration) : "";
  const routeSummary =
    !destLat || !destLon
      ? "ยังไม่มีหมุดปลายทางสำหรับคำนวณเส้นทาง"
      : !driver
        ? "รอรับตำแหน่งพนักงานส่ง"
        : eta
          ? null
          : "กำลังคำนวณเส้นทางและเวลาถึง";

  return (
    <main className="flex min-h-dvh flex-col bg-gradient-to-b from-white via-sky-50 to-white">
      {/* Header */}
      <section className="rounded-b-[32px] border-b border-blue-100 bg-gradient-to-br from-white via-sky-50 to-emerald-50 px-5 pb-5 pt-6 shadow-sm">
        <p className="font-mono text-xs text-slate-400">{saleNo}</p>
        <h1 className="mt-1 font-kanit text-2xl font-bold text-[#083a78]">ติดตามการจัดส่ง</h1>
        <p className="mt-2 text-sm text-slate-600">หน้านี้จะรีเฟรชตำแหน่งให้อัตโนมัติเมื่อกลับมาเปิดดู</p>
      </section>

      <div className="flex flex-col gap-4 px-4 py-4">
        {/* Status card */}
        <div className="rounded-[24px] border border-blue-100 bg-white p-4 shadow-sm shadow-blue-950/5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-slate-500">สถานะการจัดส่ง</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold ${STATUS_COLOR[data.status] ?? "bg-slate-100 text-slate-700"}`}
                >
                  <Truck size={14} />
                  {STATUS_LABEL[data.status] ?? data.status}
                </span>
                {nearby && data.status === "OUT_FOR_DELIVERY" && (
                  <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-bold text-orange-700">
                    ใกล้ถึงแล้ว
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs font-semibold text-slate-500">{formatRefreshTime(lastRefreshedAt)}</p>
            </div>
            <button
              type="button"
              onClick={() => refreshTracking({ forceRoute: true, recenter: true, showSpinner: true })}
              disabled={isRefreshing}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#e9f8f0] text-[#06c755] transition active:scale-95 disabled:cursor-wait disabled:opacity-70"
              aria-label="รีเฟรชตำแหน่งล่าสุด"
            >
              <RefreshCw className={`h-5 w-5 ${isRefreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* ETA card — only when we have route info */}
        {eta && driver && data.status === "OUT_FOR_DELIVERY" && (
          <div className="rounded-[24px] border border-blue-100 bg-white p-4 shadow-sm shadow-blue-950/5">
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-blue-600" />
              <p className="text-xs text-slate-500">เวลาโดยประมาณ</p>
            </div>
            <p className="mt-1.5 font-kanit text-2xl font-bold text-slate-900">
              ถึงใน ~{formatEta(eta.duration)}{eta.estimated ? " (โดยประมาณ)" : ""}
            </p>
            <p className="mt-0.5 text-sm text-slate-500">
              ระยะทาง {formatDistance(eta.distance)}
            </p>
            {driverUpdatedClock && etaArrivalClock ? (
              <p className="mt-2 rounded-xl bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-900">
                อัปเดตตำแหน่งล่าสุด {driverUpdatedClock} · ถึงประมาณ {etaArrivalClock}
              </p>
            ) : null}
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
        <div className="relative overflow-hidden rounded-[24px] border border-blue-100 bg-slate-50 shadow-sm shadow-blue-950/5">
          <div ref={mapContainerRef} className="h-[54vh] min-h-[360px] w-full" />
          <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-2">
            <div className="max-w-[72%] rounded-2xl bg-white/95 px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm backdrop-blur">
              {routeSummary ?? `ตำแหน่งล่าสุด ${driverUpdatedClock || "กำลังตรวจสอบ"}`}
            </div>
            <button
              type="button"
              onClick={() => {
                if (driver) void updateMapMarkers(driver, { recenter: true });
                else mapRef.current?.invalidateSize();
              }}
              className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-blue-800 shadow-sm backdrop-blur transition active:scale-95"
              aria-label="กลับไปดูตำแหน่งบนแผนที่"
            >
              <Crosshair className="h-5 w-5" />
            </button>
          </div>
          {mapLoading ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-50 text-slate-400">
              <Loader2 size={32} className="animate-spin" />
              <p className="text-sm">กำลังโหลดแผนที่...</p>
            </div>
          ) : !driver && !destLat ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-50 text-slate-400">
              <MapPin size={32} />
              <p className="text-sm">รอรับตำแหน่งพนักงานส่ง...</p>
            </div>
          ) : null}
        </div>

        <div className="flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2 text-xs leading-relaxed text-slate-600">
          <AlertCircle size={13} className="mt-0.5 shrink-0 text-blue-600" />
          <span>หากหมุดไม่ตรงกับสถานที่จัดส่ง กรุณาแจ้งพนักงานส่งของหรือทัก LINE OA เพื่อปรับข้อมูล</span>
        </div>

        {/* Destination address */}
        {destination && (
          <div className="flex items-start gap-3 rounded-[24px] border border-blue-100 bg-white p-4 shadow-sm shadow-blue-950/5">
            <MapPin size={18} className="mt-0.5 shrink-0 text-blue-600" />
            <div>
              <p className="text-xs text-slate-500">ที่อยู่จัดส่ง</p>
              <p className="mt-0.5 text-sm font-medium text-slate-800">{destination}</p>
            </div>
          </div>
        )}

        {/* Driver info card */}
        {(data.driverName || data.driverPhone) && (
          <div className="rounded-[24px] border border-blue-100 bg-white p-4 shadow-sm shadow-blue-950/5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-slate-500">พนักงานจัดส่ง</p>
                {data.driverName && (
                  <p className="mt-0.5 truncate font-semibold text-slate-900">{data.driverName}</p>
                )}
                {data.driverPhone && driverPhoneHref && (
                  <a
                    href={`tel:${driverPhoneHref}`}
                    className="mt-1 inline-flex items-center gap-1.5 text-sm font-bold text-green-700 active:text-green-800"
                  >
                    <Phone size={14} />
                    {data.driverPhone}
                  </a>
                )}
                {driver && (
                  <p className="mt-0.5 text-xs text-slate-400">
                    <Navigation size={10} className="mr-0.5 inline" />
                    อัปเดต {formatUpdatedAt(driver.updatedAt)}
                  </p>
                )}
              </div>
              {data.driverPhone && driverPhoneHref && (
                <a
                  href={`tel:${driverPhoneHref}`}
                  className="flex shrink-0 items-center gap-2 rounded-2xl bg-green-50 px-4 py-3 font-bold text-green-700 active:bg-green-100"
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
