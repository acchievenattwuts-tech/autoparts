"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw, X } from "lucide-react";

export interface ProductZoomImage {
  url: string;
  alt: string;
}

interface Props {
  images: ProductZoomImage[];
  activeIndex: number;
  open: boolean;
  title: string;
  onClose: () => void;
  onActiveIndexChange: (index: number) => void;
  maxWidthClassName?: string;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;
const SWIPE_THRESHOLD_PX = 72;
const EDGE_RESISTANCE = 0.35;
const PAN_BASE_SENSITIVITY = 1.35;
const PAN_ZOOM_SENSITIVITY = 0.55;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

const ProductImageZoomLightbox = ({
  images,
  activeIndex,
  open,
  title,
  onClose,
  onActiveIndexChange,
  maxWidthClassName = "max-w-5xl",
}: Props) => {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const pointerStart = useRef<{ x: number; y: number; pointerId: number; panX: number; panY: number } | null>(null);
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const hasMultiple = images.length > 1;
  const isZoomed = zoom > 1.01;
  const isFirst = activeIndex === 0;
  const isLast = activeIndex === images.length - 1;

  const activeImage = images[activeIndex];
  const zoomLabel = useMemo(() => `${Math.round(zoom * 100)}%`, [zoom]);
  const panSensitivity = useMemo(
    () => PAN_BASE_SENSITIVITY + Math.max(0, zoom - 1) * PAN_ZOOM_SENSITIVITY,
    [zoom],
  );

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setDragOffset(0);
    setIsDragging(false);
    pointerStart.current = null;
  }, []);

  const goTo = useCallback(
    (index: number) => {
      const nextIndex = clamp(index, 0, images.length - 1);
      onActiveIndexChange(nextIndex);
      resetView();
    },
    [images.length, onActiveIndexChange, resetView],
  );

  const adjustZoom = useCallback((delta: number) => {
    setZoom((current) => {
      const nextZoom = clamp(Number((current + delta).toFixed(2)), MIN_ZOOM, MAX_ZOOM);
      if (nextZoom === MIN_ZOOM) {
        setPan({ x: 0, y: 0 });
      }
      return nextZoom;
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && !isLast) goTo(activeIndex + 1);
      if (e.key === "ArrowLeft" && !isFirst) goTo(activeIndex - 1);
      if (e.key === "+" || e.key === "=") adjustZoom(ZOOM_STEP);
      if (e.key === "-") adjustZoom(-ZOOM_STEP);
      if (e.key === "0") resetView();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [activeIndex, adjustZoom, goTo, isFirst, isLast, onClose, open, resetView]);

  useEffect(() => {
    if (!open) return;
    thumbRefs.current[activeIndex]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [activeIndex, open]);

  useEffect(() => {
    if (!open) resetView();
  }, [open, resetView]);

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    adjustZoom(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointerStart.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId, panX: pan.x, panY: pan.y };
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current;
    if (!start) return;

    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;

    if (isZoomed) {
      setPan({
        x: start.panX + dx * panSensitivity,
        y: start.panY + dy * panSensitivity,
      });
      return;
    }

    if (!hasMultiple) return;
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    if (Math.abs(dy) > Math.abs(dx) * 1.35) return;

    const atFirst = activeIndex === 0 && dx > 0;
    const atLast = activeIndex === images.length - 1 && dx < 0;
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

    if (!isZoomed && hasMultiple && Math.abs(dx) > SWIPE_THRESHOLD_PX) {
      if (dx < 0 && activeIndex < images.length - 1) {
        goTo(activeIndex + 1);
        return;
      }
      if (dx > 0 && activeIndex > 0) {
        goTo(activeIndex - 1);
        return;
      }
    }
    setDragOffset(0);
  };

  const onDoubleClick = () => {
    if (isZoomed) {
      resetView();
      return;
    }
    setZoom(2);
  };

  if (!open || images.length === 0 || !activeImage) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/92 p-0 backdrop-blur-sm sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Product image zoom"
    >
      <div
        className={`relative flex h-full w-full ${maxWidthClassName} flex-col justify-center`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute left-4 right-4 top-4 z-30 flex items-center justify-between gap-3 sm:left-0 sm:right-0 sm:top-0">
          <div className="flex min-w-0 items-center gap-2 rounded-full bg-black/45 px-2 py-1 text-white ring-1 ring-white/15">
            {hasMultiple ? (
              <span className="shrink-0 px-2 text-xs font-semibold">
                {activeIndex + 1} / {images.length}
              </span>
            ) : null}
            <span className="shrink-0 rounded-full bg-white/12 px-2 py-1 text-xs font-semibold">{zoomLabel}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1 rounded-full bg-black/45 p-1 text-white ring-1 ring-white/15">
            <button
              type="button"
              onClick={() => adjustZoom(-ZOOM_STEP)}
              disabled={zoom <= MIN_ZOOM}
              className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-white hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35"
              aria-label="Zoom out"
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => adjustZoom(ZOOM_STEP)}
              disabled={zoom >= MAX_ZOOM}
              className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-white hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35"
              aria-label="Zoom in"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={resetView}
              className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-white hover:text-slate-900"
              aria-label="Reset zoom"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-white hover:text-slate-900"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div
          className={`relative min-h-0 flex-1 overflow-hidden [touch-action:none] sm:rounded-2xl ${
            isZoomed ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"
          }`}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
        >
          <div
            className={`flex h-full ${isDragging ? "" : "transition-transform duration-300 ease-out"}`}
            style={{
              transform: `translate3d(calc(${-activeIndex * 100}% + ${dragOffset}px), 0, 0)`,
            }}
          >
            {images.map((image, index) => {
              const distance = Math.abs(index - activeIndex);
              const isActive = index === activeIndex;
              return (
                <div key={`${image.url}-zoom-${index}`} className="relative h-full w-full shrink-0 px-3 py-16 sm:px-8 sm:py-12">
                  <div
                    className={`relative h-full w-full overflow-hidden bg-white transition duration-300 dark:bg-slate-950 sm:rounded-2xl ${
                      distance === 0 ? "scale-100 opacity-100" : "scale-[0.96] opacity-65"
                    }`}
                  >
                    <Image
                      src={image.url}
                      alt={image.alt}
                      fill
                      className="pointer-events-none select-none object-contain"
                      sizes="(max-width: 768px) 100vw, 1000px"
                      draggable={false}
                      style={
                        isActive
                          ? {
                              transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
                              transition: isDragging ? "none" : "transform 120ms ease-out",
                            }
                          : undefined
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {hasMultiple ? (
          <>
            <button
              type="button"
              onClick={() => goTo(activeIndex - 1)}
              disabled={isFirst}
              className="absolute left-3 top-1/2 z-20 hidden -translate-y-1/2 rounded-full bg-white/90 p-3 text-slate-800 shadow-md transition hover:bg-white disabled:opacity-35 sm:block"
              aria-label="Previous image"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => goTo(activeIndex + 1)}
              disabled={isLast}
              className="absolute right-3 top-1/2 z-20 hidden -translate-y-1/2 rounded-full bg-white/90 p-3 text-slate-800 shadow-md transition hover:bg-white disabled:opacity-35 sm:block"
              aria-label="Next image"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <div className="flex shrink-0 snap-x gap-2 overflow-x-auto px-4 pb-5 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:justify-center sm:px-8 sm:pb-2">
              {images.map((image, index) => {
                const isActive = index === activeIndex;
                return (
                  <button
                    type="button"
                    key={`${image.url}-zoom-thumb-${index}`}
                    ref={(el) => {
                      thumbRefs.current[index] = el;
                    }}
                    onClick={() => goTo(index)}
                    className={`relative h-16 w-16 shrink-0 snap-center overflow-hidden rounded-xl border bg-white transition active:scale-95 ${
                      isActive
                        ? "border-[#f97316] ring-2 ring-[#f97316] dark:border-sky-400 dark:ring-sky-400"
                        : "border-white/25 opacity-70 hover:opacity-100"
                    }`}
                    aria-label={`Image ${index + 1}`}
                    aria-current={isActive ? "true" : undefined}
                  >
                    <Image
                      src={image.url}
                      alt={image.alt}
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
        ) : null}

        <p className="shrink-0 truncate px-4 pb-3 text-center text-sm text-white/65">{title}</p>
      </div>
    </div>
  );
};

export default ProductImageZoomLightbox;
