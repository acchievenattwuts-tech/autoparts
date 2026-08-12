"use client";

import Image from "next/image";
import { Check, Copy, Download, Loader2, QrCode, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

// The LIFF page wrapper (.liff-page-transition) declares `will-change: transform`,
// which makes it a containing block for `position: fixed` descendants. Rendering the
// sheet in place would anchor it to the bottom of the *page content* instead of the
// viewport, and trap its z-index below the fixed bottom nav. Portalling to
// .liff-theme-root escapes that wrapper while keeping the LIFF dark palette (which is
// scoped to .liff-theme-root) applied to the sheet.
const QR_DISPLAY_SIZE = 220;

// `fetch()` on a data: URL is governed by the `connect-src` CSP directive, which does
// not allow `data:` (see next.config.ts). Decoding the base64 payload by hand keeps the
// save/share flow working without widening the policy.
function dataUrlToBlob(dataUrl: string): Blob {
  const separatorIndex = dataUrl.indexOf(",");
  if (separatorIndex < 0) throw new Error("invalid data url");

  const header = dataUrl.slice(0, separatorIndex);
  const mimeType = /:(.*?);/.exec(header)?.[1] ?? "image/png";
  const binary = atob(dataUrl.slice(separatorIndex + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

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
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalTarget(document.querySelector<HTMLElement>(".liff-theme-root") ?? document.body);
  }, []);

  const closeSheet = useCallback(() => setIsOpen(false), []);

  // The LIFF document never scrolls (.liff-scroll-region owns the scroll), so lock
  // that region instead of <body> while the sheet is open. Clearing the inline style
  // hands control back to the stylesheet.
  useEffect(() => {
    if (!isOpen) return;

    const scrollRegion = document.querySelector<HTMLElement>(".liff-scroll-region");
    scrollRegion?.style.setProperty("overflow", "hidden");

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeSheet();
    }
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      scrollRegion?.style.removeProperty("overflow");
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeSheet, isOpen]);

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
      const blob = dataUrlToBlob(payload.qrDataUrl);
      const fileName = `promptpay-${payload.label}.png`;
      const file = new File([blob], fileName, { type: blob.type });
      const shareData = { files: [file], title: `PromptPay ${payload.label}` };

      if (typeof navigator.share === "function" && navigator.canShare?.(shareData)) {
        await navigator.share(shareData);
        return;
      }

      // Fall back to a blob: object URL — in-app WebViews handle it more reliably than a
      // long data: URL on an <a download>.
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (saveError) {
      if (saveError instanceof DOMException && saveError.name === "AbortError") return;
      setError("บันทึก QR ไม่สำเร็จ กรุณากดค้างที่รูป QR แล้วเลือกบันทึกรูปภาพ");
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

      {isOpen && portalTarget ? createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="PromptPay QR สำหรับชำระเงิน"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeSheet();
          }}
          className="fixed inset-0 z-[1200] flex items-end justify-center bg-slate-950/60 p-0 sm:items-center sm:p-4"
        >
          <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-[28px] bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] shadow-2xl sm:rounded-[28px] sm:pb-5 dark:bg-slate-900">
            {/* The sheet body is the scroll container, so the header sticks to its top
                edge. Negative margins let the background bleed over the p-5 padding. */}
            <div className="sticky top-0 z-10 -mx-5 -mt-5 flex items-start justify-between gap-3 border-b border-slate-100 bg-white px-5 pb-3 pt-5 dark:border-slate-800 dark:bg-slate-900">
              <div>
                <p className="text-sm font-semibold text-blue-700 dark:text-sky-400">ชำระด้วย PromptPay</p>
                <h2 className="font-kanit text-xl font-bold text-slate-950 dark:text-slate-100">
                  QR พร้อมยอดชำระ
                </h2>
              </div>
              <button
                type="button"
                onClick={closeSheet}
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
                    width={QR_DISPLAY_SIZE * 2}
                    height={QR_DISPLAY_SIZE * 2}
                    unoptimized
                    className="mx-auto mt-3 h-[220px] w-[220px] rounded-2xl bg-white"
                  />
                  <p className="mt-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    QR นี้สร้างจากยอดคงเหลือล่าสุด ณ เวลาที่กด
                  </p>
                </div>

                {/* Primary action stays directly under the QR so it is reachable without
                    scrolling the sheet on a phone-sized viewport. */}
                <button
                  type="button"
                  onClick={() => void saveOrShareQr()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition active:scale-[0.99]"
                >
                  <Download size={18} /> บันทึก / แชร์ QR
                </button>

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
        </div>,
        portalTarget,
      ) : null}
    </>
  );
}
