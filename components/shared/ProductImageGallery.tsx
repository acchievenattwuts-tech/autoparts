"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, PackageSearch, X } from "lucide-react";

interface GalleryImage {
  url: string;
  alt: string;
}

interface Props {
  images: GalleryImage[];
  productName: string;
}

const SCROLL_STEP_PX = 240;

const ProductImageGallery = ({ images, productName }: Props) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [popupOpen, setPopupOpen] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const updateScrollButtons = useCallback(() => {
    const el = stripRef.current;
    if (!el) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }
    const maxScroll = el.scrollWidth - el.clientWidth;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft < maxScroll - 1);
  }, []);

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const rafId = requestAnimationFrame(updateScrollButtons);
    el.addEventListener("scroll", updateScrollButtons, { passive: true });
    window.addEventListener("resize", updateScrollButtons);
    return () => {
      cancelAnimationFrame(rafId);
      el.removeEventListener("scroll", updateScrollButtons);
      window.removeEventListener("resize", updateScrollButtons);
    };
  }, [images.length, updateScrollButtons]);

  useEffect(() => {
    if (!popupOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopupOpen(false);
      if (e.key === "ArrowRight") {
        setActiveIndex((i) => Math.min(i + 1, images.length - 1));
      }
      if (e.key === "ArrowLeft") {
        setActiveIndex((i) => Math.max(i - 1, 0));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [popupOpen, images.length]);

  const scrollStrip = (dir: "left" | "right") => {
    const el = stripRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "left" ? -SCROLL_STEP_PX : SCROLL_STEP_PX, behavior: "smooth" });
  };

  const selectThumb = (index: number) => {
    setActiveIndex(index);
    const btn = thumbRefs.current[index];
    if (btn && stripRef.current) {
      const el = stripRef.current;
      const btnLeft = btn.offsetLeft;
      const btnRight = btnLeft + btn.offsetWidth;
      const viewLeft = el.scrollLeft;
      const viewRight = viewLeft + el.clientWidth;
      if (btnLeft < viewLeft) {
        el.scrollTo({ left: btnLeft - 12, behavior: "smooth" });
      } else if (btnRight > viewRight) {
        el.scrollTo({ left: btnRight - el.clientWidth + 12, behavior: "smooth" });
      }
    }
  };

  // ── Swipe gesture for mobile / arrow navigation ─────────────────────────
  const SWIPE_THRESHOLD_PX = 50;
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const handleMainTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleMainTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;
    if (Math.abs(dx) > SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) selectThumb(Math.min(activeIndex + 1, images.length - 1));
      else selectThumb(Math.max(activeIndex - 1, 0));
    }
  };

  const goPrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    selectThumb(Math.max(activeIndex - 1, 0));
  };

  const goNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    selectThumb(Math.min(activeIndex + 1, images.length - 1));
  };

  if (images.length === 0) {
    return (
      <div className="relative aspect-square w-full overflow-hidden">
        <div className="flex h-full items-center justify-center text-slate-300">
          <PackageSearch className="h-20 w-20" />
        </div>
      </div>
    );
  }

  const activeImage = images[activeIndex] ?? images[0];

  const hasMultiple = images.length > 1;
  const isFirst = activeIndex === 0;
  const isLast = activeIndex === images.length - 1;

  return (
    <>
      <div
        className="relative aspect-square w-full select-none"
        onTouchStart={hasMultiple ? handleMainTouchStart : undefined}
        onTouchEnd={hasMultiple ? handleMainTouchEnd : undefined}
      >
        <button
          type="button"
          onClick={() => setPopupOpen(true)}
          className="group relative block h-full w-full cursor-zoom-in overflow-hidden"
          aria-label="ดูรูปขนาดเต็ม"
        >
          <Image
            src={activeImage.url}
            alt={activeImage.alt}
            fill
            sizes="(max-width: 1024px) 100vw, 45vw"
            fetchPriority="high"
            loading="eager"
            className="object-contain object-top p-5 pt-14 transition-transform duration-700 ease-out group-hover:scale-[1.12] motion-reduce:transform-none motion-reduce:transition-none sm:p-7 sm:pt-16"
          />
        </button>

        {hasMultiple && (
          <>
            <button
              type="button"
              onClick={goPrev}
              disabled={isFirst}
              className="absolute left-2 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-md ring-1 ring-slate-200 transition hover:bg-white hover:text-[#f97316] disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-800/90 dark:text-slate-200 dark:ring-white/10 dark:hover:text-sky-400 sm:flex"
              aria-label="รูปก่อนหน้า"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={isLast}
              className="absolute right-2 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-md ring-1 ring-slate-200 transition hover:bg-white hover:text-[#f97316] disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-800/90 dark:text-slate-200 dark:ring-white/10 dark:hover:text-sky-400 sm:flex"
              aria-label="รูปถัดไป"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <span className="pointer-events-none absolute bottom-2 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/55 px-2.5 py-0.5 text-[11px] font-medium text-white sm:hidden">
              {activeIndex + 1} / {images.length}
            </span>
          </>
        )}
      </div>

      {images.length > 1 && (
        <div className="relative border-t border-slate-200 bg-white/80 dark:border-white/10 dark:bg-slate-900/40">
          {canScrollLeft && (
            <button
              type="button"
              onClick={() => scrollStrip("left")}
              className="absolute left-1 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-md ring-1 ring-slate-200 transition hover:bg-[#f97316] hover:text-white dark:bg-slate-800 dark:ring-white/10 dark:hover:bg-sky-500"
              aria-label="เลื่อนไปทางซ้าย"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}

          <div
            ref={stripRef}
            className="flex gap-2 overflow-x-auto scroll-smooth p-3 [&::-webkit-scrollbar]:hidden"
            style={{ scrollbarWidth: "none" }}
          >
            {images.map((image, index) => {
              const isActive = index === activeIndex;
              return (
                <button
                  type="button"
                  key={`${image.url}-${index}`}
                  ref={(el) => {
                    thumbRefs.current[index] = el;
                  }}
                  onMouseEnter={() => selectThumb(index)}
                  onFocus={() => selectThumb(index)}
                  onClick={() => selectThumb(index)}
                  className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border bg-white transition dark:bg-slate-800 ${
                    isActive
                      ? "border-[#f97316] ring-2 ring-[#f97316]/40 dark:border-sky-400 dark:ring-sky-400/40"
                      : "border-slate-200 hover:border-[#f97316]/60 dark:border-white/10 dark:hover:border-sky-400/60"
                  }`}
                  aria-label={`เลือก ${image.alt || `รูปที่ ${index + 1}`}`}
                  aria-current={isActive ? "true" : undefined}
                >
                  <Image
                    src={image.url}
                    alt={image.alt || `${productName} รูปที่ ${index + 1}`}
                    fill
                    sizes="64px"
                    className="object-cover"
                  />
                </button>
              );
            })}
          </div>

          {canScrollRight && (
            <button
              type="button"
              onClick={() => scrollStrip("right")}
              className="absolute right-1 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-md ring-1 ring-slate-200 transition hover:bg-[#f97316] hover:text-white dark:bg-slate-800 dark:ring-white/10 dark:hover:bg-sky-500"
              aria-label="เลื่อนไปทางขวา"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {popupOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          onClick={() => setPopupOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="ดูรูปขนาดเต็ม"
        >
          <div
            className="relative w-full max-w-4xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPopupOpen(false)}
              className="absolute -top-10 right-0 text-white transition-colors hover:text-gray-300"
              aria-label="ปิด"
            >
              <X size={28} />
            </button>
            <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-white">
              <Image
                src={activeImage.url}
                alt={activeImage.alt}
                fill
                className="object-contain"
                sizes="(max-width: 768px) 100vw, 900px"
              />
            </div>
            {images.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => setActiveIndex((i) => Math.max(i - 1, 0))}
                  disabled={activeIndex === 0}
                  className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 text-slate-800 shadow-md transition hover:bg-white disabled:opacity-40"
                  aria-label="ก่อนหน้า"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setActiveIndex((i) => Math.min(i + 1, images.length - 1))}
                  disabled={activeIndex === images.length - 1}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 text-slate-800 shadow-md transition hover:bg-white disabled:opacity-40"
                  aria-label="ถัดไป"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
                <p className="mt-3 text-center text-xs text-white/80">
                  {activeIndex + 1} / {images.length}
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default ProductImageGallery;
