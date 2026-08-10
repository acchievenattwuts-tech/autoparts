import Link from "next/link";
import { ArrowRight } from "lucide-react";
import StorefrontCarousel from "@/components/storefront/StorefrontCarousel";
import StorefrontProductCard from "@/components/storefront/StorefrontProductCard";
import type { StorefrontProductCardData } from "@/lib/storefront-home";
import { STOREFRONT_SECTION_CARD_CLASS } from "@/lib/storefront-home-theme";

interface Props {
  title: string;
  subtitle?: string;
  /** Destination of the "ดูทั้งหมด" link. */
  href: string;
  products: StorefrontProductCardData[];
  lineUrl: string;
}

/**
 * Product row that scrolls sideways in a single line, like the category block
 * above it but one row deep.
 */
const HomeProductRail = ({ title, subtitle, href, products, lineUrl }: Props) => {
  if (products.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 pt-3 sm:px-6 lg:px-8">
      <div className={STOREFRONT_SECTION_CARD_CLASS}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eef3fa] px-4 py-3 sm:px-5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="font-kanit text-base font-bold text-[#1e3a5f] sm:text-lg">{title}</h2>
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
          <StorefrontCarousel label={title} trackClassName="flex gap-3 pb-1">
            {products.map((product) => (
              <StorefrontProductCard
                key={product.id}
                product={product}
                lineUrl={lineUrl}
                variant="rail"
              />
            ))}
          </StorefrontCarousel>
        </div>
      </div>
    </section>
  );
};

export default HomeProductRail;
