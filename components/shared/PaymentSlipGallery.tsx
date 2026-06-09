"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ImageOff, LoaderCircle } from "lucide-react";

import PaymentSlipLightbox from "@/components/shared/PaymentSlipLightbox";
import { paymentSlipStatusLabel } from "@/lib/line-payment-slip-display";
import { PaymentSlipVerificationStatus } from "@/lib/generated/prisma";

const galleryStatusBadgeClass: Record<PaymentSlipVerificationStatus, string> = {
  PENDING_REVIEW: "bg-amber-500 text-white ring-amber-300 dark:bg-amber-400 dark:text-amber-950 dark:ring-amber-200",
  MATCHED_PENDING_ADMIN_CONFIRM: "bg-sky-600 text-white ring-sky-300 dark:bg-sky-400 dark:text-sky-950 dark:ring-sky-200",
  CONFIRMED_BY_ADMIN: "bg-emerald-600 text-white ring-emerald-300 dark:bg-emerald-400 dark:text-emerald-950 dark:ring-emerald-200",
  REJECTED: "bg-red-600 text-white ring-red-300 dark:bg-red-400 dark:text-red-950 dark:ring-red-200",
  NEEDS_MORE_INFO: "bg-gray-700 text-white ring-gray-300 dark:bg-slate-200 dark:text-slate-900 dark:ring-slate-100",
};
import type {
  PaymentSlipGalleryFilters,
  PaymentSlipGalleryItem,
} from "@/lib/line-payment-slip-gallery";
import { formatDateThai } from "@/lib/th-date";

type LoadMore = (
  filters: PaymentSlipGalleryFilters,
  skip: number,
) => Promise<{ items: PaymentSlipGalleryItem[]; hasMore: boolean; nextSkip: number }>;

type PaymentSlipGalleryProps = {
  initialItems: PaymentSlipGalleryItem[];
  initialHasMore: boolean;
  initialNextSkip: number;
  filters: PaymentSlipGalleryFilters;
  loadMore: LoadMore;
};

function formatBaht(amount: number | null): string {
  if (amount === null) return "สอบถาม";
  return amount.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

const PaymentSlipGallery = ({
  initialItems,
  initialHasMore,
  initialNextSkip,
  filters,
  loadMore,
}: PaymentSlipGalleryProps) => {
  const [items, setItems] = useState<PaymentSlipGalleryItem[]>(initialItems);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [skip, setSkip] = useState(initialNextSkip);
  const [isLoading, setIsLoading] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  // Reset when a new filter result is rendered by the server.
  useEffect(() => {
    setItems(initialItems);
    setHasMore(initialHasMore);
    setSkip(initialNextSkip);
  }, [initialItems, initialHasMore, initialNextSkip]);

  const handleLoadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    setIsLoading(true);
    try {
      const next = await loadMore(filters, skip);
      setItems((prev) => [...prev, ...next.items]);
      setHasMore(next.hasMore);
      setSkip(next.nextSkip);
    } finally {
      setIsLoading(false);
      loadingRef.current = false;
    }
  }, [filters, hasMore, loadMore, skip]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void handleLoadMore();
      },
      { rootMargin: "400px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [handleLoadMore, hasMore]);

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white px-4 py-12 text-center text-sm text-gray-500 dark:border-white/10 dark:bg-slate-950/70 dark:text-slate-400">
        ไม่พบสลิปตามเงื่อนไขที่เลือก
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setLightboxIndex(index)}
            className="group flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white text-left transition-shadow hover:shadow-md dark:border-white/10 dark:bg-slate-950/70"
          >
            <div className="relative aspect-[3/4] w-full bg-gray-100 dark:bg-slate-900">
              {item.imageUrl ? (
                <Image
                  src={item.imageUrl}
                  alt={`สลิป ${item.senderName ?? ""}`}
                  fill
                  loading="lazy"
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 16vw"
                  className="object-cover transition-transform group-hover:scale-[1.03]"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-gray-300 dark:text-slate-600">
                  <ImageOff size={28} />
                </div>
              )}
              <span
                className={`absolute left-1.5 top-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide shadow-md ring-2 ring-inset ${galleryStatusBadgeClass[item.status]}`}
              >
                {paymentSlipStatusLabel[item.status]}
              </span>
            </div>
            <div className="flex flex-col gap-0.5 p-2">
              <p className="font-kanit text-sm font-bold text-gray-900 dark:text-slate-100">
                ฿{formatBaht(item.amount)}
              </p>
              <p className="truncate text-xs text-gray-500 dark:text-slate-400">{item.bank ?? "ไม่ทราบธนาคาร"}</p>
              <p className="truncate text-[11px] text-gray-400 dark:text-slate-500">
                {formatDateThai(item.effectiveDate, { day: "2-digit", month: "short" })}
                {item.usedFallbackDate ? " *" : ""}
              </p>
            </div>
          </button>
        ))}
      </div>

      {hasMore ? (
        <div ref={sentinelRef} className="flex justify-center py-6">
          {isLoading ? (
            <span className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-slate-400">
              <LoaderCircle size={16} className="animate-spin" /> กำลังโหลด...
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void handleLoadMore()}
              className="inline-flex h-10 items-center rounded-xl bg-gray-100 px-5 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
            >
              โหลดเพิ่ม
            </button>
          )}
        </div>
      ) : null}

      {lightboxIndex !== null ? (
        <PaymentSlipLightbox
          items={items}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onPrev={() => setLightboxIndex((i) => (i !== null && i > 0 ? i - 1 : i))}
          onNext={() => setLightboxIndex((i) => (i !== null && i < items.length - 1 ? i + 1 : i))}
        />
      ) : null}
    </>
  );
};

export default PaymentSlipGallery;
