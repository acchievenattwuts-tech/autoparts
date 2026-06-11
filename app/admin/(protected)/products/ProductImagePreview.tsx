"use client";

import { useState } from "react";
import Image from "next/image";
import { ZoomIn } from "lucide-react";
import ProductImageZoomLightbox, { type ProductZoomImage } from "@/components/shared/ProductImageZoomLightbox";
import { toProductImageCdnPath } from "@/lib/product-image-url";

interface Props {
  imageUrl?: string | null;
  images?: { url: string; alt: string | null }[];
  alt: string;
  /** Thumbnail size: "sm" (40px, default for list tables) or "lg" (160px, for detail/preview pages). */
  size?: "sm" | "lg";
}

function buildImageList(
  imageUrl: string | null | undefined,
  images: { url: string; alt: string | null }[] | undefined,
  fallbackAlt: string,
): ProductZoomImage[] {
  const extra: ProductZoomImage[] =
    images?.map((img) => ({ url: img.url, alt: img.alt ?? fallbackAlt })) ?? [];

  if (!imageUrl) return extra;

  const alreadyIncluded = extra.some((img) => img.url === imageUrl);
  if (alreadyIncluded) return extra;

  return [{ url: imageUrl, alt: fallbackAlt }, ...extra];
}

const ProductImagePreview = ({ imageUrl, images, alt, size = "sm" }: Props) => {
  const galleryImages = buildImageList(imageUrl, images, alt);
  const hasMultiple = galleryImages.length > 1;
  const isLarge = size === "lg";
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const thumbSrc = toProductImageCdnPath(galleryImages[0]?.url) ?? galleryImages[0]?.url;

  const openAt = (index: number) => {
    setActiveIndex(index);
    setOpen(true);
  };

  if (galleryImages.length === 0) {
    return (
      <div
        className={`flex items-center justify-center rounded-lg bg-gray-100 dark:bg-white/5 ${
          isLarge ? "h-40 w-40" : "h-10 w-10"
        }`}
      >
        <span className="text-xs text-gray-300 dark:text-slate-600">ไม่มี</span>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => openAt(0)}
        className={`group relative flex-shrink-0 cursor-zoom-in overflow-hidden border border-gray-100 transition-all hover:ring-2 hover:ring-[#1e3a5f] dark:border-white/10 dark:hover:ring-sky-400 ${
          isLarge ? "h-40 w-40 rounded-xl bg-gray-50 dark:bg-slate-800" : "h-10 w-10 rounded-lg"
        }`}
        aria-label={`Open product image zoom for ${alt}`}
      >
        <Image
          src={thumbSrc!}
          alt={alt}
          fill
          className={isLarge ? "object-contain p-2" : "object-cover"}
          sizes={isLarge ? "160px" : "40px"}
        />
        <span
          className={`pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/25 group-hover:opacity-100 ${
            isLarge ? "" : "hidden"
          }`}
        >
          <ZoomIn className="h-6 w-6" />
        </span>
        {hasMultiple && (
          <span
            className={`absolute bottom-0 right-0 flex items-center justify-center rounded-tl-md bg-black/60 font-bold leading-none text-white ${
              isLarge ? "h-6 min-w-[24px] px-1.5 text-xs" : "h-4 min-w-[16px] px-0.5 text-[9px]"
            }`}
          >
            {galleryImages.length}
          </span>
        )}
      </button>

      <ProductImageZoomLightbox
        images={galleryImages}
        activeIndex={activeIndex}
        open={open}
        title={alt}
        onClose={() => setOpen(false)}
        onActiveIndexChange={setActiveIndex}
        maxWidthClassName="max-w-4xl"
      />
    </>
  );
};

export default ProductImagePreview;
