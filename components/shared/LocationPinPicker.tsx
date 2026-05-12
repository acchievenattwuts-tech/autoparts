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

  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;
    let isMounted = true;

    (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");
      if (!isMounted || !mapContainerRef.current) return;

      const center: [number, number] = lat && lon ? [lat, lon] : DEFAULT_CENTER;

      const map = L.map(mapContainerRef.current, {
        center,
        zoom: lat && lon ? 16 : DEFAULT_ZOOM,
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

      if (lat && lon) {
        markerRef.current = L.marker([lat, lon], { icon: pinIcon, draggable: true }).addTo(map);
        markerRef.current.on("dragend", () => {
          const pos = markerRef.current!.getLatLng();
          onChange(pos.lat, pos.lng);
        });
      }

      map.on("click", (e) => {
        const { lat: clickLat, lng: clickLon } = e.latlng;
        if (markerRef.current) {
          markerRef.current.setLatLng([clickLat, clickLon]);
        } else {
          markerRef.current = L.marker([clickLat, clickLon], { icon: pinIcon, draggable: true }).addTo(map);
          markerRef.current.on("dragend", () => {
            const pos = markerRef.current!.getLatLng();
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
          markerRef.current = L.marker([latitude, longitude], { icon: pinIcon, draggable: true }).addTo(map);
          markerRef.current.on("dragend", () => {
            const pos2 = markerRef.current!.getLatLng();
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

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
          <MapPin size={14} className="text-blue-600" />
          {label}
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleUseCurrentLocation}
            disabled={locating}
            className="flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 transition hover:bg-blue-100 disabled:opacity-50"
          >
            <Crosshair size={12} />
            {locating ? "กำลังหาตำแหน่ง..." : "ตำแหน่งปัจจุบัน"}
          </button>
          {hasPin && (
            <button
              type="button"
              onClick={handleClear}
              className="flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-100"
            >
              <Trash2 size={12} />
              ลบหมุด
            </button>
          )}
        </div>
      </div>

      <div
        ref={mapContainerRef}
        className="h-56 w-full cursor-crosshair overflow-hidden rounded-xl border border-gray-200"
      />

      {hasPin ? (
        <p className="text-xs text-green-700">
          ✓ ปักหมุดแล้ว — แตะแผนที่หรือลากหมุดเพื่อเปลี่ยนตำแหน่ง
        </p>
      ) : (
        <p className="text-xs text-slate-400">แตะบนแผนที่เพื่อปักหมุด หรือกด "ตำแหน่งปัจจุบัน"</p>
      )}
    </div>
  );
};

export default LocationPinPicker;
