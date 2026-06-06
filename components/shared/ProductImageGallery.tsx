"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, PackageSearch, ZoomIn } from "lucide-react";
import ProductImageZoomLightbox from "@/components/shared/ProductImageZoomLightbox";

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
const EDGE_RESISTANCE = 0.35;

const ProductImageGallery = ({ images, productName }: Props) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const pointerStart = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const shouldIgnoreNextOpen = useRef(false);

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

  const selectThumb = useCallback(
    (index: number) => {
      const nextIndex = Math.max(0, Math.min(index, images.length - 1));
      setActiveIndex(nextIndex);
      scrollActiveThumbIntoView(nextIndex);
    },
    [images.length, scrollActiveThumbIntoView],
  );

  const goToImage = useCallback(
    (index: number) => {
      setDragOffset(0);
      selectThumb(index);
    },
    [selectThumb],
  );

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

  const openLightbox = () => {
    if (shouldIgnoreNextOpen.current) {
      shouldIgnoreNextOpen.current = false;
      return;
    }
    setLightboxOpen(true);
  };

  const scrollStrip = (dir: "left" | "right") => {
    const el = stripRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "left" ? -SCROLL_STEP_PX : SCROLL_STEP_PX, behavior: "smooth" });
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!hasMultiple || e.pointerType === "mouse") return;
    pointerStart.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    shouldIgnoreNextOpen.current = false;
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current;
    if (!start) return;

    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    if (Math.abs(dy) > Math.abs(dx) * 1.35) return;

    shouldIgnoreNextOpen.current = true;
    const atFirst = activeIndex === 0 && dx > 0;
    const atLast = activeIndex === images.length - 1 && dx < 0;
    setDragOffset(atFirst || atLast ? dx * EDGE_RESISTANCE : dx);
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current;
    if (!start) return;

    const dx = e.clientX - start.x;
    if (e.currentTarget.hasPointerCapture(start.pointerId)) {
      e.currentTarget.releasePointerCapture(start.pointerId);
    }

    pointerStart.current = null;
    setIsDragging(false);

    if (Math.abs(dx) > MAIN_SWIPE_THRESHOLD_PX) {
      selectThumb(dx < 0 ? activeIndex + 1 : activeIndex - 1);
      setDragOffset(0);
      return;
    }
    setDragOffset(0);
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
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <button
          type="button"
          onClick={openLightbox}
          className="group relative block h-full w-full cursor-zoom-in overflow-hidden"
          aria-label="Open product image zoom"
        >
          <div
            className={`flex h-full ${isDragging ? "" : "transition-transform duration-300 ease-out"}`}
            style={{
              transform: `translate3d(calc(${-activeIndex * 100}% + ${dragOffset}px), 0, 0)`,
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
          <span className="pointer-events-none absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-sm ring-1 ring-slate-200 transition group-hover:bg-[#f97316] group-hover:text-white dark:bg-slate-800/90 dark:text-slate-100 dark:ring-white/10 dark:group-hover:bg-sky-500">
            <ZoomIn className="h-4 w-4" />
          </span>
        </button>

        {hasMultiple && (
          <>
            <button
              type="button"
              onClick={goPrev}
              disabled={isFirst}
              className="absolute left-2 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-md ring-1 ring-slate-200 transition hover:bg-white hover:text-[#f97316] disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-800/90 dark:text-slate-200 dark:ring-white/10 dark:hover:text-sky-400 sm:flex"
              aria-label="Previous image"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={isLast}
              className="absolute right-2 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-md ring-1 ring-slate-200 transition hover:bg-white hover:text-[#f97316] disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-800/90 dark:text-slate-200 dark:ring-white/10 dark:hover:text-sky-400 sm:flex"
              aria-label="Next image"
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
              aria-label="Scroll thumbnails left"
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
                  aria-label={`Select ${image.alt || `image ${index + 1}`}`}
                  aria-current={isActive ? "true" : undefined}
                >
                  <Image
                    src={image.url}
                    alt={image.alt || `${productName} image ${index + 1}`}
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
              aria-label="Scroll thumbnails right"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      <ProductImageZoomLightbox
        images={images}
        activeIndex={activeIndex}
        open={lightboxOpen}
        title={productName}
        onClose={() => setLightboxOpen(false)}
        onActiveIndexChange={goToImage}
      />
    </>
  );
};

export default ProductImageGallery;
