"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { PeriodLockCancelButton } from "@/app/admin/_components/PeriodLockControls";
import type { PeriodLockView } from "@/lib/period-lock-view";
import { cancelPurchaseReturn, previewPurchaseReturnCancel } from "./actions";
import { resolvePurchaseReturnCancelLock, type PurchaseReturnCancelPreview } from "./purchase-return-cancel-preview";

type PreviewStatus = "idle" | "loading" | "ready" | "failed";

const signedMoney = (value: number): string =>
  `${value < 0 ? "-" : "+"}${Math.abs(value).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * X4 (owner 2026-09-30): opening the dialog previews the months the cancel touches — the return month, the ลดราคาซื้อ
 * posting month and the months of the later sales / credit notes it restates — so an owner holding
 * period_lock.override is asked for the reason whenever one is locked, and anyone else sees why it is blocked.
 * `periodLock` is the page's render-time view (return and posting month only), used until the preview arrives;
 * a lock rejection from the server replaces both. Y1: the detail page renders it as an outlined header button.
 * Z1: the preview also runs the reference-chain guard, so a return used by an active document says why up front.
 */
const PurchaseReturnCancelButton = ({
  returnId,
  docNo,
  periodLock = null,
  variant = "link",
}: {
  returnId: string;
  docNo: string;
  periodLock?: PeriodLockView | null;
  variant?: "link" | "outline";
}) => {
  const router = useRouter();
  const [preview, setPreview] = useState<PurchaseReturnCancelPreview | null>(null);
  const [status, setStatus] = useState<PreviewStatus>("idle");
  const [serverLock, setServerLock] = useState<PeriodLockView | null>(null);
  // Only the latest preview request may update the dialog (it can be reopened while one is in flight).
  const latestRequest = useRef(0);
  const { lock, blocks } = resolvePurchaseReturnCancelLock({ initial: periodLock, preview, server: serverLock });

  const loadPreview = async (): Promise<void> => {
    const request = latestRequest.current + 1;
    latestRequest.current = request;
    setStatus("loading");
    setServerLock(null);
    try {
      const result = await previewPurchaseReturnCancel(returnId);
      if (latestRequest.current !== request) return;
      setPreview(result.preview ?? null);
      setStatus(result.preview ? "ready" : "failed");
    } catch (error) {
      console.error("[PurchaseReturnCancelButton] preview", error);
      if (latestRequest.current === request) setStatus("failed");
    }
  };

  const cancelAction = async (formData: FormData): Promise<{ success?: boolean; error?: string }> => {
    try {
      const result = await cancelPurchaseReturn(formData);
      if (result.periodLock) setServerLock(result.periodLock);
      return result;
    } catch (error) {
      console.error("[PurchaseReturnCancelButton] cancel", error);
      return { error: "ยกเลิกไม่สำเร็จ กรุณาลองใหม่" };
    }
  };

  const restatement = status === "ready" ? preview?.restatement : null;
  // Z1: an active downstream document blocks the cancel — the detail page's message and links, confirm disabled.
  const block = status === "ready" ? preview?.block ?? null : null;
  const description = (
    <>
      เอกสาร <span className="font-mono font-semibold text-gray-700 dark:text-slate-200">{docNo}</span> จะถูกยกเลิก
      ระบบจะคำนวณสต็อก MAVG ใหม่ทันที และไม่สามารถกู้คืนได้
      {status === "loading" ? (
        <span className="mt-3 flex items-center gap-1.5 text-xs text-gray-500 dark:text-slate-400">
          <Loader2 size={12} className="animate-spin" aria-hidden="true" /> กำลังตรวจสอบเอกสารที่อ้างอิงและเดือนที่ประกาศปันผลแล้วที่การยกเลิกนี้กระทบ...
        </span>
      ) : null}
      {status === "failed" ? (
        <span className="mt-3 block text-xs text-amber-700 dark:text-amber-300">
          ตรวจสอบล่วงหน้าไม่สำเร็จ ระบบจะตรวจเดือนที่ประกาศปันผลแล้วอีกครั้งเมื่อกดยืนยัน
        </span>
      ) : null}
      {block ? (
        <span className="mt-3 block rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-300/30 dark:bg-amber-400/10 dark:text-amber-100">
          <span className="font-medium">ยกเลิกไม่ได้:</span> {block.message}
          {block.links.length > 0 ? (
            <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {block.links.map((link) => (
                <Link key={link.href} href={link.href} className="font-medium underline underline-offset-2">{link.label}</Link>
              ))}
            </span>
          ) : null}
        </span>
      ) : null}
      {restatement && restatement.saleCount > 0 ? (
        <span className="mt-3 block rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:bg-sky-500/10 dark:text-sky-200">
          ปรับต้นทุนขายย้อนหลัง {restatement.saleCount} บิล รวม {signedMoney(restatement.delta)} บาท
        </span>
      ) : null}
      {blocks && lock ? (
        <span className="mt-3 block rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-300/30 dark:bg-amber-400/10 dark:text-amber-100">
          {lock.message}
        </span>
      ) : null}
    </>
  );

  return (
    <PeriodLockCancelButton
      periodLock={lock}
      docId={returnId}
      docNo={docNo}
      idFieldName="returnId"
      cancelAction={cancelAction}
      description={description}
      onOpen={() => { void loadPreview(); }}
      confirmDisabled={status === "loading" || blocks || block !== null}
      onSuccess={() => router.refresh()}
      variant={variant}
    />
  );
};

export default PurchaseReturnCancelButton;
