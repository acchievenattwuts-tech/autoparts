"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Clock, Navigation, Phone } from "lucide-react";

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

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const driverMarkerRef = useRef<import("leaflet").Marker | null>(null);
  const routeLayerRef = useRef<import("leaflet").Polyline | null>(null);
  const prevDriverPosRef = useRef<{ lat: number; lon: number } | null>(null);

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
        html: '<div style="font-size:26px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,.4))">🚚</div>',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });
      const destIcon = L.divIcon({
        className: "",
        html: '<div style="font-size:26px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,.4))">📦</div>',
        iconSize: [32, 32],
        iconAnchor: [16, 32],
      });

      if (initialDriver) {
        driverMarkerRef.current = L.marker([initialDriver.lat, initialDriver.lon], {
          icon: driverIcon,
          zIndexOffset: 1000,
        }).addTo(map);
        prevDriverPosRef.current = { lat: initialDriver.lat, lon: initialDriver.lon };
      }
      if (destLat && destLon) {
        L.marker([destLat, destLon], { icon: destIcon }).addTo(map);
      }
      if (initialDriver && destLat && destLon) {
        map.fitBounds(
          [[initialDriver.lat, initialDriver.lon], [destLat, destLon]],
          { padding: [30, 30] },
        );
      }

      mapRef.current = map;

      if (initialDriver && destLat && destLon) {
        const route = await fetchTrackingRoute(token);
        if (route?.coordinates && isMounted && mapRef.current) {
          routeLayerRef.current = L.polyline(route.coordinates, {
            color: "#1e3a5f",
            weight: 4,
            opacity: 0.8,
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
      routeLayerRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateMapMarkers = useCallback(
    async (driver: Driver) => {
      const L = (await import("leaflet")).default;
      const map = mapRef.current;
      if (!map) return;

      const driverIcon = L.divIcon({
        className: "",
        html: '<div style="font-size:26px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,.4))">🚚</div>',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      if (driverMarkerRef.current) {
        driverMarkerRef.current.setLatLng([driver.lat, driver.lon]);
      } else {
        driverMarkerRef.current = L.marker([driver.lat, driver.lon], {
          icon: driverIcon,
          zIndexOffset: 1000,
        }).addTo(map);
      }

      const prev = prevDriverPosRef.current;
      const needsRoute =
        destLat && destLon && (!prev || shouldRecalcRoute(prev.lat, prev.lon, driver.lat, driver.lon));

      if (needsRoute && destLat && destLon) {
        prevDriverPosRef.current = { lat: driver.lat, lon: driver.lon };
        const route = await fetchTrackingRoute(token);
        if (route?.coordinates && mapRef.current) {
          if (routeLayerRef.current) {
            routeLayerRef.current.setLatLngs(route.coordinates);
          } else {
            routeLayerRef.current = L.polyline(route.coordinates, {
              color: "#1e3a5f",
              weight: 4,
              opacity: 0.8,
            }).addTo(map);
          }
          setEta({ duration: route.durationSeconds ?? 0, distance: route.distanceMetres ?? 0 });
        } else if (route?.durationSeconds && route.distanceMetres !== null) {
          routeLayerRef.current?.remove();
          routeLayerRef.current = null;
          setEta({
            duration: route.durationSeconds,
            distance: route.distanceMetres,
            estimated: route.estimated,
          });
        } else {
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
    },
    [destLat, destLon, token],
  );

  useEffect(() => {
    const abortController = new AbortController();

    const poll = async () => {
      try {
        const res = await fetch(`/api/liff/tracking/${token}`, {
          cache: "no-store",
          signal: abortController.signal,
        });
        if (!res.ok) return;
        const json = (await res.json()) as TrackingData;
        setPollError(false);
        setData(json);
        if (json.driver) await updateMapMarkers(json.driver);
      } catch {
        setPollError(true);
      }
    };
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      clearInterval(id);
      abortController.abort();
    };
  }, [token, updateMapMarkers]);

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
      {/* ETA row */}
      {eta && driver && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-blue-50 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Clock size={15} className="text-blue-600" />
            <div>
              <p className="font-kanit text-sm font-bold text-blue-900">
                ถึงใน ~{formatEta(eta.duration)}{eta.estimated ? " (โดยประมาณ)" : ""}
              </p>
              {driverUpdatedClock && etaArrivalClock ? (
                <p className="text-[11px] font-medium text-blue-700">
                  อัปเดต {driverUpdatedClock} · ถึงประมาณ {etaArrivalClock}
                </p>
              ) : null}
            </div>
          </div>
          <span className="text-xs text-slate-500">{formatDistance(eta.distance)}</span>
        </div>
      )}

      {nearby && (
        <div className="rounded-xl bg-orange-50 px-3 py-2 text-center text-sm font-bold text-orange-700">
          🔔 พนักงานส่งใกล้มาถึงแล้ว!
        </div>
      )}

      {/* Map */}
      <div className="overflow-hidden rounded-xl border border-blue-100">
        {!driver && !destLat ? (
          <div className="flex h-48 items-center justify-center bg-slate-50 text-sm text-slate-400">
            รอรับตำแหน่งพนักงานส่ง...
          </div>
        ) : (
          <div ref={mapContainerRef} className="h-[50vh] w-full" />
        )}
      </div>

      {/* Route summary */}
      {eta && driver ? (
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-blue-100 bg-blue-50/70 p-2.5">
          <div className="rounded-lg bg-white px-3 py-2 shadow-sm">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Clock size={13} className="text-blue-600" />
              เวลาถึงโดยประมาณ
            </div>
            <p className="mt-1 font-kanit text-base font-bold text-blue-950">
              ~{formatEta(eta.duration)}{eta.estimated ? " (โดยประมาณ)" : ""}
            </p>
            {etaArrivalClock ? (
              <p className="mt-1 text-[11px] font-semibold text-blue-700">
                ถึงประมาณ {etaArrivalClock}
              </p>
            ) : null}
          </div>
          <div className="rounded-lg bg-white px-3 py-2 shadow-sm">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Navigation size={13} className="text-blue-600" />
              ระยะทางคงเหลือ
            </div>
            <p className="mt-1 font-kanit text-base font-bold text-blue-950">
              {formatDistance(eta.distance)}
            </p>
          </div>
        </div>
      ) : routeStatusText ? (
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
