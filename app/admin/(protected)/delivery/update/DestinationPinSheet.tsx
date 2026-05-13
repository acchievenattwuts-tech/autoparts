"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Loader2, MapPin, Save, X } from "lucide-react";

import { updateSaleDestinationPin } from "../track/actions";
import LocationPinPicker from "@/components/shared/LocationPinPicker";

export type DestinationPinSheetSale = {
  saleId: string;
  saleNo: string;
  customerName: string;
  destLatitude: number | null;
  destLongitude: number | null;
};

type Props = {
  selectedSale: DestinationPinSheetSale | null;
  onClose: () => void;
};

const DestinationPinSheet = ({ selectedSale, onClose }: Props) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pinLat, setPinLat] = useState<number | null>(null);
  const [pinLon, setPinLon] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!selectedSale) return;
    setPinLat(selectedSale.destLatitude ?? null);
    setPinLon(selectedSale.destLongitude ?? null);
    setError("");
  }, [selectedSale]);

  if (!selectedSale) return null;

  const handleSave = () => {
    if (pinLat === null || pinLon === null) {
      setError("กรุณาปักหมุดตำแหน่งปลายทางก่อนบันทึก");
      return;
    }
    setError("");
    startTransition(async () => {
      const result = await updateSaleDestinationPin(selectedSale.saleId, pinLat, pinLon);
      if (result?.error) {
        setError(result.error);
        return;
      }
      onClose();
      router.refresh();
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm">
      <div className="flex min-h-dvh items-end justify-center sm:items-center">
        <section className="max-h-[96dvh] w-full overflow-y-auto rounded-t-[28px] bg-slate-50 shadow-2xl dark:bg-slate-950 sm:max-w-lg sm:rounded-[28px]">
          <div className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-white/10 dark:bg-slate-900/95">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-sm font-semibold text-[#1e3a5f] dark:text-sky-300">
                  {selectedSale.saleNo}
                </p>
                <h2 className="mt-0.5 truncate font-kanit text-xl font-bold text-gray-900 dark:text-slate-100">
                  ปักหมุดปลายทาง
                </h2>
                <p className="truncate text-xs text-gray-500 dark:text-slate-400">
                  {selectedSale.customerName}
                </p>
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

          <div className="space-y-4 px-4 py-4">
            <div className="rounded-2xl border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs text-blue-700 dark:border-sky-400/20 dark:bg-sky-400/10 dark:text-sky-200">
              <MapPin size={13} className="mr-1 inline" />
              หากมี Latitude/Longitude ที่บันทึกไว้ ระบบจะใช้พิกัดนั้นกับแผนที่อัตโนมัติแบบเดียวกับปุ่ม &quot;ใช้พิกัดที่กรอก&quot; หากยังไม่มีพิกัด แผนที่จะเริ่มจากตำแหน่งปัจจุบันเป็นจุดอ้างอิงและจะแจ้งว่ายังไม่ได้ปักหมุดจริง
            </div>

            <LocationPinPicker
              lat={pinLat}
              lon={pinLon}
              onChange={(lat, lon) => {
                setPinLat(lat);
                setPinLon(lon);
                setError("");
              }}
              label="ตำแหน่งปลายทาง"
            />

            {error ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/20 dark:bg-red-500/5 dark:text-red-300">
                {error}
              </div>
            ) : null}

            <div className="sticky bottom-0 -mx-4 border-t border-gray-200 bg-slate-50/95 px-4 py-3 backdrop-blur dark:border-white/10 dark:bg-slate-950/95">
              <button
                type="button"
                onClick={handleSave}
                disabled={isPending || pinLat === null || pinLon === null}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#1e3a5f] px-4 py-4 text-base font-bold text-white shadow-lg shadow-slate-900/10 transition active:scale-[0.98] disabled:opacity-60 dark:bg-sky-600"
              >
                {isPending ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                บันทึกหมุดปลายทาง
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default DestinationPinSheet;
