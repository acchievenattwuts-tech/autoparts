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
import { getCategoryPath } from "@/lib/product-slug";
import type { Home2CategoryData } from "./home2-data";
import { HOME2_SECTION_CARD_CLASS } from "./home2-theme";

/**
 * Same icon vocabulary as the live storefront's <CategoryVisualIcon/>, so an
 * admin's icon choice is honoured here too — but rendered in a single blue tone
 * instead of the per-category tone colours, to keep home2 on the white + blue
 * palette.
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
  /** Every active category — this section is not truncated. */
  categories: Home2CategoryData[];
  visualSettings: Record<string, CategoryVisualSetting>;
}

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
              ครบทั้ง {categories.length.toLocaleString("th-TH")} หมวด กดเลือกหมวดที่ต้องการได้เลย
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

        {/* Per-cell borders, with the grid pulled 1px past the card on the
            bottom/right edges so the trailing lines are clipped away. Avoids a
            tinted gap-track, which would show through the empty cells left over
            in the final row. */}
        <div className="-mb-px -mr-px grid grid-cols-2 overflow-hidden sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {categories.map((category) => {
            const visual = resolveCategoryVisual(category, visualSettings[category.id]);
            const Icon = ICONS[visual.iconKey] ?? Cog;

            return (
              <Link
                key={category.id}
                href={getCategoryPath(category)}
                prefetch={false}
                className="group flex min-h-[9.5rem] flex-col items-center gap-2 border-b border-r border-[#eef3fa] bg-white px-3 py-4 text-center transition-colors hover:bg-[#f6f9fe]"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#eff5fc] text-[#1e3a5f] transition-colors group-hover:bg-[#1e3a5f] group-hover:text-white">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="line-clamp-3 text-xs font-medium leading-snug text-slate-700 sm:text-[13px]">
                  {category.name}
                </span>
                <span className="mt-auto text-[11px] text-slate-400">
                  {category.productCount.toLocaleString("th-TH")} รายการ
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default Home2CategoryStrip;
