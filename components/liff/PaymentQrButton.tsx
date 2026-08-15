"use client";

import Image from "next/image";
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  MessageCircle,
  QrCode,
  RefreshCw,
  Send,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

// The LIFF page wrapper (.liff-page-transition) declares `will-change: transform`,
// which makes it a containing block for `position: fixed` descendants. Rendering the
// sheet in place would anchor it to the bottom of the *page content* instead of the
// viewport, and trap its z-index below the fixed bottom nav. Portalling to
// .liff-theme-root escapes that wrapper while keeping the LIFF dark palette (which is
// scoped to .liff-theme-root) applied to the sheet.
const QR_DISPLAY_SIZE = 220;

// ASCII only: a Thai filename in an `<a download>` attribute is dropped by several
// browsers, which turns a working download into a silent no-op.
const QR_FILE_NAME = "promptpay-qr.png";

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
  imageUrl: string | null;
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
  const [isSending, setIsSending] = useState(false);
  const [isSentToChat, setIsSentToChat] = useState(false);
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

  function buildRequestBody() {
    return props.mode === "selected"
      ? { mode: "selected", saleIds: props.saleIds }
      : { mode: "total" };
  }

  async function prepareQr() {
    setIsOpen(true);
    setIsLoading(true);
    setIsSentToChat(false);
    setError(null);

    try {
      const response = await fetch("/api/liff/payments/qr", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRequestBody()),
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

  // Primary path. Pushing the QR as a real LINE image message hands the customer the
  // native image viewer, where LINE's own save + share buttons work — something a web
  // page inside the LIFF WebView cannot offer by itself.
  async function sendQrToChat() {
    if (isSending) return;

    setIsSending(true);
    setError(null);

    try {
      const response = await fetch("/api/liff/payments/qr/send", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRequestBody()),
      });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };

      if (!response.ok || result.ok !== true) {
        throw new Error(result.error ?? "ส่ง QR เข้าแชทไม่สำเร็จ");
      }
      setIsSentToChat(true);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "ส่ง QR เข้าแชทไม่สำเร็จ");
    } finally {
      setIsSending(false);
    }
  }

  function openChat() {
    if (typeof window.liff?.closeWindow === "function") {
      window.liff.closeWindow();
    }
  }

  async function saveQrImage() {
    if (!payload) return;

    // LINE's in-app browser implements neither half of the usual save flow: the Android
    // System WebView ships no Web Share API and no download manager, and iOS WKWebView
    // ignores the `download` attribute. Both fail without throwing, which is why the
    // button used to look dead. Inside LINE, hand the image to the external browser —
    // long-press → "Save image" works natively there.
    if (window.liff?.isInClient?.() === true) {
      if (payload.imageUrl && typeof window.liff.openWindow === "function") {
        window.liff.openWindow({ url: payload.imageUrl, external: true });
        return;
      }
      setError("บันทึกอัตโนมัติไม่รองรับในแอป LINE กรุณากดค้างที่รูป QR แล้วเลือกบันทึกรูปภาพ");
      return;
    }

    try {
      const blob = dataUrlToBlob(payload.qrDataUrl);
      const file = new File([blob], QR_FILE_NAME, { type: blob.type });
      const shareData = { files: [file], title: `PromptPay ${payload.label}` };

      if (typeof navigator.share === "function" && navigator.canShare?.(shareData)) {
        await navigator.share(shareData);
        return;
      }

      // Fall back to a blob: object URL — regular browsers handle it more reliably than
      // a long data: URL on an <a download>.
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = QR_FILE_NAME;
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
          {/* Flex column with a non-scrolling header and a single scrolling body. The
              header used to be `sticky top-0` with negative margins inside one big
              scroll box, which Android's WebView mispositions — the sheet content then
              scrolled straight over the header instead of under it. A separate scroll
              area removes that whole class of bug: content simply cannot leave it. */}
          <div className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:rounded-[28px] dark:bg-slate-900">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 bg-white px-5 pb-3 pt-5 dark:border-slate-800 dark:bg-slate-900">
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

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] pt-4 sm:pb-5">
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
                <div className="space-y-4">
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

                  {/* Primary actions stay directly under the QR so they are reachable
                      without scrolling the sheet on a phone-sized viewport. */}
                  {isSentToChat ? (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-center dark:border-emerald-800 dark:bg-emerald-950">
                      <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-700 dark:text-emerald-300" />
                      <p className="mt-2 text-sm font-bold text-emerald-800 dark:text-emerald-200">
                        ส่ง QR เข้าแชทแล้ว
                      </p>
                      <p className="mt-1 text-xs leading-5 text-emerald-800/80 dark:text-emerald-300/80">
                        เปิดแชท LINE แล้วแตะที่รูป QR เพื่อบันทึกลงเครื่องหรือแชร์ต่อได้เลย
                      </p>
                      <button
                        type="button"
                        onClick={openChat}
                        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition active:scale-[0.99]"
                      >
                        <MessageCircle size={18} /> เปิดแชท LINE
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void sendQrToChat()}
                      disabled={isSending}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition active:scale-[0.99] disabled:opacity-70"
                    >
                      {isSending ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Send size={18} />}
                      {isSending ? "กำลังส่ง..." : "ส่ง QR เข้าแชท LINE"}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => void saveQrImage()}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-blue-200 px-4 py-2.5 text-sm font-bold text-blue-800 transition active:scale-[0.99] dark:border-slate-600 dark:text-sky-300"
                  >
                    {payload.imageUrl ? <ExternalLink size={16} /> : <Download size={16} />}
                    เปิดรูป QR เพื่อบันทึกเอง
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
          </div>
        </div>,
        portalTarget,
      ) : null}
    </>
  );
}
