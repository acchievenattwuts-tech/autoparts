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
const MAIN_SWIPE_THRESHOLD_PX = 50;
const POPUP_SWIPE_THRESHOLD_PX = 72;
const POPUP_EDGE_RESISTANCE = 0.35;

const ProductImageGallery = ({ images, productName }: Props) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [popupOpen, setPopupOpen] = useState(false);
  const [mainDragOffset, setMainDragOffset] = useState(0);
  const [isMainDragging, setIsMainDragging] = useState(false);
  const [popupDragOffset, setPopupDragOffset] = useState(0);
  const [isPopupDragging, setIsPopupDragging] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const popupThumbRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const mainPointerStart = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const shouldIgnoreNextOpen = useRef(false);
  const popupPointerStart = useRef<{ x: number; y: number; pointerId: number } | null>(null);

  const hasMultiple = images.length > 1;
  const isFirst = activeIndex === 0;
  const isLast = activeIndex === images.length - 1;

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

  const scrollActiveThumbIntoView = useCallback((index: number) => {
    const btn = thumbRefs.current[index];
    const el = stripRef.current;
    if (!btn || !el) return;

    const btnLeft = btn.offsetLeft;
    const btnRight = btnLeft + btn.offsetWidth;
    const viewLeft = el.scrollLeft;
    const viewRight = viewLeft + el.clientWidth;
    if (btnLeft < viewLeft) {
      el.scrollTo({ left: btnLeft - 12, behavior: "smooth" });
    } else if (btnRight > viewRight) {
      el.scrollTo({ left: btnRight - el.clientWidth + 12, behavior: "smooth" });
    }
  }, []);

  const selectThumb = useCallback((index: number) => {
    const nextIndex = Math.max(0, Math.min(index, images.length - 1));
    setActiveIndex(nextIndex);
    scrollActiveThumbIntoView(nextIndex);
  }, [images.length, scrollActiveThumbIntoView]);

  const goToImage = useCallback((index: number) => {
    setMainDragOffset(0);
    setPopupDragOffset(0);
    selectThumb(index);
  }, [selectThumb]);

  const closePopup = useCallback(() => {
    setPopupOpen(false);
    setPopupDragOffset(0);
    setIsPopupDragging(false);
    popupPointerStart.current = null;
  }, []);

  const openPopup = () => {
    if (shouldIgnoreNextOpen.current) {
      shouldIgnoreNextOpen.current = false;
      return;
    }
    setPopupOpen(true);
    setPopupDragOffset(0);
  };

  const scrollStrip = (dir: "left" | "right") => {
    const el = stripRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "left" ? -SCROLL_STEP_PX : SCROLL_STEP_PX, behavior: "smooth" });
  };

  const navigatePopup = useCallback((direction: -1 | 1) => {
    goToImage(activeIndex + direction);
  }, [activeIndex, goToImage]);

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
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [popupOpen]);

  useEffect(() => {
    if (!popupOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePopup();
      if (e.key === "ArrowRight") navigatePopup(1);
      if (e.key === "ArrowLeft") navigatePopup(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closePopup, navigatePopup, popupOpen]);

  useEffect(() => {
    if (!popupOpen) return;
    popupThumbRefs.current[activeIndex]?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [activeIndex, popupOpen]);

  const handleMainPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!hasMultiple || e.pointerType === "mouse") return;
    mainPointerStart.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    shouldIgnoreNextOpen.current = false;
    setIsMainDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleMainPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = mainPointerStart.current;
    if (!start) return;

    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    if (Math.abs(dy) > Math.abs(dx) * 1.35) return;

    shouldIgnoreNextOpen.current = true;
    const isPullingPastFirst = activeIndex === 0 && dx > 0;
    const isPullingPastLast = activeIndex === images.length - 1 && dx < 0;
    setMainDragOffset(isPullingPastFirst || isPullingPastLast ? dx * POPUP_EDGE_RESISTANCE : dx);
  };

  const finishMainDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = mainPointerStart.current;
    if (!start) return;

    const dx = e.clientX - start.x;
    if (e.currentTarget.hasPointerCapture(start.pointerId)) {
      e.currentTarget.releasePointerCapture(start.pointerId);
    }

    mainPointerStart.current = null;
    setIsMainDragging(false);

    if (Math.abs(dx) > MAIN_SWIPE_THRESHOLD_PX) {
      selectThumb(dx < 0 ? activeIndex + 1 : activeIndex - 1);
      setMainDragOffset(0);
      return;
    }
    setMainDragOffset(0);
  };

  const handlePopupPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!hasMultiple || e.pointerType === "mouse") return;
    popupPointerStart.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    setIsPopupDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePopupPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = popupPointerStart.current;
    if (!start) return;

    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    if (Math.abs(dy) > Math.abs(dx) * 1.35) return;

    const isPullingPastFirst = activeIndex === 0 && dx > 0;
    const isPullingPastLast = activeIndex === images.length - 1 && dx < 0;
    setPopupDragOffset(isPullingPastFirst || isPullingPastLast ? dx * POPUP_EDGE_RESISTANCE : dx);
  };

  const finishPopupDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = popupPointerStart.current;
    if (!start) return;

    const dx = e.clientX - start.x;
    if (e.currentTarget.hasPointerCapture(start.pointerId)) {
      e.currentTarget.releasePointerCapture(start.pointerId);
    }

    popupPointerStart.current = null;
    setIsPopupDragging(false);

    if (Math.abs(dx) > POPUP_SWIPE_THRESHOLD_PX) {
      if (dx < 0 && activeIndex < images.length - 1) {
        navigatePopup(1);
        return;
      }
      if (dx > 0 && activeIndex > 0) {
        navigatePopup(-1);
        return;
      }
    }
    setPopupDragOffset(0);
  };

  const goPrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    selectThumb(activeIndex - 1);
  };

  const goNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    selectThumb(activeIndex + 1);
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

  return (
    <>
      <div
        className="relative aspect-square w-full select-none overflow-hidden [touch-action:pan-y]"
        onPointerDown={handleMainPointerDown}
        onPointerMove={handleMainPointerMove}
        onPointerUp={finishMainDrag}
        onPointerCancel={finishMainDrag}
      >
        <button
          type="button"
          onClick={openPopup}
          className="group relative block h-full w-full cursor-zoom-in overflow-hidden"
          aria-label="ดูรูปขนาดเต็ม"
        >
          <div
            className={`flex h-full ${isMainDragging ? "" : "transition-transform duration-300 ease-out"}`}
            style={{
              transform: `translate3d(calc(${-activeIndex * 100}% + ${mainDragOffset}px), 0, 0)`,
            }}
          >
            {images.map((image, index) => {
              const distance = Math.abs(index - activeIndex);
              return (
                <div key={`${image.url}-main-${index}`} className="relative h-full w-full shrink-0">
                  <Image
                    src={image.url}
                    alt={image.alt}
                    fill
                    sizes="(max-width: 1024px) 100vw, 45vw"
                    fetchPriority={index === 0 ? "high" : undefined}
                    loading={index === 0 ? "eager" : "lazy"}
                    draggable={false}
                    className={`pointer-events-none object-contain object-top p-5 pt-20 transition duration-300 ease-out motion-reduce:transform-none motion-reduce:transition-none sm:p-7 sm:pt-16 ${
                      distance === 0 ? "scale-100 opacity-100 group-hover:scale-[1.12]" : "scale-[0.96] opacity-70"
                    }`}
                  />
                </div>
              );
            })}
          </div>
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

      {hasMultiple && (
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
            className="flex snap-x gap-3 overflow-x-auto scroll-smooth p-3 [&::-webkit-scrollbar]:hidden sm:gap-2"
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
                  className={`relative h-20 w-20 shrink-0 snap-center overflow-hidden rounded-2xl border bg-white shadow-sm transition active:scale-95 dark:bg-slate-800 sm:h-16 sm:w-16 sm:rounded-xl ${
                    isActive
                      ? "border-[#f97316] shadow-[0_10px_24px_rgba(249,115,22,0.22)] ring-2 ring-[#f97316]/45 dark:border-sky-400 dark:ring-sky-400/40"
                      : "border-slate-200 hover:border-[#f97316]/60 dark:border-white/10 dark:hover:border-sky-400/60"
                  }`}
                  aria-label={`เลือก ${image.alt || `รูปที่ ${index + 1}`}`}
                  aria-current={isActive ? "true" : undefined}
                >
                  <Image
                    src={image.url}
                    alt={image.alt || `${productName} รูปที่ ${index + 1}`}
                    fill
                    sizes="(max-width: 640px) 80px, 64px"
                    className="object-contain p-1"
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
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/92 p-0 backdrop-blur-sm sm:p-4"
          onClick={closePopup}
          role="dialog"
          aria-modal="true"
          aria-label="ดูรูปขนาดเต็ม"
        >
          <div
            className="relative flex h-full w-full max-w-5xl flex-col justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={closePopup}
              className="absolute right-4 top-4 z-30 rounded-full bg-black/45 p-2 text-white ring-1 ring-white/15 transition hover:bg-white hover:text-slate-900 sm:right-0 sm:top-0"
              aria-label="ปิด"
            >
              <X size={24} />
            </button>

            {hasMultiple && (
              <div className="absolute left-1/2 top-5 z-20 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-xs font-semibold text-white ring-1 ring-white/15 sm:top-4">
                {activeIndex + 1} / {images.length}
              </div>
            )}

            <div
              className="relative min-h-0 flex-1 cursor-grab overflow-hidden active:cursor-grabbing [touch-action:pan-y] sm:rounded-2xl"
              onPointerDown={handlePopupPointerDown}
              onPointerMove={handlePopupPointerMove}
              onPointerUp={finishPopupDrag}
              onPointerCancel={finishPopupDrag}
            >
              <div
                className={`flex h-full ${isPopupDragging ? "" : "transition-transform duration-300 ease-out"}`}
                style={{
                  transform: `translate3d(calc(${-activeIndex * 100}% + ${popupDragOffset}px), 0, 0)`,
                }}
              >
                {images.map((image, index) => {
                  const distance = Math.abs(index - activeIndex);
                  return (
                    <div key={`${image.url}-popup-${index}`} className="relative h-full w-full shrink-0 px-3 py-14 sm:px-8 sm:py-12">
                      <div
                        className={`relative h-full w-full overflow-hidden bg-white transition duration-300 sm:rounded-2xl ${
                          distance === 0 ? "scale-100 opacity-100" : "scale-[0.96] opacity-70"
                        }`}
                      >
                        <Image
                          src={image.url}
                          alt={image.alt}
                          fill
                          className="pointer-events-none object-contain select-none"
                          sizes="(max-width: 768px) 100vw, 1000px"
                          draggable={false}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {hasMultiple && (
              <>
                <button
                  type="button"
                  onClick={() => navigatePopup(-1)}
                  disabled={isFirst}
                  className="absolute left-3 top-1/2 z-20 hidden -translate-y-1/2 rounded-full bg-white/90 p-3 text-slate-800 shadow-md transition hover:bg-white disabled:opacity-35 sm:block"
                  aria-label="ก่อนหน้า"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => navigatePopup(1)}
                  disabled={isLast}
                  className="absolute right-3 top-1/2 z-20 hidden -translate-y-1/2 rounded-full bg-white/90 p-3 text-slate-800 shadow-md transition hover:bg-white disabled:opacity-35 sm:block"
                  aria-label="ถัดไป"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
                <div className="flex shrink-0 snap-x gap-2 overflow-x-auto px-4 pb-5 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:justify-center sm:px-8 sm:pb-2">
                  {images.map((image, index) => {
                    const isActive = index === activeIndex;
                    return (
                      <button
                        type="button"
                        key={`${image.url}-popup-thumb-${index}`}
                        ref={(el) => {
                          popupThumbRefs.current[index] = el;
                        }}
                        onClick={() => goToImage(index)}
                        className={`relative h-16 w-16 shrink-0 snap-center overflow-hidden rounded-xl border bg-white transition active:scale-95 ${
                          isActive
                            ? "border-[#f97316] ring-2 ring-[#f97316]"
                            : "border-white/25 opacity-70 hover:opacity-100"
                        }`}
                        aria-label={`เลือก ${image.alt || `รูปที่ ${index + 1}`}`}
                        aria-current={isActive ? "true" : undefined}
                      >
                        <Image
                          src={image.url}
                          alt={image.alt || `${productName} รูปที่ ${index + 1}`}
                          fill
                          sizes="64px"
                          className="object-contain p-1"
                          draggable={false}
                        />
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default ProductImageGallery;
