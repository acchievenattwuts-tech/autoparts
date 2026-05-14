"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Clock, Crosshair, Navigation, Phone, RefreshCw } from "lucide-react";

import {
  estimateDeliveryRoute,
  fetchTrackingRoute,
  formatDistance,
  formatEta,
  isNearby,
  shouldRecalcRoute,
} from "@/lib/delivery-tracking";

const POLL_INTERVAL_MS = 3 * 60 * 1000;
const STALE_MINUTES = 30;
const RESUME_REFRESH_DEBOUNCE_MS = 5000;
const MIN_ROUTE_ZOOM = 13;
const DRIVER_ICON_HTML =
  '<div class="liff-driver-marker liff-driver-marker--compact"><div class="liff-driver-marker__pulse"></div><div class="liff-driver-marker__ring"></div><div class="liff-driver-marker__vehicle">🚚</div></div>';
const DESTINATION_ICON_HTML =
  '<div class="liff-destination-marker liff-destination-marker--compact"><div class="liff-destination-marker__label">ปลายทางของคุณ</div><div class="liff-destination-marker__pin"><span>📦</span></div></div>';

type Driver = { lat: number; lon: number; accuracy: number; updatedAt: string };

type TrackingData = {
  status: string;
  driver: Driver | null;
  driverName: string | null;
  driverPhone: string | null;
  destination: string | null;
};

type Props = {
  token: string;
  destLat: number | null;
  destLon: number | null;
  driver: Driver | null;
  driverName: string | null;
  driverPhone: string | null;
};

function formatUpdatedAt(iso: string): string {
  const minutesAgo = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutesAgo < 1) return "เมื่อสักครู่";
  if (minutesAgo < 60) return `${minutesAgo} นาทีที่แล้ว`;
  return new Date(iso).toLocaleTimeString("th-TH-u-ca-gregory", {
    hour: "2-digit",
    minute: "2-digit",
  });
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

function keepRouteReadableZoom(map: import("leaflet").Map) {
  if (map.getZoom() < MIN_ROUTE_ZOOM) map.setZoom(MIN_ROUTE_ZOOM);
}

