"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RotateCcw } from "lucide-react";

type Props = {
  keyRef: string;
};

export default function AdminAiKeyResetButton({ keyRef }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = async () => {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/line-ai-keys/${encodeURIComponent(keyRef)}/reset`, {
        method: "POST",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? `REQUEST_FAILED_${response.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "REQUEST_FAILED");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={reset}
        disabled={pending}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-200 px-2.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/10"
      >
        <RotateCcw size={13} />
        {pending ? "กำลังรีเซ็ต..." : "รีเซ็ต/เปิดใช้"}
      </button>
      {error ? <span className="text-xs text-red-600 dark:text-red-300">{error}</span> : null}
    </div>
  );
}
