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
  categories: Home2CategoryData[];
  visualSettings: Record<string, CategoryVisualSetting>;
}

const Home2CategoryStrip = ({ categories, visualSettings }: Props) => {
  if (categories.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 pt-3 sm:px-6 lg:px-8">
      <div className={HOME2_SECTION_CARD_CLASS}>
        <div className="flex items-center justify-between border-b border-[#eef3fa] px-4 py-3 sm:px-5">
          <h2 className="font-kanit text-base font-bold text-[#1e3a5f] sm:text-lg">หมวดหมู่สินค้า</h2>
          <Link
            href="/products"
            className="-mr-2 inline-flex min-h-[28px] items-center gap-1 rounded-full px-2 text-xs font-semibold text-[#2563eb] transition-colors hover:bg-[#eff5fc] hover:text-[#1d4ed8] sm:text-sm"
          >
            ดูทั้งหมด
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {/* gap-px over a tinted track draws the dividers, so no cell border can
            double up against the rounded card edge */}
        <div className="grid grid-cols-3 gap-px bg-[#eef3fa] sm:grid-cols-4 lg:grid-cols-8">
          {categories.map((category) => {
            const visual = resolveCategoryVisual(category, visualSettings[category.id]);
            const Icon = ICONS[visual.iconKey] ?? Cog;

            return (
              <Link
                key={category.id}
                href={getCategoryPath(category)}
                prefetch={false}
                className="group flex flex-col items-center gap-2 bg-white px-2 py-4 text-center transition-colors hover:bg-[#f6f9fe]"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#eff5fc] text-[#1e3a5f] transition-colors group-hover:bg-[#1e3a5f] group-hover:text-white">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="line-clamp-2 text-[11px] font-medium leading-tight text-slate-700 sm:text-xs">
                  {category.name}
                </span>
                <span className="text-[10px] text-slate-400">
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
