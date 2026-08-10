import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
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
import Home2Carousel from "./Home2Carousel";
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

interface Props {
  categories: Home2CategoryData[];
  visualSettings: Record<string, CategoryVisualSetting>;
}

/**
 * Shopee-style category block: two rows that scroll sideways.
 */
const Home2CategoryStrip = ({ categories, visualSettings }: Props) => {
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

        {/* grid-flow-col + grid-rows-2 lays tiles down-then-across, so the block
            fills two rows and overflows sideways. The track is pulled 1px past
            the card on the bottom/right edges so trailing cell borders clip
            away — a tinted gap-track would show through the final row's empty
            cells instead. */}
        <Home2Carousel label="หมวดหมู่" trackClassName="-mb-px -mr-px grid grid-flow-col grid-rows-2">
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
        </Home2Carousel>
      </div>
    </section>
  );
};

export default Home2CategoryStrip;