const InlineDeliveryTracker = ({
  token,
  destLat,
  destLon,
  driver: initialDriver,
  driverName,
  driverPhone,
}: Props) => {
  const [data, setData] = useState<TrackingData>({
    status: "OUT_FOR_DELIVERY",
    driver: initialDriver,
    driverName,
    driverPhone,
    destination: null,
  });
  const [eta, setEta] = useState<{ duration: number; distance: number; estimated?: boolean } | null>(null);
  const [pollError, setPollError] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(new Date());

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const driverMarkerRef = useRef<import("leaflet").Marker | null>(null);
  const routeHaloLayerRef = useRef<import("leaflet").Polyline | null>(null);
  const routeLayerRef = useRef<import("leaflet").Polyline | null>(null);
  const prevDriverPosRef = useRef<{ lat: number; lon: number } | null>(null);
  const refreshInFlightRef = useRef(false);
  const lastResumeRefreshRef = useRef(0);

  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;
    let isMounted = true;

    (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");
      if (!isMounted || !mapContainerRef.current) return;

      const initialCenter: [number, number] = initialDriver
        ? [initialDriver.lat, initialDriver.lon]
        : destLat && destLon
        ? [destLat, destLon]
        : [13.7563, 100.5018];

      const map = L.map(mapContainerRef.current, {
        center: initialCenter,
        zoom: 14,
        zoomControl: false,
        attributionControl: false,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
      }).addTo(map);

      const driverIcon = L.divIcon({
        className: "",
        html: DRIVER_ICON_HTML,
        iconSize: [46, 46],
        iconAnchor: [23, 23],
      });
      const destIcon = L.divIcon({
        className: "",
        html: DESTINATION_ICON_HTML,
        iconSize: [124, 58],
        iconAnchor: [62, 58],
      });

      if (initialDriver) {
        driverMarkerRef.current = L.marker([initialDriver.lat, initialDriver.lon], {
          icon: driverIcon,
          zIndexOffset: 1000,
        })
          .addTo(map)
          .bindTooltip("ตำแหน่งพนักงานส่ง", { direction: "top", offset: [0, -16] });
        prevDriverPosRef.current = { lat: initialDriver.lat, lon: initialDriver.lon };
      }
      if (destLat && destLon) {
        L.marker([destLat, destLon], { icon: destIcon })
          .addTo(map)
          .bindTooltip("ปลายทางของคุณ", {
            permanent: true,
            direction: "top",
            offset: [0, -48],
            className: "liff-destination-tooltip",
          });
      }
      if (initialDriver && destLat && destLon) {
        map.fitBounds(
          [[initialDriver.lat, initialDriver.lon], [destLat, destLon]],
          { paddingTopLeft: [28, 40], paddingBottomRight: [64, 40] },
        );
        keepRouteReadableZoom(map);
      }

      mapRef.current = map;

      if (initialDriver && destLat && destLon) {
        const route = await fetchTrackingRoute(token);
        if (route?.coordinates && isMounted && mapRef.current) {
          routeHaloLayerRef.current = L.polyline(route.coordinates, {
            color: "#ffffff",
            weight: 9,
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
      routeHaloLayerRef.current = null;
      routeLayerRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateMapMarkers = useCallback(
    async (driver: Driver, options: { forceRoute?: boolean; recenter?: boolean } = {}) => {
      const L = (await import("leaflet")).default;
      const map = mapRef.current;
      if (!map) return;

      const driverIcon = L.divIcon({
        className: "",
        html: DRIVER_ICON_HTML,
        iconSize: [46, 46],
        iconAnchor: [23, 23],
      });

      if (driverMarkerRef.current) {
        driverMarkerRef.current.setLatLng([driver.lat, driver.lon]);
      } else {
        driverMarkerRef.current = L.marker([driver.lat, driver.lon], {
          icon: driverIcon,
          zIndexOffset: 1000,
        })
          .addTo(map)
          .bindTooltip("ตำแหน่งพนักงานส่ง", { direction: "top", offset: [0, -16] });
      }

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
              weight: 9,
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
          [[driver.lat, driver.lon], [destLat, destLon]],
          { paddingTopLeft: [28, 40], paddingBottomRight: [64, 40] },
        );
        keepRouteReadableZoom(map);
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
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshTracking]);

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
  const routeStatusText =
    !destLat || !destLon
      ? "ยังไม่มีหมุดปลายทางสำหรับคำนวณเส้นทาง"
      : !driver
        ? "รอรับตำแหน่งผู้ส่งเพื่อคำนวณเส้นทาง"
        : eta
          ? null
          : "กำลังคำนวณเส้นทางและเวลาถึงโดยประมาณ";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-2">
        <p className="text-xs font-semibold text-slate-500">{formatRefreshTime(lastRefreshedAt)}</p>
        <button
          type="button"
          onClick={() => refreshTracking({ forceRoute: true, recenter: true, showSpinner: true })}
          disabled={isRefreshing}
          className="inline-flex items-center gap-1.5 rounded-full bg-[#e9f8f0] px-3 py-1.5 text-xs font-bold text-[#06c755] transition active:scale-95 disabled:cursor-wait disabled:opacity-70"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
          รีเฟรช
        </button>
      </div>

      {/* ETA row */}
      {eta && driver && (
        <div className="grid gap-2 rounded-xl bg-blue-50 px-3 py-2.5 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="flex items-center gap-2">
            <Clock size={15} className="text-blue-600" />
            <div>
              <p className="font-kanit text-sm font-bold text-blue-900">
                ถึงใน ~{formatEta(eta.duration)}{eta.estimated ? " (โดยประมาณ)" : ""}
              </p>
              {driverUpdatedClock && etaArrivalClock ? (
                <p className="text-[11px] font-medium text-blue-700">
                  ระยะทางคงเหลือ {formatDistance(eta.distance)}
                </p>
              ) : (
                <p className="text-[11px] font-medium text-blue-700">
                  ระยะทางคงเหลือ {formatDistance(eta.distance)}
                </p>
              )}
            </div>
          </div>
          {etaArrivalClock ? (
            <div className="w-fit rounded-full bg-white px-3 py-1 text-xs font-bold text-blue-800 shadow-sm">
              ถึงประมาณ <span className="font-kanit text-base">{etaArrivalClock}</span>
            </div>
          ) : driverUpdatedClock ? (
            <span className="text-xs text-slate-500">{driverUpdatedClock}</span>
          ) : null}
        </div>
      )}

      {nearby && (
        <div className="rounded-xl bg-orange-50 px-3 py-2 text-center text-sm font-bold text-orange-700">
          🔔 พนักงานส่งใกล้มาถึงแล้ว!
        </div>
      )}

      {/* Map */}
      <div className="relative overflow-hidden rounded-2xl border border-blue-100 bg-slate-50">
        <div ref={mapContainerRef} className="h-[50vh] min-h-72 w-full" />
        <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-2">
          {routeStatusText ? (
            <div className="max-w-[76%] rounded-2xl bg-white/95 px-3 py-2 text-[11px] font-semibold text-slate-700 shadow-sm backdrop-blur">
              {routeStatusText}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => {
              if (driver) void updateMapMarkers(driver, { recenter: true });
              else mapRef.current?.invalidateSize();
            }}
            className="pointer-events-auto ml-auto inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-blue-800 shadow-sm backdrop-blur transition active:scale-95"
            aria-label="กลับไปดูตำแหน่งบนแผนที่"
          >
            <Crosshair className="h-4 w-4" />
          </button>
        </div>
        {!driver && !destLat ? (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-50 text-sm text-slate-400">
            รอรับตำแหน่งพนักงานส่ง...
          </div>
        ) : null}
      </div>

      <div className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500">
        <AlertCircle size={13} className="mt-0.5 shrink-0 text-slate-400" />
        <span>หากหมุดไม่ตรงกับสถานที่จัดส่ง กรุณาแจ้งพนักงานส่งของหรือทัก LINE OA เพื่อปรับข้อมูล</span>
      </div>

      {/* Route summary */}
      {!eta && routeStatusText ? (
        <div className="rounded-xl border border-blue-100 bg-slate-50 px-3 py-2 text-sm text-slate-500">
          {routeStatusText}
        </div>
      ) : null}

      {/* Driver card */}
      {(data.driverName || data.driverPhone) && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-blue-100 bg-white px-3 py-3">
          <div className="min-w-0">
            <p className="text-xs text-slate-500">ผู้ส่ง</p>
            {data.driverName && (
              <p className="truncate text-sm font-semibold text-slate-900">{data.driverName}</p>
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
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-green-50 px-3 py-2 text-sm font-bold text-green-700 active:bg-green-100"
            >
              <Phone size={15} />
              โทร
            </a>
          )}
        </div>
      )}

      {stale && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>ตำแหน่งไม่ได้รับการอัปเดตมากกว่า 30 นาที</span>
        </div>
      )}

      {pollError && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>ไม่สามารถรับข้อมูลล่าสุด กำลังลองใหม่อัตโนมัติ</span>
        </div>
      )}

      <p className="text-center text-xs text-slate-400">แผนที่อัปเดตอัตโนมัติทุก 3 นาที</p>
    </div>
  );
};

export default InlineDeliveryTracker;
