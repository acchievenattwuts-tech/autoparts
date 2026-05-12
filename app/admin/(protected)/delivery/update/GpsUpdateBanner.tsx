"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Navigation } from "lucide-react";

import { formatDateTimeThai } from "@/lib/th-date";
import { updateDriverLocationAction } from "../track/actions";

const AUTO_UPDATE_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ACCURACY_M = 100;

type GpsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; accuracy: number; updatedAt: Date }
  | { status: "error"; message: string };

type Props = {
  saleIds: string[]; // OUT_FOR_DELIVERY sales assigned to current driver
};

export default function GpsUpdateBanner({ saleIds }: Props) {
  const [gps, setGps] = useState<GpsState>({ status: "idle" });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryCountRef = useRef(0);

  const updateLocation = useCallback(async () => {
    if (!navigator.geolocation) {
      setGps({ status: "error", message: "อุปกรณ์ไม่รองรับ GPS" });
      return;
    }
    setGps({ status: "loading" });

    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        if (coords.accuracy > MAX_ACCURACY_M) {
          setGps({
            status: "error",
            message: `GPS ไม่แม่นยำพอ (${Math.round(coords.accuracy)} ม.) โปรดออกไปที่โล่งแจ้ง`,
          });
          return;
        }
        const res = await updateDriverLocationAction(
          saleIds,
          coords.latitude,
          coords.longitude,
          coords.accuracy,
        );
        if (res.success) {
          setGps({ status: "success", accuracy: coords.accuracy, updatedAt: new Date() });
          retryCountRef.current = 0;
        } else {
          // Retry on network errors (up to 2 times with exponential backoff)
          if (retryCountRef.current < 2) {
            retryCountRef.current++;
            const delay = 2000 * Math.pow(2, retryCountRef.current - 1);
            setTimeout(() => updateLocation(), delay);
            setGps({ status: "loading" });
          } else {
            setGps({ status: "error", message: res.error ?? "เกิดข้อผิดพลาด กรุณาลองใหม่" });
            retryCountRef.current = 0;
          }
        }
      },
      (err) => {
        const msg: Record<number, string> = {
          1: "ไม่ได้รับสิทธิ์ GPS กรุณาเปิดสิทธิ์ Location",
          2: "ไม่พบสัญญาณ GPS",
          3: "GPS หมดเวลา กรุณาลองใหม่",
        };
        setGps({ status: "error", message: msg[err.code] ?? "GPS ผิดพลาด" });
        retryCountRef.current = 0;
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }, [saleIds]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    timerRef.current = setInterval(updateLocation, AUTO_UPDATE_MS);

    // Pause auto-update when tab is not visible to save battery/data
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      } else {
        // Resume when tab becomes visible
        updateLocation(); // Update immediately when tab becomes visible
        timerRef.current = setInterval(updateLocation, AUTO_UPDATE_MS);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [updateLocation]);

  const isLoading = gps.status === "loading";

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 dark:border-sky-700/40 dark:bg-sky-900/20">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-blue-800 dark:text-sky-300">
            <Navigation size={14} className="shrink-0" />
            อัปเดตตำแหน่ง GPS
            <span className="rounded-full bg-blue-200 px-1.5 py-0.5 text-xs dark:bg-sky-800/60">
              {saleIds.length} ออเดอร์
            </span>
          </p>

          {gps.status === "success" && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
              <CheckCircle2 size={11} className="shrink-0" />
              {formatDateTimeThai(gps.updatedAt)} · แม่นยำ {Math.round(gps.accuracy)} ม.
            </p>
          )}
          {gps.status === "error" && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-red-700 dark:text-red-400">
              <AlertCircle size={11} className="shrink-0" />
              {gps.message}
            </p>
          )}
          {gps.status === "idle" && (
            <p className="mt-0.5 text-xs text-blue-600 dark:text-sky-400">
              กดปุ่มเพื่ออัปเดต · อัตโนมัติทุก 10 นาที
            </p>
          )}
        </div>

        <button
          onClick={updateLocation}
          disabled={isLoading}
          className="shrink-0 rounded-lg bg-[#f97316] px-4 py-2 text-sm font-bold text-white shadow-sm active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? <Loader2 size={16} className="animate-spin" /> : "📍 อัปเดต"}
        </button>
      </div>
    </div>
  );
}
