"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Horizontal scroller with arrow controls, shared by the category block and the
 * best-seller row.
 *
 * Only the overflow behaviour and the arrows live here — the caller supplies
 * the track's own layout classes, so one section can lay its items out in two
 * rows and another in one without this component knowing about either.
 *
 * Children are rendered as-is, so Server Components can be passed straight
 * through and no extra JavaScript ships for the items themselves.
 */

/** Fraction of the visible width one arrow click travels. */
const SCROLL_STEP_RATIO = 0.85;
/** Ignore sub-pixel rounding when deciding whether an arrow is still usable. */
const SCROLL_EPSILON = 4;

interface Props {
  children: ReactNode;
  /** Layout classes for the scrolling track (grid or flex, gaps, padding). */
  trackClassName?: string;
  /** Accessible description of what is being scrolled, e.g. "หมวดหมู่". */
  label: string;
}

const Home2Carousel = ({ children, trackClassName = "", label }: Props) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const syncArrows = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const maxScroll = scroller.scrollWidth - scroller.clientWidth;
    setCanScrollLeft(scroller.scrollLeft > SCROLL_EPSILON);
    setCanScrollRight(scroller.scrollLeft < maxScroll - SCROLL_EPSILON);
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    syncArrows();
    scroller.addEventListener("scroll", syncArrows, { passive: true });

    // Column counts are breakpoint-driven, so the overflow changes on resize.
    const observer = new ResizeObserver(syncArrows);
    observer.observe(scroller);

    return () => {
      scroller.removeEventListener("scroll", syncArrows);
      observer.disconnect();
    };
  }, [syncArrows]);

  const scrollByStep = (direction: 1 | -1) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollBy({
      left: direction * scroller.clientWidth * SCROLL_STEP_RATIO,
      behavior: "smooth",
    });
  };

  return (
    <div className="relative">
      <div
        ref={scrollerRef}
        className={`snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${trackClassName}`}
      >
        {children}
      </div>

      {/* Arrows are a pointer affordance — touch users simply swipe.
          z-40 keeps them above the product card's full-bleed overlay link
          (z-10), its LINE button (z-20) and its loading veil (z-30); without a
          z-index the overlay link won and swallowed the click. It stays below
          the floating contact launcher (z-50), which should remain topmost. */}
      {canScrollLeft && (
        <button
          type="button"
          onClick={() => scrollByStep(-1)}
          aria-label={`เลื่อน${label}ไปทางซ้าย`}
          className="absolute left-1 top-1/2 z-40 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-[#dbe6f5] bg-white text-[#1e3a5f] shadow-md transition hover:bg-[#eff5fc] hover:shadow-lg lg:flex"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      {canScrollRight && (
        <button
          type="button"
          onClick={() => scrollByStep(1)}
          aria-label={`เลื่อน${label}ไปทางขวา`}
          className="absolute right-1 top-1/2 z-40 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-[#dbe6f5] bg-white text-[#1e3a5f] shadow-md transition hover:bg-[#eff5fc] hover:shadow-lg lg:flex"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      )}
    </div>
  );
};

export default Home2Carousel;
