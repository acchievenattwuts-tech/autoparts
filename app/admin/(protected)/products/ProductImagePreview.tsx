"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

interface GalleryImage {
  url: string;
  alt: string;
}

interface Props {
  imageUrl?: string | null;
  images?: { url: string; alt: string | null }[];
  alt: string;
  /** Thumbnail size — "sm" (40px, default for list tables) or "lg" (160px, for detail/preview pages). */
  size?: "sm" | "lg";
}

const SWIPE_THRESHOLD_PX = 60;
const EDGE_RESISTANCE = 0.35;

/** รวม imageUrl legacy + images[] เป็น list เดียว (dedup) */
function buildImageList(
  imageUrl: string | null | undefined,
  images: { url: string; alt: string | null }[] | undefined,
  fallbackAlt: string,
): GalleryImage[] {
  const extra: GalleryImage[] =
    images?.map((img) => ({ url: img.url, alt: img.alt ?? fallbackAlt })) ?? [];

  if (!imageUrl) return extra;

  // หาก imageUrl เหมือนกับ images[0] อยู่แล้ว ไม่ต้อง prepend ซ้ำ
  const alreadyIncluded = extra.some((img) => img.url === imageUrl);
  if (alreadyIncluded) return extra;

  return [{ url: imageUrl, alt: fallbackAlt }, ...extra];
}

