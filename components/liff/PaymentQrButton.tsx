"use client";

import Image from "next/image";
import { Check, Copy, Download, Loader2, QrCode, RefreshCw, X } from "lucide-react";
import { useState } from "react";

type PaymentQrPayload = {
  amount: number;
  label: string;
  qrDataUrl: string;
  account: {
    name: string;
    bankName: string | null;
    accountNo: string | null;
    promptPayId: string;
  };
};

type Props =
  | { mode: "total"; className?: string }
  | { mode: "selected"; saleIds: string[]; className?: string };

function formatMoney(value: number) {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function PaymentQrButton(props: Props) {
  const [payload, setPayload] = useState<PaymentQrPayload | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function prepareQr() {
    setIsOpen(true);
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/liff/payments/qr", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          props.mode === "selected"
            ? { mode: "selected", saleIds: props.saleIds }
            : { mode: "total" },
        ),
      });
      const result = (await response.json().catch(() => ({}))) as
        | PaymentQrPayload
        | { error?: string };

      if (!response.ok || !("qrDataUrl" in result)) {
        throw new Error("error" in result && result.error ? result.error : "ไม่สามารถสร้าง QR ได้");
      }
      setPayload(result);
    } catch (prepareError) {
      setPayload(null);
      setError(prepareError instanceof Error ? prepareError.message : "ไม่สามารถสร้าง QR ได้");
    } finally {
      setIsLoading(false);
    }
  }

  async function copyValue(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1500);
    } catch {
      setError("คัดลอกไม่สำเร็จ กรุณากดค้างที่ข้อมูลแล้วคัดลอก");
    }
  }

  async function saveOrShareQr() {
    if (!payload) return;

    try {
      const blob = await (await fetch(payload.qrDataUrl)).blob();
      const file = new File([blob], `promptpay-${payload.label}.png`, { type: "image/png" });
      const shareData = { files: [file], title: `PromptPay ${payload.label}` };

      if (typeof navigator.share === "function" && navigator.canShare?.(shareData)) {
        await navigator.share(shareData);
        return;
      }

      const anchor = document.createElement("a");
      anchor.href = payload.qrDataUrl;
      anchor.download = file.name;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    } catch (saveError) {
      if (saveError instanceof DOMException && saveError.name === "AbortError") return;
      setError("บันทึก QR ไม่สำเร็จ กรุณาจับภาพหน้าจอแทน");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void prepareQr()}
        className={
          props.className ??
          "inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-700 px-4 py-3 text-sm font-bold text-white shadow-sm transition active:scale-[0.99] dark:bg-sky-600"
        }
      >
        <QrCode size={18} />
        {props.mode === "total"
          ? "สร้าง QR สำหรับทุกบิล"
          : `สร้าง QR ${props.saleIds.length} บิลที่เลือก`}
      </button>

      {isOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="PromptPay QR สำหรับชำระเงิน"
          className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/60 p-0 sm:items-center sm:p-4"
        >
          <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px] dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-blue-700 dark:text-sky-400">ชำระด้วย PromptPay</p>
                <h2 className="font-kanit text-xl font-bold text-slate-950 dark:text-slate-100">
                  QR พร้อมยอดชำระ
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="ปิด"
                className="rounded-full bg-slate-100 p-2 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              >
                <X size={18} />
              </button>
            </div>

            {isLoading ? (
              <div className="flex min-h-72 flex-col items-center justify-center gap-3 text-sm text-slate-600 dark:text-slate-300">
                <Loader2 className="h-8 w-8 animate-spin text-blue-700 dark:text-sky-400" />
                กำลังตรวจยอดคงเหลือล่าสุดและสร้าง QR...
              </div>
            ) : error && !payload ? (
              <div className="py-10 text-center">
                <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">{error}</p>
                <button
                  type="button"
                  onClick={() => void prepareQr()}
                  className="mt-4 inline-flex items-center gap-2 rounded-full bg-blue-700 px-4 py-2 text-sm font-bold text-white dark:bg-sky-600"
                >
                  <RefreshCw size={15} /> ลองใหม่
                </button>
              </div>
            ) : payload ? (
              <div className="mt-4 space-y-4">
                <div className="rounded-3xl border border-blue-100 bg-gradient-to-b from-sky-50 to-white p-4 text-center dark:border-slate-700 dark:from-slate-800 dark:to-slate-900">
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{payload.label}</p>
                  <p className="mt-1 font-kanit text-3xl font-extrabold text-slate-950 dark:text-slate-100">
                    {formatMoney(payload.amount)} บาท
                  </p>
                  <Image
                    src={payload.qrDataUrl}
                    alt={`PromptPay QR ${payload.label}`}
                    width={260}
                    height={260}
                    unoptimized
                    className="mx-auto mt-3 h-[260px] w-[260px] rounded-2xl bg-white"
                  />
                  <p className="mt-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    QR นี้สร้างจากยอดคงเหลือล่าสุด ณ เวลาที่กด
                  </p>
                </div>

                <div className="rounded-2xl bg-slate-50 p-3 text-sm dark:bg-slate-800">
                  <p className="font-bold text-slate-900 dark:text-slate-100">
                    {payload.account.bankName ?? payload.account.name}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="text-slate-600 dark:text-slate-300">PromptPay {payload.account.promptPayId}</span>
                    <button
                      type="button"
                      onClick={() => void copyValue("promptpay", payload.account.promptPayId)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-bold text-blue-800 dark:bg-sky-950 dark:text-sky-300"
                    >
                      {copied === "promptpay" ? <Check size={13} /> : <Copy size={13} />}
                      {copied === "promptpay" ? "คัดลอกแล้ว" : "คัดลอก"}
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="text-slate-600 dark:text-slate-300">ยอด {formatMoney(payload.amount)} บาท</span>
                    <button
                      type="button"
                      onClick={() => void copyValue("amount", payload.amount.toFixed(2))}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-bold text-blue-800 dark:bg-sky-950 dark:text-sky-300"
                    >
                      {copied === "amount" ? <Check size={13} /> : <Copy size={13} />}
                      {copied === "amount" ? "คัดลอกแล้ว" : "คัดลอกยอด"}
                    </button>
                  </div>
                </div>

                {error ? <p className="text-center text-xs font-semibold text-rose-700 dark:text-rose-300">{error}</p> : null}

                <button
                  type="button"
                  onClick={() => void saveOrShareQr()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition active:scale-[0.99]"
                >
                  <Download size={18} /> บันทึก / แชร์ QR
                </button>
                <p className="text-center text-xs leading-5 text-slate-500 dark:text-slate-400">
                  บันทึก QR แล้วเปิดแอปธนาคาร จากนั้นเลือกสแกน QR จากรูปภาพ
                  กรุณาตรวจชื่อผู้รับและยอดก่อนยืนยันทุกครั้ง
                </p>
                <button
                  type="button"
                  onClick={() => void prepareQr()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-blue-200 px-4 py-2.5 text-sm font-bold text-blue-800 dark:border-slate-600 dark:text-sky-300"
                >
                  <RefreshCw size={16} /> ตรวจยอดและสร้าง QR ใหม่
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
