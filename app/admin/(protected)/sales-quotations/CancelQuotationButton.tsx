"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Ban } from "lucide-react";
import { cancelQuotation } from "./actions";
export default function CancelQuotationButton({ id, disabled }: { id: string; disabled?: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [references, setReferences] = useState<{ href: string; label: string }[]>([]);
  const router = useRouter();
  return <span className="inline-flex flex-col items-end gap-1">
    <button
      disabled={disabled || pending}
      className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:border-red-400 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:border-red-400/30 dark:text-red-300 dark:hover:border-red-400/60 dark:hover:bg-red-500/10"
      onClick={() => {
        const note = window.prompt("ยืนยันยกเลิกใบเสนอราคา — ระบุเหตุผล");
        if (note === null) return;
        startTransition(async () => {
          setError(""); setReferences([]);
          try { const result = await cancelQuotation(id, note); if (result.error) { setError(result.error); setReferences("references" in result ? result.references ?? [] : []); } else router.refresh(); }
          catch { setError("ยกเลิกไม่สำเร็จ กรุณาลองอีกครั้ง"); }
        });
      }}
    >
      <Ban size={14} />{pending ? "กำลังยกเลิก..." : "ยกเลิกเอกสาร"}
    </button>
    {error && <span role="alert" className="max-w-64 text-right text-xs text-red-600 dark:text-red-300">{error}{references.map((reference) => <Link className="ml-2 underline" key={reference.href} href={reference.href}>{reference.label}</Link>)}</span>}
  </span>;
}
