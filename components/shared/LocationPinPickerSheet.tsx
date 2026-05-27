"use client";

import { useState } from "react";
import { MapPin, Save, Users, X } from "lucide-react";

import LocationPinPicker from "@/components/shared/LocationPinPicker";

export type LocationPinPickerSheetMode = "customer" | "sale";

interface BaseProps {
  open: boolean;
  onClose: () => void;
  initialLat: number | null;
  initialLon: number | null;
  title?: string;
  subtitle?: string;
}

type CustomerModeProps = BaseProps & {
  mode: "customer";
  onConfirm: (lat: number | null, lon: number | null) => void;
};

type SaleModeProps = BaseProps & {
  mode: "sale";
  customerLinked: boolean;
  onConfirm: (
    lat: number | null,
    lon: number | null,
    options: { saveToCustomer: boolean },
  ) => void;
};

type Props = CustomerModeProps | SaleModeProps;

const LocationPinPickerSheetContent = (props: Props) => {
  const { onClose, initialLat, initialLon, title, subtitle, mode } = props;
  const [pinLat, setPinLat] = useState<number | null>(initialLat);
  const [pinLon, setPinLon] = useState<number | null>(initialLon);
  const [error, setError] = useState("");

  const hasPin = pinLat !== null && pinLon !== null;

  const handleConfirm = (saveToCustomer: boolean) => {
    if (!hasPin) {
      setError("กรุณาปักหมุดตำแหน่งก่อนบันทึก");
      return;
    }
    if (mode === "sale") {
      if (saveToCustomer && !props.customerLinked) {
        setError("บิลขายนี้ยังไม่ได้ผูกข้อมูลลูกค้า จึงบันทึกได้เฉพาะบิล");
        return;
      }
      props.onConfirm(pinLat, pinLon, { saveToCustomer });
    } else {
      props.onConfirm(pinLat, pinLon);
    }
    onClose();
  };

  const handleClear = () => {
    if (mode === "customer") {
      props.onConfirm(null, null);
      onClose();
    } else {
      props.onConfirm(null, null, { saveToCustomer: false });
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm">
      <div className="flex min-h-dvh items-end justify-center sm:items-center">
        <section className="flex max-h-[98dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-slate-50 shadow-2xl dark:bg-slate-950 sm:max-w-lg sm:rounded-3xl">
          <div className="border-b border-gray-200 bg-white/95 px-4 py-2.5 backdrop-blur dark:border-white/10 dark:bg-slate-900/95">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 font-kanit text-lg font-bold text-gray-900 dark:text-slate-100">
                  <MapPin size={18} className="text-blue-600 dark:text-sky-400" />
                  {title ?? "ปักหมุดที่อยู่จัดส่ง"}
                </h2>
                {subtitle ? (
                  <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-slate-400">
                    {subtitle}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 active:scale-95 dark:border-white/10 dark:bg-slate-800 dark:text-slate-200"
                aria-label="ปิด"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2.5">
            <LocationPinPicker
              lat={pinLat}
              lon={pinLon}
              onChange={(lat, lon) => {
                setPinLat(lat);
                setPinLon(lon);
                setError("");
              }}
              label="ตำแหน่งจัดส่ง"
              compact
            />

            {error ? (
              <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/20 dark:bg-red-500/5 dark:text-red-300">
                {error}
              </div>
            ) : null}
          </div>

          <div className="border-t border-gray-200 bg-slate-50/95 px-4 py-2.5 backdrop-blur dark:border-white/10 dark:bg-slate-950/95">
            {mode === "customer" ? (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleClear}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-gray-300 bg-white px-3 py-3 text-sm font-bold text-gray-700 transition active:scale-[0.98] dark:border-white/10 dark:bg-slate-800 dark:text-slate-200"
                >
                  ล้างหมุด
                </button>
                <button
                  type="button"
                  onClick={() => handleConfirm(false)}
                  disabled={!hasPin}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#1e3a5f] px-3 py-3 text-sm font-bold text-white shadow-lg shadow-slate-900/10 transition active:scale-[0.98] disabled:opacity-50 dark:bg-sky-600"
                >
                  <Save size={17} />
                  <span>ใช้พิกัดนี้</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleConfirm(false)}
                  disabled={!hasPin}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#1e3a5f] px-3 py-3 text-sm font-bold text-white shadow-lg shadow-slate-900/10 transition active:scale-[0.98] disabled:opacity-50 dark:bg-sky-600"
                >
                  <Save size={17} />
                  <span>เฉพาะบิลนี้</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleConfirm(true)}
                  disabled={!hasPin || !(mode === "sale" && props.customerLinked)}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-3 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-900/10 transition active:scale-[0.98] disabled:opacity-50 dark:bg-emerald-500"
                >
                  <Users size={17} />
                  <span>ลูกค้า + บิลนี้</span>
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

const LocationPinPickerSheet = (props: Props) => {
  if (!props.open) return null;

  return (
    <LocationPinPickerSheetContent
      key={`${props.mode}:${props.initialLat ?? ""}:${props.initialLon ?? ""}`}
      {...props}
    />
  );
};

export default LocationPinPickerSheet;
