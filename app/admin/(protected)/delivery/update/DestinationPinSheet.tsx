"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Loader2, Save, Users, X } from "lucide-react";

import {
  updateSaleAndCustomerDestinationPin,
  updateSaleDestinationPin,
} from "../track/actions";
import LocationPinPicker from "@/components/shared/LocationPinPicker";

export type DestinationPinSheetSale = {
  saleId: string;
  saleNo: string;
  customerId: string | null;
  customerName: string;
  destLatitude: number | null;
  destLongitude: number | null;
};

type Props = {
  selectedSale: DestinationPinSheetSale | null;
  onClose: () => void;
};

type SaveScope = "sale" | "saleAndCustomer";

const DestinationPinSheet = ({ selectedSale, onClose }: Props) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingScope, setPendingScope] = useState<SaveScope | null>(null);
  const [pinLat, setPinLat] = useState<number | null>(null);
  const [pinLon, setPinLon] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!selectedSale) return;
    setPinLat(selectedSale.destLatitude ?? null);
    setPinLon(selectedSale.destLongitude ?? null);
    setError("");
    setPendingScope(null);
  }, [selectedSale]);

  if (!selectedSale) return null;

  const handleSave = (scope: SaveScope) => {
    if (pinLat === null || pinLon === null) {
      setError("กรุณาปักหมุดตำแหน่งปลายทางก่อนบันทึก");
      return;
    }
    if (scope === "saleAndCustomer" && !selectedSale.customerId) {
      setError("บิลขายนี้ยังไม่ได้ผูกข้อมูลลูกค้า จึงบันทึกได้เฉพาะบิลขาย");
      return;
    }

    setError("");
    setPendingScope(scope);
    startTransition(async () => {
      const result =
        scope === "saleAndCustomer"
          ? await updateSaleAndCustomerDestinationPin(selectedSale.saleId, pinLat, pinLon)
          : await updateSaleDestinationPin(selectedSale.saleId, pinLat, pinLon);

      if (result?.error) {
        setError(result.error);
        setPendingScope(null);
        return;
      }
      onClose();
      router.refresh();
    });
  };

  const isDisabled = isPending || pinLat === null || pinLon === null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm">
      <div className="flex min-h-dvh items-end justify-center sm:items-center">
        <section className="flex max-h-[98dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-slate-50 shadow-2xl dark:bg-slate-950 sm:max-w-lg sm:rounded-3xl">
          <div className="border-b border-gray-200 bg-white/95 px-4 py-2.5 backdrop-blur dark:border-white/10 dark:bg-slate-900/95">
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

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2.5">
            <LocationPinPicker
              lat={pinLat}
              lon={pinLon}
              onChange={(lat, lon) => {
                setPinLat(lat);
                setPinLon(lon);
                setError("");
              }}
              label="ตำแหน่งปลายทาง"
              compact
            />

            {error ? (
              <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/20 dark:bg-red-500/5 dark:text-red-300">
                {error}
              </div>
            ) : null}
          </div>

          <div className="border-t border-gray-200 bg-slate-50/95 px-4 py-2.5 backdrop-blur dark:border-white/10 dark:bg-slate-950/95">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleSave("sale")}
                disabled={isDisabled}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#1e3a5f] px-3 py-3 text-sm font-bold text-white shadow-lg shadow-slate-900/10 transition active:scale-[0.98] disabled:opacity-60 dark:bg-sky-600"
              >
                {pendingScope === "sale" ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />}
                <span>เฉพาะบิลนี้</span>
              </button>
              <button
                type="button"
                onClick={() => handleSave("saleAndCustomer")}
                disabled={isDisabled || !selectedSale.customerId}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-3 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-900/10 transition active:scale-[0.98] disabled:opacity-50 dark:bg-emerald-500"
              >
                {pendingScope === "saleAndCustomer" ? (
                  <Loader2 size={17} className="animate-spin" />
                ) : (
                  <Users size={17} />
                )}
                <span>ลูกค้า + บิลนี้</span>
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default DestinationPinSheet;
