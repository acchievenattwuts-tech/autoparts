"use client";

import { useEffect, useRef, useState } from "react";
import { Crosshair, MapPin, Trash2 } from "lucide-react";

interface Props {
  lat: number | null;
  lon: number | null;
  onChange: (lat: number | null, lon: number | null) => void;
  label?: string;
}

const DEFAULT_CENTER: [number, number] = [13.7563, 100.5018];
const DEFAULT_ZOOM = 13;

const LocationPinPicker = ({ lat, lon, onChange, label = "ปักหมุดที่อยู่จัดส่ง" }: Props) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markerRef = useRef<import("leaflet").Marker | null>(null);
  const [locating, setLocating] = useState(false);
  const [hasPin, setHasPin] = useState(lat !== null && lon !== null);
  const [manualLat, setManualLat] = useState(lat !== null ? lat.toFixed(6) : "");
  const [manualLon, setManualLon] = useState(lon !== null ? lon.toFixed(6) : "");

  // Sync manual inputs with map pin
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
    const map = mapRef.current;
    if (!map) return;

    let isMounted = true;
    (async () => {
      const L = (await import("leaflet")).default;
      if (!isMounted) return;

      if (lat === null || lon === null) {
        markerRef.current?.remove();
        markerRef.current = null;
        return;
      }

      const pinIcon = L.divIcon({
        className: "",
        html: '<div style="font-size:32px;line-height:1;filter:drop-shadow(0 2px 6px rgba(0,0,0,.5))">๐“</div>',
        iconSize: [36, 36],
        iconAnchor: [18, 36],
      });

      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lon]);
      } else {
        const newMarker = L.marker([lat, lon], { icon: pinIcon, draggable: true }).addTo(map);
        markerRef.current = newMarker;
        newMarker.on("dragend", () => {
          const pos = newMarker.getLatLng();
          onChange(pos.lat, pos.lng);
        });
      }
      map.setView([lat, lon], Math.max(map.getZoom(), 16));
    })();

    return () => {
      isMounted = false;
    };
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

      const pinIcon = L.divIcon({
        className: "",
        html: '<div style="font-size:32px;line-height:1;filter:drop-shadow(0 2px 6px rgba(0,0,0,.5))">📍</div>',
        iconSize: [36, 36],
        iconAnchor: [18, 36],
      });

      if (lat !== null && lon !== null) {
        const newMarker = L.marker([lat, lon], { icon: pinIcon, draggable: true }).addTo(map);
        markerRef.current = newMarker;
        newMarker.on("dragend", () => {
          const pos = newMarker.getLatLng();
          onChange(pos.lat, pos.lng);
        });
      }

      map.on("click", (e) => {
        const { lat: clickLat, lng: clickLon } = e.latlng;
        if (markerRef.current) {
          markerRef.current.setLatLng([clickLat, clickLon]);
        } else {
          const newMarker = L.marker([clickLat, clickLon], { icon: pinIcon, draggable: true }).addTo(map);
          markerRef.current = newMarker;
          newMarker.on("dragend", () => {
            const pos = newMarker.getLatLng();
            onChange(pos.lat, pos.lng);
          });
        }
        setHasPin(true);
        onChange(clickLat, clickLon);
      });

      mapRef.current = map;
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
      async (pos) => {
        setLocating(false);
        const { latitude, longitude } = pos.coords;
        const L = (await import("leaflet")).default;
        const map = mapRef.current;
        if (!map) return;

        const pinIcon = L.divIcon({
          className: "",
          html: '<div style="font-size:32px;line-height:1;filter:drop-shadow(0 2px 6px rgba(0,0,0,.5))">📍</div>',
          iconSize: [36, 36],
          iconAnchor: [18, 36],
        });

        if (markerRef.current) {
          markerRef.current.setLatLng([latitude, longitude]);
        } else {
          const newMarker = L.marker([latitude, longitude], { icon: pinIcon, draggable: true }).addTo(map);
          markerRef.current = newMarker;
          newMarker.on("dragend", () => {
            const pos2 = newMarker.getLatLng();
            onChange(pos2.lat, pos2.lng);
          });
        }
        map.setView([latitude, longitude], 17);
        setHasPin(true);
        onChange(latitude, longitude);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const handleClear = () => {
    if (markerRef.current && mapRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }
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

  const handleApplyManualCoords = async () => {
    const parsedLat = parseFloat(manualLat);
    const parsedLon = parseFloat(manualLon);

    if (!isNaN(parsedLat) && !isNaN(parsedLon) && 
        parsedLat >= -90 && parsedLat <= 90 && 
        parsedLon >= -180 && parsedLon <= 180) {
      
      const L = (await import("leaflet")).default;
      const map = mapRef.current;
      if (!map) return;

      const pinIcon = L.divIcon({
        className: "",
        html: '<div style="font-size:32px;line-height:1;filter:drop-shadow(0 2px 6px rgba(0,0,0,.5))">📍</div>',
        iconSize: [36, 36],
        iconAnchor: [18, 36],
      });

      if (markerRef.current) {
        markerRef.current.setLatLng([parsedLat, parsedLon]);
      } else {
        const newMarker = L.marker([parsedLat, parsedLon], { icon: pinIcon, draggable: true }).addTo(map);
        markerRef.current = newMarker;
        newMarker.on("dragend", () => {
          const pos = newMarker.getLatLng();
          onChange(pos.lat, pos.lng);
        });
      }
      map.setView([parsedLat, parsedLon], 16);
      setHasPin(true);
      onChange(parsedLat, parsedLon);
    }
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
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
            Latitude
          </label>
          <input
            type="number"
            step="any"
            value={manualLat}
            onChange={(e) => handleManualInput("lat", e.target.value)}
            placeholder="13.7563"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
            Longitude
          </label>
          <input
            type="number"
            step="any"
            value={manualLon}
            onChange={(e) => handleManualInput("lon", e.target.value)}
            placeholder="100.5018"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
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
        <p className="text-xs text-slate-400 dark:text-gray-500">แตะบนแผนที่เพื่อปักหมุด หรือกด "ตำแหน่งปัจจุบัน" หรือกรอกพิกัดด้านบน</p>
      )}
    </div>
  );
};

export default LocationPinPicker;