const ProductImagePreview = ({ imageUrl, images, alt, size = "sm" }: Props) => {
  const galleryImages = buildImageList(imageUrl, images, alt);
  const hasMultiple = galleryImages.length > 1;
  const isLarge = size === "lg";

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const pointerStart = useRef<{ x: number; y: number; pointerId: number } | null>(null);

  // --- thumbnail ตัวแทนที่แสดงในตาราง ---
  const thumbSrc = galleryImages[0]?.url;

  const goTo = useCallback(
    (index: number) => {
      setActiveIndex(Math.max(0, Math.min(index, galleryImages.length - 1)));
      setDragOffset(0);
    },
    [galleryImages.length],
  );

  const close = useCallback(() => {
    setOpen(false);
    setDragOffset(0);
    setIsDragging(false);
    pointerStart.current = null;
  }, []);

  const openAt = (index: number) => {
    setActiveIndex(index);
    setDragOffset(0);
    setOpen(true);
  };

  // keyboard
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") goTo(activeIndex + 1);
      if (e.key === "ArrowLeft") goTo(activeIndex - 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close, goTo, activeIndex]);

  // body scroll lock
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // --- pointer (touch + mouse drag) ---
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!hasMultiple || e.pointerType === "mouse") return;
    pointerStart.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    if (Math.abs(dy) > Math.abs(dx) * 1.35) return;

    const atFirst = activeIndex === 0 && dx > 0;
    const atLast = activeIndex === galleryImages.length - 1 && dx < 0;
    setDragOffset(atFirst || atLast ? dx * EDGE_RESISTANCE : dx);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    if (e.currentTarget.hasPointerCapture(start.pointerId)) {
      e.currentTarget.releasePointerCapture(start.pointerId);
    }
    pointerStart.current = null;
    setIsDragging(false);

    if (Math.abs(dx) > SWIPE_THRESHOLD_PX) {
      if (dx < 0 && activeIndex < galleryImages.length - 1) { goTo(activeIndex + 1); return; }
      if (dx > 0 && activeIndex > 0) { goTo(activeIndex - 1); return; }
    }
    setDragOffset(0);
  };

  if (galleryImages.length === 0) {
    return (
      <div
        className={`flex items-center justify-center rounded-lg bg-gray-100 dark:bg-white/5 ${
          isLarge ? "h-40 w-40" : "h-10 w-10"
        }`}
      >
        <span className="text-xs text-gray-300 dark:text-slate-600">ไม่มี</span>
      </div>
    );
  }

  return (
    <>
      {/* thumbnail */}
      <button
        type="button"
        onClick={() => openAt(0)}
        className={`relative flex-shrink-0 cursor-zoom-in overflow-hidden border border-gray-100 transition-all hover:ring-2 hover:ring-[#1e3a5f] dark:border-white/10 dark:hover:ring-sky-400 ${
          isLarge ? "h-40 w-40 rounded-xl bg-gray-50 dark:bg-slate-800" : "h-10 w-10 rounded-lg"
        }`}
        aria-label={`ดูรูป ${alt}`}
      >
        <Image
          src={thumbSrc!}
          alt={alt}
          fill
          className={isLarge ? "object-contain p-2" : "object-cover"}
          sizes={isLarge ? "160px" : "40px"}
        />
        {/* badge จำนวนรูป */}
        {hasMultiple && (
          <span
            className={`absolute bottom-0 right-0 flex items-center justify-center rounded-tl-md bg-black/60 font-bold leading-none text-white ${
              isLarge ? "h-6 min-w-[24px] px-1.5 text-xs" : "h-4 min-w-[16px] px-0.5 text-[9px]"
            }`}
          >
            {galleryImages.length}
          </span>
        )}
      </button>

      {/* popup slider */}
      {open && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/88 backdrop-blur-sm"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label="ดูรูปสินค้า"
        >
          <div
            className="relative flex h-full w-full max-w-4xl flex-col justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* ปุ่มปิด */}
            <button
              type="button"
              onClick={close}
              className="absolute right-4 top-4 z-30 rounded-full bg-black/50 p-2 text-white ring-1 ring-white/20 transition hover:bg-white hover:text-slate-900"
              aria-label="ปิด"
            >
              <X size={22} />
            </button>

            {/* counter */}
            {hasMultiple && (
              <div className="absolute left-1/2 top-5 z-20 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-xs font-semibold text-white ring-1 ring-white/15">
                {activeIndex + 1} / {galleryImages.length}
              </div>
            )}

            {/* slide area */}
            <div
              className="relative min-h-0 flex-1 cursor-grab overflow-hidden active:cursor-grabbing [touch-action:pan-y] sm:mx-16"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <div
                className={`flex h-full ${isDragging ? "" : "transition-transform duration-300 ease-out"}`}
                style={{
                  transform: `translate3d(calc(${-activeIndex * 100}% + ${dragOffset}px), 0, 0)`,
                }}
              >
                {galleryImages.map((img, i) => {
                  const dist = Math.abs(i - activeIndex);
                  return (
                    <div
                      key={`${img.url}-${i}`}
                      className="relative h-full w-full shrink-0 px-4 py-16 sm:px-8 sm:py-12"
                    >
                      <div
                        className={`relative h-full w-full overflow-hidden rounded-xl bg-white transition duration-300 ${
                          dist === 0 ? "scale-100 opacity-100" : "scale-[0.96] opacity-60"
                        }`}
                      >
                        <Image
                          src={img.url}
                          alt={img.alt}
                          fill
                          className="pointer-events-none select-none object-contain"
                          sizes="(max-width: 768px) 100vw, 900px"
                          draggable={false}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Prev / Next buttons (desktop) */}
            {hasMultiple && (
              <>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); goTo(activeIndex - 1); }}
                  disabled={activeIndex === 0}
                  className="absolute left-3 top-1/2 z-20 hidden -translate-y-1/2 rounded-full bg-white/90 p-2.5 text-slate-800 shadow-md transition hover:bg-white disabled:opacity-30 sm:block"
                  aria-label="รูปก่อนหน้า"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); goTo(activeIndex + 1); }}
                  disabled={activeIndex === galleryImages.length - 1}
                  className="absolute right-3 top-1/2 z-20 hidden -translate-y-1/2 rounded-full bg-white/90 p-2.5 text-slate-800 shadow-md transition hover:bg-white disabled:opacity-30 sm:block"
                  aria-label="รูปถัดไป"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>

                {/* thumbnail strip */}
                <div className="flex shrink-0 justify-center gap-2 overflow-x-auto px-4 pb-5 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {galleryImages.map((img, i) => {
                    const isActive = i === activeIndex;
                    return (
                      <button
                        type="button"
                        key={`${img.url}-thumb-${i}`}
                        onClick={(e) => { e.stopPropagation(); goTo(i); }}
                        className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border bg-white transition active:scale-95 ${
                          isActive
                            ? "border-[#f97316] ring-2 ring-[#f97316]/70"
                            : "border-white/25 opacity-60 hover:opacity-100"
                        }`}
                        aria-label={`รูปที่ ${i + 1}`}
                      >
                        <Image
                          src={img.url}
                          alt={img.alt}
                          fill
                          sizes="56px"
                          className="object-contain p-1"
                          draggable={false}
                        />
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* ชื่อสินค้า */}
            <p className="shrink-0 pb-3 text-center text-sm text-white/60">{alt}</p>
          </div>
        </div>
      )}
    </>
  );
};

export default ProductImagePreview;
