"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, Loader2, Save } from "lucide-react";

import { recordStockReconciliationAction, setMappingStockSettingsAction, setShopStockBufferAction } from "./actions";

type ActionMessage = { kind: "ok" | "error"; text: string };

type ShopBufferFormProps = {
  shopRecordId: string;
  stockBuffer: number;
  canManage: boolean;
};

export const ShopBufferForm = ({ shopRecordId, stockBuffer, canManage }: ShopBufferFormProps) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [buffer, setBuffer] = useState(String(stockBuffer));
  const [message, setMessage] = useState<ActionMessage | null>(null);

  const handleSave = () => {
    setMessage(null);
    const fd = new FormData();
    fd.set("shopRecordId", shopRecordId);
    fd.set("stockBuffer", buffer);
    startTransition(async () => {
      const result = await setShopStockBufferAction(fd);
      if (result.ok) {
        setMessage({ kind: "ok", text: result.message ?? "บันทึกแล้ว" });
        router.refresh();
      } else {
        setMessage({ kind: "error", text: result.error });
      }
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="number"
          min={0}
          value={buffer}
          onChange={(event) => setBuffer(event.target.value)}
          disabled={!canManage}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-orange-400 disabled:opacity-60 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
        />
        {canManage ? (
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            {isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            บันทึก
          </button>
        ) : null}
      </div>
      {message ? (
        <p className={message.kind === "ok" ? "text-xs text-emerald-700 dark:text-emerald-300" : "text-xs text-rose-600 dark:text-rose-300"}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
};

type MappingSettingsFormProps = {
  mappingId: string;
  syncMode: string;
  stockBuffer: number | null;
  canManage: boolean;
};

export const MappingSettingsForm = ({ mappingId, syncMode, stockBuffer, canManage }: MappingSettingsFormProps) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState(syncMode);
  const [buffer, setBuffer] = useState(stockBuffer == null ? "" : String(stockBuffer));
  const [message, setMessage] = useState<ActionMessage | null>(null);

  const handleSave = () => {
    setMessage(null);
    const fd = new FormData();
    fd.set("mappingId", mappingId);
    fd.set("syncMode", mode);
    fd.set("stockBuffer", buffer);
    startTransition(async () => {
      const result = await setMappingStockSettingsAction(fd);
      if (result.ok) {
        setMessage({ kind: "ok", text: result.message ?? "บันทึกแล้ว" });
        router.refresh();
      } else {
        setMessage({ kind: "error", text: result.error });
      }
    });
  };

  return (
    <div className="space-y-1">
      <div className="grid gap-2 sm:grid-cols-[minmax(160px,1fr)_110px_auto]">
        <select
          value={mode}
          onChange={(event) => setMode(event.target.value)}
          disabled={!canManage}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-orange-400 disabled:opacity-60 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
        >
          <option value="MONITOR_ONLY">เฝ้าดู</option>
          <option value="PUSH_INTERNAL_TO_SHOPEE">ส่งไป Shopee</option>
          <option value="DISABLED">ปิด</option>
        </select>
        <input
          type="number"
          min={0}
          value={buffer}
          onChange={(event) => setBuffer(event.target.value)}
          disabled={!canManage}
          placeholder="buffer"
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-orange-400 disabled:opacity-60 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
        />
        {canManage ? (
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/10"
          >
            {isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            บันทึก
          </button>
        ) : null}
      </div>
      {message ? (
        <p className={message.kind === "ok" ? "text-xs text-emerald-700 dark:text-emerald-300" : "text-xs text-rose-600 dark:text-rose-300"}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
};

export const ReconciliationButton = ({ shopRecordId, canSync }: { shopRecordId: string; canSync: boolean }) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<ActionMessage | null>(null);

  const handleRun = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await recordStockReconciliationAction(shopRecordId);
      if (result.ok) {
        setMessage({ kind: "ok", text: result.message ?? "ตรวจแล้ว" });
        router.refresh();
      } else {
        setMessage({ kind: "error", text: result.error });
      }
    });
  };

  if (!canSync) return null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={handleRun}
        disabled={isPending}
        className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-orange-700 disabled:opacity-50 dark:bg-orange-500 dark:hover:bg-orange-400"
      >
        {isPending ? <Loader2 size={16} className="animate-spin" /> : <Bell size={16} />}
        ตรวจและแจ้งเตือน
      </button>
      {message ? (
        <span className={message.kind === "ok" ? "text-sm text-emerald-700 dark:text-emerald-300" : "text-sm text-rose-600 dark:text-rose-300"}>
          {message.text}
        </span>
      ) : null}
    </div>
  );
};
