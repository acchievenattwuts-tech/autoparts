"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Cog,
  Droplets,
  Fan,
  Flame,
  Snowflake,
  SlidersHorizontal,
  Thermometer,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  resolveCategoryVisual,
  type CategoryIconKey,
  type CategoryVisualSetting,
} from "@/lib/category-visual-config";
import { toProductImageCdnPath } from "@/lib/product-image-url";
import { getCategoryPath } from "@/lib/product-slug";
import type { Home2CategoryData } from "./home2-data";
import { HOME2_SECTION_CARD_CLASS } from "./home2-theme";

/**
 * Icon fallback for categories with no photographed product yet — same icon
 * vocabulary as the storefront's <CategoryVisualIcon/>, so an admin's icon
 * choice still applies.
 */
const ICONS: Record<CategoryIconKey, LucideIcon> = {
  compressor: Cog,
  evaporator: Snowflake,
  condenser: Flame,
  radiator: Thermometer,
  blower: Fan,
  valve: SlidersHorizontal,
  dryer: CircleDot,
  wrench: Wrench,
  droplets: Droplets,
  gear: Cog,
};

/** Fraction of the visible width one arrow click travels. */
const SCROLL_STEP_RATIO = 0.85;
/** Ignore sub-pixel rounding when deciding whether an arrow is still usable. */
const SCROLL_EPSILON = 4;

interface Props {
  categories: Home2CategoryData[];
  visualSettings: Record<string, CategoryVisualSetting>;
}

/**
 * Shopee-style category block: two rows that scroll sideways, with arrow
 * controls on desktop and native swipe on touch.
 */
const Home2CategoryStrip = ({ categories, visualSettings }: Props) => {
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

    // Column count is breakpoint-driven, so the overflow changes on resize.
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

  if (categories.length === 0) return null;

  return (
    <section id="categories" className="mx-auto max-w-7xl px-4 pt-3 sm:px-6 lg:px-8">
      <div className={`${HOME2_SECTION_CARD_CLASS} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eef3fa] px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="font-kanit text-base font-bold text-[#1e3a5f] sm:text-lg">
              หมวดหมู่สินค้า
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              ครบทั้ง {categories.length.toLocaleString("th-TH")} หมวด เลื่อนดูหรือกดเลือกได้เลย
            </p>
          </div>
          <Link
            href="/products"
            className="-mr-2 inline-flex min-h-[28px] shrink-0 items-center gap-1 rounded-full px-2 text-xs font-semibold text-[#2563eb] transition-colors hover:bg-[#eff5fc] hover:text-[#1d4ed8] sm:text-sm"
          >
            ดูสินค้าทั้งหมด
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="group/strip relative">
          {/* grid-flow-col + grid-rows-2 lays tiles down-then-across, so the
              block fills two rows and overflows sideways like Shopee's. */}
          <div
            ref={scrollerRef}
            className="grid snap-x snap-mandatory grid-flow-col grid-rows-2 overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {categories.map((category) => {
              const visual = resolveCategoryVisual(category, visualSettings[category.id]);
              const Icon = ICONS[visual.iconKey] ?? Cog;
              const imageSrc = category.imageUrl
                ? (toProductImageCdnPath(category.imageUrl) ?? category.imageUrl)
                : null;

              return (
                <Link
                  key={category.id}
                  href={getCategoryPath(category)}
                  prefetch={false}
                  className="group/tile flex w-[124px] shrink-0 snap-start flex-col items-center gap-2 border-b border-r border-[#eef3fa] px-2 py-4 text-center transition-colors hover:bg-[#f6f9fe] sm:w-[142px]"
                >
                  <span className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#e3ecf8] bg-[#f7fafe] transition-colors group-hover/tile:border-[#1e3a5f]/30">
                    {imageSrc ? (
                      <Image
                        src={imageSrc}
                        alt={`หมวด ${category.name}`}
                        fill
                        sizes="64px"
                        className="object-cover transition-transform duration-300 group-hover/tile:scale-105 motion-reduce:transform-none"
                      />
                    ) : (
                      <Icon className="h-6 w-6 text-[#1e3a5f]" />
                    )}
                  </span>

                  <span className="line-clamp-2 min-h-[2.25rem] text-[11px] font-medium leading-snug text-slate-700 sm:text-xs">
                    {category.name}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {category.productCount.toLocaleString("th-TH")} รายการ
                  </span>
                </Link>
              );
            })}
          </div>

          {/* Arrows: pointer-only affordance — touch users just swipe. */}
          {canScrollLeft && (
            <button
              type="button"
              onClick={() => scrollByStep(-1)}
              aria-label="เลื่อนหมวดหมู่ไปทางซ้าย"
              className="absolute left-1 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-[#dbe6f5] bg-white text-[#1e3a5f] shadow-md transition hover:bg-[#eff5fc] lg:flex"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          {canScrollRight && (
            <button
              type="button"
              onClick={() => scrollByStep(1)}
              aria-label="เลื่อนหมวดหมู่ไปทางขวา"
              className="absolute right-1 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-[#dbe6f5] bg-white text-[#1e3a5f] shadow-md transition hover:bg-[#eff5fc] lg:flex"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
    </section>
  );
};

export default Home2CategoryStrip;
