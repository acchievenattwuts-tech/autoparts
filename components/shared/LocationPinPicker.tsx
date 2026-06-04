"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Crosshair, Loader2, MapPin, Search, Trash2 } from "lucide-react";

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

interface Props {
  lat: number | null;
  lon: number | null;
  onChange: (lat: number | null, lon: number | null) => void;
  label?: string;
  compact?: boolean;
}

type LeafletModule = typeof import("leaflet");

const DEFAULT_CENTER: [number, number] = [13.7563, 100.5018];
const DEFAULT_ZOOM = 13;

// PC ไม่มีชิป GPS ต้องใช้ WiFi/IP positioning — การตั้ง enableHighAccuracy:true
// บนเดสก์ท็อปจะทำให้รอ GPS ที่ไม่มีจน timeout จึงเปิด high accuracy เฉพาะมือถือ
const isMobileDevice = (): boolean =>
  typeof navigator !== "undefined" &&
  /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(navigator.userAgent);

// ข้อความ error ตามรหัสของ GeolocationPositionError (อ้างอิงรูปแบบจาก GpsUpdateBanner)
const GEO_ERROR_MESSAGES: Record<number, string> = {
  1: "ไม่ได้รับสิทธิ์ใช้ตำแหน่ง — กรุณาเปิดสิทธิ์ Location ของเบราว์เซอร์ และของ Windows (Settings → Privacy → Location)",
  2: "หาตำแหน่งไม่ได้ — เครื่อง PC ที่ใช้ USB WiFi อาจหาพิกัดไม่ได้ กรุณาแตะแผนที่ ค้นหาสถานที่ หรือกรอกพิกัดแทน",
  3: "หมดเวลาค้นหาตำแหน่ง — กรุณาลองใหม่ หรือแตะแผนที่เพื่อปักหมุด",
};

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
  compact = false,
}: Props) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markerRef = useRef<import("leaflet").Marker | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState("");
  const [hasPin, setHasPin] = useState(lat !== null && lon !== null);
  const [manualLat, setManualLat] = useState(lat !== null ? lat.toFixed(6) : "");
  const [manualLon, setManualLon] = useState(lon !== null ? lon.toFixed(6) : "");
  const [mapHint, setMapHint] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const didAutoCenterRef = useRef(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

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
        setManualLat(pos.lat.toFixed(6));
        setManualLon(pos.lng.toFixed(6));
        setHasPin(true);
        setMapHint("");
        onChange(pos.lat, pos.lng);
      });
      markerRef.current = marker;
    }

    map.setView([nextLat, nextLon], Math.max(map.getZoom(), zoom));
    setManualLat(nextLat.toFixed(6));
    setManualLon(nextLon.toFixed(6));
    setHasPin(true);
    setMapHint("");
  };

  const centerOnCurrentLocation = () => {
    const map = mapRef.current;
    if (!map) return;

    if (!navigator.geolocation) {
      setMapHint("ยังไม่ได้ปักหมุดปลายทาง — กรุณาแตะแผนที่หรือกรอกพิกัด");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const currentMap = mapRef.current;
        if (!currentMap) return;
        currentMap.setView([pos.coords.latitude, pos.coords.longitude], 16);
        setHasPin(false);
        setMapHint("ยังไม่ได้ปักหมุดปลายทาง — แผนที่แสดงตำแหน่งปัจจุบันเป็นจุดอ้างอิงเท่านั้น ยังไม่ใช่ข้อมูลจัดส่งจริง");
      },
      () => {
        setMapHint("ยังไม่ได้ปักหมุดปลายทาง — กดตำแหน่งปัจจุบันหรือแตะแผนที่เพื่อปักหมุด");
      },
      { enableHighAccuracy: isMobileDevice(), timeout: 8000, maximumAge: 60000 },
    );
  };

  const applyCoordsFromInputs = (nextLatText: string, nextLonText: string) => {
    const parsedLat = parseFloat(nextLatText);
    const parsedLon = parseFloat(nextLonText);

    if (
      Number.isNaN(parsedLat) ||
      Number.isNaN(parsedLon) ||
      parsedLat < -90 ||
      parsedLat > 90 ||
      parsedLon < -180 ||
      parsedLon > 180
    ) {
      setMapHint("พิกัดไม่ถูกต้อง — กรุณาตรวจสอบ Latitude/Longitude อีกครั้ง");
      return;
    }

    void setMarker(parsedLat, parsedLon);
    onChange(parsedLat, parsedLon);
  };

  useEffect(() => {
    if (lat !== null && lon !== null) {
      setManualLat(lat.toFixed(6));
      setManualLon(lon.toFixed(6));
      setHasPin(true);
      setMapHint("");
    } else {
      setManualLat("");
      setManualLon("");
      setHasPin(false);
    }
  }, [lat, lon]);

  useEffect(() => {
    if (!mapReady) return;

    if (lat === null || lon === null) {
      markerRef.current?.remove();
      markerRef.current = null;
      if (!didAutoCenterRef.current) {
        didAutoCenterRef.current = true;
        centerOnCurrentLocation();
      }
      return;
    }

    didAutoCenterRef.current = false;
    applyCoordsFromInputs(lat.toFixed(6), lon.toFixed(6));
  }, [lat, lon, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

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
      window.setTimeout(() => map.invalidateSize(), 80);
      if (isMounted) setMapReady(true);
    })();

    return () => {
      isMounted = false;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
      setMapReady(false);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setGeoError("อุปกรณ์นี้ไม่รองรับการหาตำแหน่ง — กรุณาแตะแผนที่หรือกรอกพิกัด");
      return;
    }
    setGeoError("");
    setLocating(true);
    const highAccuracy = isMobileDevice();
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setGeoError("");
        const { latitude, longitude } = pos.coords;
        void setMarker(latitude, longitude, 17);
        onChange(latitude, longitude);
      },
      (err) => {
        setLocating(false);
        setGeoError(GEO_ERROR_MESSAGES[err.code] ?? "เกิดข้อผิดพลาดในการหาตำแหน่ง กรุณาลองใหม่");
      },
      {
        enableHighAccuracy: highAccuracy,
        timeout: highAccuracy ? 10000 : 12000,
        maximumAge: highAccuracy ? 0 : 60000,
      },
    );
  };

  const handleClear = () => {
    markerRef.current?.remove();
    markerRef.current = null;
    setGeoError("");
    setHasPin(false);
    setMapHint("ยังไม่ได้ปักหมุดปลายทาง — กดตำแหน่งปัจจุบันหรือแตะแผนที่เพื่อปักหมุด");
    onChange(null, null);
  };

  const handleSearchInput = (value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.trim().length < 3) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      setShowDropdown(true);
      try {
        const params = new URLSearchParams({
          q: value,
          format: "json",
          limit: "5",
          countrycodes: "th",
          "accept-language": "th",
        });
        const center = mapRef.current?.getCenter();
        if (center) {
          const LAT_DELTA = 0.45;
          const LON_DELTA = 0.46;
          params.set(
            "viewbox",
            `${center.lng - LON_DELTA},${center.lat - LAT_DELTA},${center.lng + LON_DELTA},${center.lat + LAT_DELTA}`,
          );
          params.set("bounded", "0");
        }
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?${params.toString()}`,
        );
        if (!res.ok) throw new Error("search failed");
        const data = (await res.json()) as NominatimResult[];
        setSearchResults(data);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 500);
  };

  const handleSelectResult = (result: NominatimResult) => {
    const selectedLat = parseFloat(result.lat);
    const selectedLon = parseFloat(result.lon);
    if (Number.isNaN(selectedLat) || Number.isNaN(selectedLon)) return;
    void setMarker(selectedLat, selectedLon, 17);
    onChange(selectedLat, selectedLon);
    setSearchQuery("");
    setSearchResults([]);
    setShowDropdown(false);
  };

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleManualInput = (field: "lat" | "lon", value: string) => {
    if (field === "lat") {
      setManualLat(value);
    } else {
      setManualLon(value);
    }
  };

  const handleApplyManualCoords = () => {
    applyCoordsFromInputs(manualLat, manualLon);
  };

  return (
    <div className={compact ? "space-y-2.5" : "space-y-3"}>
      <div className={compact ? "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" : "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"}>
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

      {geoError && (
        <p className="flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs font-medium text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          {geoError}
        </p>
      )}

      <div ref={searchContainerRef} className="relative">
        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchInput(e.target.value)}
            onFocus={() => {
              if (searchResults.length > 0) setShowDropdown(true);
            }}
            placeholder="ค้นหาสถานที่ เช่น เซ็นทรัล บางนา"
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
          />
          {searching && (
            <Loader2
              size={14}
              className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-blue-500 dark:text-blue-400"
            />
          )}
        </div>
        {showDropdown && (
          <div className="absolute z-[1000] mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
            {searching && searchResults.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                กำลังค้นหา...
              </div>
            ) : searchResults.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                ไม่พบสถานที่
              </div>
            ) : (
              <ul className="max-h-60 overflow-y-auto">
                {searchResults.map((result) => (
                  <li key={result.place_id}>
                    <button
                      type="button"
                      onClick={() => handleSelectResult(result)}
                      className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs text-gray-700 transition hover:bg-blue-50 dark:text-gray-200 dark:hover:bg-blue-400/10"
                    >
                      <MapPin
                        size={12}
                        className="mt-0.5 shrink-0 text-blue-600 dark:text-blue-400"
                      />
                      <span className="line-clamp-2">{result.display_name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
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
        className={`${compact ? "h-[48dvh] min-h-72 max-h-[420px]" : "h-64"} w-full cursor-crosshair overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700`}
      />

      {hasPin ? (
        <p className="text-xs text-green-700 dark:text-green-400">
          ✓ ปักหมุดแล้ว — แตะแผนที่หรือลากหมุดเพื่อเปลี่ยนตำแหน่ง
        </p>
      ) : (
        <p className="flex items-start gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          {mapHint || "ยังไม่ได้ปักหมุดปลายทาง — แตะแผนที่ กดตำแหน่งปัจจุบัน หรือกรอกพิกัดด้านบน"}
        </p>
      )}
    </div>
  );
};

export default LocationPinPicker;
