"use client";

import { useEffect, useRef, useState } from "react";
import { Crosshair, MapPin, Trash2 } from "lucide-react";

interface Props {
  lat: number | null;
  lon: number | null;
  onChange: (lat: number | null, lon: number | null) => void;
  label?: string;
}

type LeafletModule = typeof import("leaflet");

const DEFAULT_CENTER: [number, number] = [13.7563, 100.5018];
const DEFAULT_ZOOM = 13;

function createPinIcon(L: LeafletModule) {
  return L.divIcon({
    className: "",
    html: `
      <div style="width:36px;height:36px;filter:drop-shadow(0 3px 6px rgba(0,0,0,.45));">
        <svg viewBox="0 0 24 24" width="36" height="36" aria-hidden="true" focusable="false">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7Z" fill="#ef4444"/>
          <circle cx="12" cy="9" r="2.8" fill="#ffffff"/>
        </svg>
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 36],
  });
}

const LocationPinPicker = ({
  lat,
  lon,
  onChange,
  label = "ปักหมุดที่อยู่จัดส่ง",
}: Props) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markerRef = useRef<import("leaflet").Marker | null>(null);
  const [locating, setLocating] = useState(false);
  const [hasPin, setHasPin] = useState(lat !== null && lon !== null);
  const [manualLat, setManualLat] = useState(lat !== null ? lat.toFixed(6) : "");
  const [manualLon, setManualLon] = useState(lon !== null ? lon.toFixed(6) : "");

  const setMarker = async (nextLat: number, nextLon: number, zoom = 16) => {
    const L = (await import("leaflet")).default;
    const map = mapRef.current;
    if (!map) return;

    if (markerRef.current) {
      markerRef.current.setLatLng([nextLat, nextLon]);
    } else {
      const marker = L.marker([nextLat, nextLon], {
        draggable: true,
        icon: createPinIcon(L),
      }).addTo(map);
      marker.on("dragend", () => {
        const pos = marker.getLatLng();
        onChange(pos.lat, pos.lng);
      });
      markerRef.current = marker;
    }

    map.setView([nextLat, nextLon], Math.max(map.getZoom(), zoom));
    setHasPin(true);
  };

  useEffect(() => {
    if (lat !== null && lon !== null) {
      setManualLat(lat.toFixed(6));
      setManualLon(lon.toFixed(6));
      setHasPin(true);
    } else {
      setManualLat("");
      setManualLon("");
      setHasPin(false);
    }
  }, [lat, lon]);

  useEffect(() => {
    if (lat === null || lon === null) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    void setMarker(lat, lon);
  }, [lat, lon]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;
    let isMounted = true;

    (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");
      if (!isMounted || !mapContainerRef.current) return;

      const center: [number, number] = lat !== null && lon !== null ? [lat, lon] : DEFAULT_CENTER;
      const map = L.map(mapContainerRef.current, {
        center,
        zoom: lat !== null && lon !== null ? 16 : DEFAULT_ZOOM,
        zoomControl: true,
        attributionControl: false,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
      }).addTo(map);

      map.on("click", (e) => {
        const { lat: clickLat, lng: clickLon } = e.latlng;
        void setMarker(clickLat, clickLon);
        onChange(clickLat, clickLon);
      });

      mapRef.current = map;

      if (lat !== null && lon !== null) {
        void setMarker(lat, lon);
      }
    })();

    return () => {
      isMounted = false;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude, longitude } = pos.coords;
        void setMarker(latitude, longitude, 17);
        onChange(latitude, longitude);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const handleClear = () => {
    markerRef.current?.remove();
    markerRef.current = null;
    setHasPin(false);
    onChange(null, null);
  };

  const handleManualInput = (field: "lat" | "lon", value: string) => {
    if (field === "lat") {
      setManualLat(value);
    } else {
      setManualLon(value);
    }
  };

  const handleApplyManualCoords = () => {
    const parsedLat = parseFloat(manualLat);
    const parsedLon = parseFloat(manualLon);

    if (
      Number.isNaN(parsedLat) ||
      Number.isNaN(parsedLon) ||
      parsedLat < -90 ||
      parsedLat > 90 ||
      parsedLon < -180 ||
      parsedLon > 180
    ) {
      return;
    }

    void setMarker(parsedLat, parsedLon);
    onChange(parsedLat, parsedLon);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
          <MapPin size={14} className="text-blue-600 dark:text-blue-400" />
          {label}
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleUseCurrentLocation}
            disabled={locating}
            className="flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 transition hover:bg-blue-100 disabled:opacity-50 dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-300 dark:hover:bg-blue-400/20"
          >
            <Crosshair size={12} />
            {locating ? "กำลังหาตำแหน่ง..." : "ตำแหน่งปัจจุบัน"}
          </button>
          {hasPin && (
            <button
              type="button"
              onClick={handleClear}
              className="flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-100 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300 dark:hover:bg-red-400/20"
            >
              <Trash2 size={12} />
              ลบหมุด
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
            Latitude
          </label>
          <input
            type="number"
            step="any"
            value={manualLat}
            onChange={(e) => handleManualInput("lat", e.target.value)}
            placeholder="13.7563"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
            Longitude
          </label>
          <input
            type="number"
            step="any"
            value={manualLon}
            onChange={(e) => handleManualInput("lon", e.target.value)}
            placeholder="100.5018"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={handleApplyManualCoords}
        className="w-full rounded-md bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#2d4a6f] disabled:opacity-50 dark:bg-sky-600 dark:hover:bg-sky-500"
      >
        ใช้พิกัดที่กรอก
      </button>

      <div
        ref={mapContainerRef}
        className="h-64 w-full cursor-crosshair overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700"
      />

      {hasPin ? (
        <p className="text-xs text-green-700 dark:text-green-400">
          ✓ ปักหมุดแล้ว — แตะแผนที่หรือลากหมุดเพื่อเปลี่ยนตำแหน่ง
        </p>
      ) : (
        <p className="text-xs text-slate-400 dark:text-gray-500">
          แตะบนแผนที่เพื่อปักหมุด หรือกด "ตำแหน่งปัจจุบัน" หรือกรอกพิกัดด้านบน
        </p>
      )}
    </div>
  );
};

export default LocationPinPicker;
