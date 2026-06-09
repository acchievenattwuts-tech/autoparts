"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, ExternalLink, X } from "lucide-react";

import {
  paymentSlipStatusBadgeClass,
  paymentSlipStatusLabel,
} from "@/lib/line-payment-slip-display";
import type { PaymentSlipGalleryItem } from "@/lib/line-payment-slip-gallery";
import { formatDateTimeThai } from "@/lib/th-date";

type PaymentSlipLightboxProps = {
  items: PaymentSlipGalleryItem[];
  index: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
};

function formatBaht(amount: number | null): string {
  if (amount === null) return "-";
  return amount.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const PaymentSlipLightbox = ({ items, index, onClose, onPrev, onNext }: PaymentSlipLightboxProps) => {
  const item = items[index];

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowLeft") onPrev();
      else if (event.key === "ArrowRight") onNext();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, onPrev, onNext]);

  if (!item) return null;

  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        aria-label="ปิด"
      >
        <X size={20} />
      </button>

      {hasPrev ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onPrev();
          }}
          className="absolute left-4 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          aria-label="ก่อนหน้า"
        >
          <ChevronLeft size={24} />
        </button>
      ) : null}

      {hasNext ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onNext();
          }}
          className="absolute right-4 top-1/2 z-10 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          aria-label="ถัดไป"
        >
          <ChevronRight size={24} />
        </button>
      ) : null}

      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col gap-4 overflow-auto rounded-2xl bg-white p-4 shadow-2xl dark:bg-slate-900 md:flex-row"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="relative flex min-h-[300px] flex-1 items-center justify-center rounded-xl bg-gray-100 dark:bg-slate-950">
          {item.imageUrl ? (
            <Image
              src={item.imageUrl}
              alt={`สลิป ${item.senderName ?? ""}`}
              width={800}
              height={1000}
              sizes="(max-width: 768px) 90vw, 50vw"
              className="max-h-[80vh] w-auto rounded-xl object-contain"
            />
          ) : (
            <p className="px-6 py-10 text-sm text-gray-500 dark:text-slate-400">ไม่พบรูปสลิป</p>
          )}
        </div>

        <div className="flex w-full flex-col gap-3 md:w-72">
          <div className="flex items-center justify-between">
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${paymentSlipStatusBadgeClass[item.status]}`}
            >
              {paymentSlipStatusLabel[item.status]}
            </span>
            <span className="text-xs text-gray-400 dark:text-slate-500">
              {index + 1} / {items.length}
            </span>
          </div>

          <p className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">
            {formatBaht(item.amount)} ฿
          </p>

          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-xs text-gray-400 dark:text-slate-500">ธนาคาร</dt>
              <dd className="text-gray-900 dark:text-slate-100">{item.bank ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400 dark:text-slate-500">ผู้โอน</dt>
              <dd className="text-gray-900 dark:text-slate-100">{item.senderName ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400 dark:text-slate-500">ลูกค้า</dt>
              <dd className="text-gray-900 dark:text-slate-100">{item.customerName ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400 dark:text-slate-500">
                {item.usedFallbackDate ? "วันที่รับสลิป" : "วันเวลาโอน"}
              </dt>
              <dd className="text-gray-900 dark:text-slate-100">
                {formatDateTimeThai(item.effectiveDate, { dateStyle: "medium", timeStyle: "short" })}
                {item.usedFallbackDate ? (
                  <span className="mt-0.5 block text-xs text-amber-600 dark:text-amber-300">
                    * OCR อ่านวันที่โอนไม่ได้ ใช้วันที่ระบบรับสลิปแทน
                  </span>
                ) : null}
              </dd>
            </div>
          </dl>

          <div className="mt-auto flex flex-col gap-2 pt-2">
            {item.imageUrl ? (
              <a
                href={item.imageUrl}
                download
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gray-100 px-4 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
              >
                <Download size={16} /> ดาวน์โหลด
              </a>
            ) : null}
            <Link
              href={`/admin/line-payment-slips/${item.id}`}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#1e3a5f] px-4 text-sm font-medium text-white transition-colors hover:bg-[#162d4a] dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400"
            >
              <ExternalLink size={16} /> ดูรายละเอียด
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PaymentSlipLightbox;
