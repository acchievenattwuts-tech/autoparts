"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { MessageCircle, ShieldCheck } from "lucide-react";
import { getProductPath } from "@/lib/product-slug";
import {
  getStorefrontDisplayPrices,
  HIDE_STOREFRONT_PRICE,
  STOREFRONT_PRICE_INQUIRY_LABEL,
} from "@/lib/storefront-pricing";
import { toProductImageCdnPath } from "@/lib/product-image-url";
import { STOREFRONT_LINE_COMPACT_BUTTON_CLASS } from "@/lib/storefront-line-theme";

type ProductForCard = {
  id: string;
  slug?: string | null;
  name: string;
  code: string;
  imageUrl: string | null;
  salePrice: { toString(): string } | number;
  saleUnitName?: string | null;
  warrantyDays?: number | null;
  stock: number;
  category: { name: string; slug?: string | null };
  brand: { name: string } | null;
  carModels?: {
    yearStart?: number | null;
    yearEnd?: number | null;
    carModel: { name: string; carBrand: { name: string } };
  }[];
};

interface Props {
  product: ProductForCard;
  lineUrl: string;
  prefetchDetail?: boolean;
}

const formatFitmentYear = (yearStart?: number | null, yearEnd?: number | null) => {
  if (yearStart && yearEnd) return `${yearStart}-${yearEnd}`;
  if (yearStart) return `${yearStart}+`;
  if (yearEnd) return `ถึง ${yearEnd}`;
  return null;
};

const ProductCard = ({ product, lineUrl, prefetchDetail }: Props) => {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const inStock = product.stock > 0;
  const productPath = getProductPath({
    category: product.category,
    product,
  });
  const displayPrices = getStorefrontDisplayPrices(product.salePrice);
  const saleUnitLabel = product.saleUnitName?.trim() || "หน่วย";

  const compatibilitySummary =
    product.carModels && product.carModels.length > 0
      ? (() => {
          const firstBrand = product.carModels[0].carModel.carBrand.name;
          const items = product.carModels
            .filter(({ carModel }) => carModel.carBrand.name === firstBrand)
            .map((fitment) => {
              const year = formatFitmentYear(fitment.yearStart, fitment.yearEnd);
              return `${firstBrand} - ${fitment.carModel.name}${year ? ` ${year}` : ""}`;
            });
          return Array.from(new Set(items)).join(", ");
        })()
      : null;

  const handleProductClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Allow right-click, middle-click, Ctrl+click, Meta+click to behave natively
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    startTransition(() => {
      router.push(productPath);
    });
  };

  return (
    <div className="group relative flex h-full min-h-[20.5rem] flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-[#f97316]/45 hover:shadow-[0_20px_45px_rgba(15,23,42,0.16)] hover:ring-2 hover:ring-[#f97316]/12 focus-within:border-[#f97316]/55 focus-within:ring-2 focus-within:ring-[#f97316]/20 motion-reduce:transform-none sm:min-h-[23.75rem] lg:min-h-[24.25rem]">

      {/* Loading overlay — แสดงทันทีที่คลิก */}
      {isPending && (
        <div className="absolute inset-0 z-30 flex items-center justify-center rounded-2xl bg-white/75 backdrop-blur-[2px]">
          <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-[#f97316]/30 border-t-[#f97316]" />
        </div>
      )}

      <Link
        href={productPath}
        prefetch={prefetchDetail ?? true}
        onClick={handleProductClick}
        aria-label={`ดูรายละเอียด ${product.name}`}
        className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-2"
      />

      <div className="relative aspect-square w-full shrink-0 overflow-hidden bg-gradient-to-br from-gray-100 to-gray-50">
        {product.imageUrl ? (
          <Image
            src={toProductImageCdnPath(product.imageUrl) ?? product.imageUrl}
            alt={`${product.name}${product.brand ? ` ${product.brand.name}` : ""} | อะไหล่แอร์รถยนต์ ${product.category.name}`}
            fill
            className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.1] motion-reduce:transform-none motion-reduce:transition-none"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-5xl opacity-20">📦</span>
          </div>
        )}
        {!inStock && (
          <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">
            สินค้าหมด
          </span>
        )}
        {(product.warrantyDays ?? 0) > 0 && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50/95 px-2 py-0.5 text-[10px] font-bold text-emerald-700 shadow-sm sm:text-xs">
            <ShieldCheck className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            ประกัน {(product.warrantyDays ?? 0).toLocaleString("th-TH")} วัน
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-3 sm:p-4">
        <span className="self-start rounded-full bg-[#1e3a5f]/10 px-2 py-0.5 text-xs font-medium text-[#1e3a5f]">
          {product.category.name}
        </span>

        <div className="mt-2 min-h-[2.15rem] sm:min-h-[2.45rem]">
          <h3 className="line-clamp-2 text-xs font-bold leading-snug text-gray-900 transition-colors group-hover:text-[#1e3a5f] sm:text-sm">
            {product.name}
          </h3>
        </div>

        <div className="mt-1 overflow-hidden">
          {product.brand && <p className="line-clamp-1 text-xs text-gray-400">{product.brand.name}</p>}
          {compatibilitySummary && (
            <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-500">
              {compatibilitySummary}
            </p>
          )}
        </div>

        <div className="mt-auto pt-1.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
            {HIDE_STOREFRONT_PRICE ? (
              <div className="min-w-0">
                <p className="whitespace-nowrap text-lg font-extrabold leading-tight text-[#f97316] sm:text-xl">
                  {STOREFRONT_PRICE_INQUIRY_LABEL}
                </p>
              </div>
            ) : (
              <div className="min-w-0">
                <p className="text-xs text-gray-400">ราคาปกติ</p>
                <p className="text-xs text-gray-400 line-through">
                  ฿{displayPrices.compareAtPrice.toLocaleString("th-TH")}
                </p>
                <p className="mt-1 text-xs font-bold text-emerald-600 sm:text-sm">ราคาพิเศษ</p>
                <p className="text-xl font-extrabold leading-none text-[#f97316] sm:text-2xl">
                  ฿{displayPrices.salePrice.toLocaleString("th-TH")}
                </p>
                <p className="mt-1 text-[11px] font-medium text-slate-500 sm:text-xs">
                  / {saleUnitLabel}
                </p>
              </div>
            )}

            <div className="relative z-20 w-full sm:w-auto sm:shrink-0">
              <a
                href={lineUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`${STOREFRONT_LINE_COMPACT_BUTTON_CLASS} w-full justify-center gap-1.5 px-3 py-2.5 text-[11px] sm:w-auto sm:px-4 sm:text-xs`}
              >
                <MessageCircle size={11} />
                สอบถาม
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductCard;
