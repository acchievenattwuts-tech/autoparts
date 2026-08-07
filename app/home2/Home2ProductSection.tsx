import Link from "next/link";
import { ArrowRight } from "lucide-react";
import Home2ProductCard from "./Home2ProductCard";
import type { Home2ProductCardData } from "./home2-data";
import { HOME2_BADGE_CLASS, HOME2_RAIL_CLASS, HOME2_SECTION_CARD_CLASS } from "./home2-theme";

interface Props {
  title: string;
  subtitle?: string;
  /** Badge shown next to the title (e.g. "อัปเดตทุกวัน"). */
  badge?: string;
  /** Destination of the "ดูทั้งหมด" link. */
  href: string;
  products: Home2ProductCardData[];
  lineUrl: string;
  /** "rail" = Shopee-style horizontal scroller, "grid" = responsive grid. */
  layout: "rail" | "grid";
}

const Home2ProductSection = ({
  title,
  subtitle,
  badge,
  href,
  products,
  lineUrl,
  layout,
}: Props) => {
  if (products.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 pt-3 sm:px-6 lg:px-8">
      <div className={HOME2_SECTION_CARD_CLASS}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eef3fa] px-4 py-3 sm:px-5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="font-kanit text-base font-bold text-[#1e3a5f] sm:text-lg">{title}</h2>
            {badge && <span className={HOME2_BADGE_CLASS}>{badge}</span>}
            {subtitle && (
              <p className="w-full text-xs text-slate-500 sm:w-auto sm:text-sm">{subtitle}</p>
            )}
          </div>

          <Link
            href={href}
            className="-mr-2 inline-flex min-h-[28px] shrink-0 items-center gap-1 rounded-full px-2 text-xs font-semibold text-[#2563eb] transition-colors hover:bg-[#eff5fc] hover:text-[#1d4ed8] sm:text-sm"
          >
            ดูทั้งหมด
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="p-3 sm:p-4">
          {layout === "rail" ? (
            <div className={HOME2_RAIL_CLASS}>
              {products.map((product) => (
                <Home2ProductCard
                  key={product.id}
                  product={product}
                  lineUrl={lineUrl}
                  variant="rail"
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {products.map((product) => (
                <Home2ProductCard key={product.id} product={product} lineUrl={lineUrl} />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default Home2ProductSection;
