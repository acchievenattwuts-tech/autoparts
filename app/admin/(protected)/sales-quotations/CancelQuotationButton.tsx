"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cancelQuotation } from "./actions";
export default function CancelQuotationButton({ id, disabled }: { id: string; disabled?: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [references, setReferences] = useState<{ href: string; label: string }[]>([]);
  const router = useRouter();
  return <span><button disabled={disabled || pending} className="text-red-600 disabled:opacity-40 dark:text-red-300" onClick={() => {
    const note = window.prompt("ยืนยันยกเลิกใบเสนอราคา — ระบุเหตุผล");
    if (note === null) return;
    startTransition(async () => {
      setError(""); setReferences([]);
      try { const result = await cancelQuotation(id, note); if (result.error) { setError(result.error); setReferences("references" in result ? result.references ?? [] : []); } else router.refresh(); }
      catch { setError("ยกเลิกไม่สำเร็จ กรุณาลองอีกครั้ง"); }
    });
  }}>{pending ? "กำลังยกเลิก..." : "ยกเลิกเอกสาร"}</button>{error && <span role="alert">{error}{references.map((reference) => <Link className="ml-2 underline" key={reference.href} href={reference.href}>{reference.label}</Link>)}</span>}</span>;
}
