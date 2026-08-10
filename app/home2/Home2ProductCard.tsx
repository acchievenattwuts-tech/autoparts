import Image from "next/image";
import Link from "next/link";
import { MessageCircle, ShieldCheck } from "lucide-react";
import { getProductPath } from "@/lib/product-slug";
import { toProductImageCdnPath } from "@/lib/product-image-url";
import {
  getStorefrontRetailPricing,
  STOREFRONT_PRICE_INQUIRY_LABEL,
  STOREFRONT_SPECIAL_PRICE_CTA_COMPACT,
} from "@/lib/storefront-pricing";
import type { Home2ProductCardData } from "./home2-data";
import { HOME2_PRICE_TEXT_CLASS } from "./home2-theme";

interface Props {
  product: Home2ProductCardData;
  lineUrl: string;
  /** Rail cards get a fixed width so the row scrolls; grid cards flex. */
  variant?: "grid" | "rail";
}

/**
 * Shopee-style compact product card, white + blue.
 *
 * Deliberately a Server Component: the whole card is links and anchors, so it
 * ships zero JavaScript and keeps the home2 LCP/INP budget clear.
 */
const Home2ProductCard = ({ product, lineUrl, variant = "grid" }: Props) => {
  const productPath = getProductPath({ category: product.category, product });
  const pricing = getStorefrontRetailPricing(product.retailPrice);
  const saleUnitLabel = product.saleUnitName.trim() || "หน่วย";
  const imageSrc = product.imageUrl
    ? (toProductImageCdnPath(product.imageUrl) ?? product.imageUrl)
    : null;

  return (
    <article
      className={`group relative flex h-full flex-col overflow-hidden rounded-xl border border-[#e3ecf8] bg-white transition-all duration-200 hover:-translate-y-0.5 hover:border-[#1e3a5f]/35 hover:shadow-[0_10px_28px_rgba(30,58,95,0.16)] motion-reduce:transform-none ${
        variant === "rail" ? "w-[158px] shrink-0 snap-start sm:w-[178px]" : "w-full"
      }`}
    >
      <Link
        href={productPath}
        prefetch={false}
        aria-label={`ดูรายละเอียด ${product.name}`}
        className="absolute inset-0 z-10 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-2"
      />

      <div className="relative aspect-square w-full shrink-0 overflow-hidden bg-[#f4f7fc]">
        {imageSrc ? (
          <Image
            src={imageSrc}
            alt={`${product.name}${product.brandName ? ` ${product.brandName}` : ""} | อะไหล่แอร์รถยนต์ ${product.category.name}`}
            fill
            className="object-cover transition-transform duration-500 ease-out group-hover:scale-105 motion-reduce:transform-none motion-reduce:transition-none"
            sizes={
              variant === "rail"
                ? "(max-width: 640px) 158px, 178px"
                : "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
            }
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-4xl opacity-20">📦</div>
        )}

        {product.warrantyDays > 0 && (
          <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50/95 px-2 py-0.5 text-[10px] font-bold text-emerald-700 shadow-sm">
            <ShieldCheck className="h-3 w-3" />
            ประกัน {product.warrantyDays.toLocaleString("th-TH")} วัน
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <h3 className="line-clamp-2 min-h-[2.25rem] text-xs font-semibold leading-snug text-slate-800 transition-colors group-hover:text-[#1e3a5f] sm:text-[13px]">
          {product.name}
        </h3>

        <p className="line-clamp-1 text-[11px] text-slate-400">
          {product.fitmentSummary ?? product.brandName ?? product.category.name}
        </p>

        <div className="mt-auto pt-1.5">
          {pricing ? (
            <p className={`text-base font-extrabold leading-none ${HOME2_PRICE_TEXT_CLASS}`}>
              ฿{pricing.retailPrice.toLocaleString("th-TH")}
            </p>
          ) : (
            <p className={`text-base font-extrabold leading-none ${HOME2_PRICE_TEXT_CLASS}`}>
              {STOREFRONT_PRICE_INQUIRY_LABEL}
            </p>
          )}

          <p className="mt-0.5 text-[10px] text-slate-400">/ {saleUnitLabel}</p>

          {lineUrl && (
            <a
              href={lineUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="relative z-20 mt-2 flex w-full items-center justify-center gap-1 rounded-lg bg-[#1e3a5f] px-2 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-[#163055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-1"
            >
              <MessageCircle className="h-3 w-3" />
              {STOREFRONT_SPECIAL_PRICE_CTA_COMPACT}
            </a>
          )}
        </div>
      </div>
    </article>
  );
};

export default Home2ProductCard;
