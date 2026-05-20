"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, LoaderCircle, Phone } from "lucide-react";
import { useRouter } from "next/navigation";

import { useLiff } from "./LiffProvider";
import { CUSTOMER_PHONE_EXAMPLE, formatCustomerPhoneInput } from "@/lib/customer-phone";

type VerifyLinkResponse = {
  status?: "LINKED" | "REGISTERED" | "BLOCKED" | "AMBIGUOUS" | "ERROR";
  message?: string;
  customerName?: string;
};

export default function LinkPhoneForm() {
  const router = useRouter();
  const { idToken, profile, isReady } = useLiff();
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    setIsSuccess(false);

    startTransition(async () => {
      if (!idToken) {
        setMessage("ยังไม่พบข้อมูลยืนยันจาก LINE กรุณาปิดแล้วเปิดใหม่อีกครั้ง");
        return;
      }

      const response = await fetch("/api/liff/verify-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, phone }),
      });
      const payload = (await response.json().catch(() => ({}))) as VerifyLinkResponse;

      if (!response.ok || payload.status === "BLOCKED" || payload.status === "AMBIGUOUS") {
        setMessage(payload.message || "ไม่สามารถผูกบัญชีได้ กรุณาติดต่อร้าน");
        return;
      }

      setIsSuccess(true);
      setMessage(
        payload.status === "REGISTERED"
          ? "สมัครใช้งานเรียบร้อยแล้ว"
          : "ผูกบัญชีลูกค้าเรียบร้อยแล้ว",
      );
      router.replace("/liff/orders");
      router.refresh();
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-700 dark:bg-slate-800 dark:text-sky-400">
            <Phone size={20} />
          </div>
          <div>
            <p className="font-kanit text-lg font-bold text-slate-950 dark:text-slate-100">ยืนยันเบอร์โทร</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {profile?.displayName ? `LINE: ${profile.displayName}` : "ใช้บัญชี LINE นี้ผูกกับข้อมูลลูกค้า"}
            </p>
          </div>
        </div>

        <label className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-300">เบอร์โทรศัพท์</label>
        <input
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(event) => setPhone(formatCustomerPhoneInput(event.target.value))}
          placeholder={CUSTOMER_PHONE_EXAMPLE}
          required
          maxLength={12}
          pattern="0[0-9]{2}-[0-9]{3}-[0-9]{4}"
          className="w-full rounded-xl border border-blue-100 px-3 py-3 text-base font-semibold text-slate-950 outline-none transition focus:border-blue-700 focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-sky-500 dark:focus:ring-sky-900/30"
        />
        <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
          กรอกเบอร์โทรที่ใช้ติดต่อกับร้าน หากยังไม่พบข้อมูล ระบบจะสร้างบัญชีลูกค้าใหม่ให้โดยอัตโนมัติ
        </p>
        {profile?.userId ? (
          <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/60">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              LINE userId
            </p>
            <p className="mt-1 break-all font-mono text-xs font-semibold text-slate-800 dark:text-slate-100">
              {profile.userId}
            </p>
          </div>
        ) : null}
      </div>

      {message ? (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm shadow-sm ${
            isSuccess
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
              : "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300"
          }`}
        >
          <div className="flex gap-2">
            {isSuccess ? <CheckCircle2 size={18} /> : null}
            <span>{message}</span>
          </div>
        </div>
      ) : null}

      <button
        type="submit"
        disabled={!isReady || isPending}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-800 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-blue-900/20 transition disabled:cursor-wait disabled:opacity-60 dark:bg-sky-700 dark:shadow-sky-900/20"
      >
        {isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
        ผูกบัญชีและเริ่มใช้งาน
      </button>
    </form>
  );
}
