"use client";

import { useState } from "react";
import Image from "next/image";
import { Box, ZoomIn } from "lucide-react";

import ProductImageZoomLightbox from "@/components/shared/ProductImageZoomLightbox";
import { toProductImageCdnPath } from "@/lib/product-image-url";
import { buildProductZoomImages } from "@/lib/product-zoom-images";

type Props = {
  imageUrl: string | null;
  images: { url: string; alt: string | null }[];
  name: string;
  isActive: boolean;
};

/**
 * รูปสินค้าบนการ์ดผลค้นหา — คลิกแล้วเปิด popup รูปใหญ่พร้อมรูปทั้งหมดของสินค้านั้น
 * ใช้ ProductImageZoomLightbox ตัวเดียวกับหน้ารายการสินค้า/หน้า preview
 */
const ProductCardImage = ({ imageUrl, images, name, isActive }: Props) => {
  const galleryImages = buildProductZoomImages(imageUrl, images, name);
  const hasImages = galleryImages.length > 0;
  const hasMultiple = galleryImages.length > 1;
  const thumbSrc = toProductImageCdnPath(galleryImages[0]?.url) ?? galleryImages[0]?.url;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const inactiveBadge = !isActive ? (
    <span className="absolute left-2 top-2 rounded-full bg-gray-900/80 px-2 py-0.5 text-[10px] font-semibold text-white">
      ปิดใช้งาน
    </span>
  ) : null;

  if (!hasImages) {
    return (
      <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-2xl bg-gray-100 dark:bg-slate-800 sm:h-32 sm:w-32">
        <div className="flex h-full w-full items-center justify-center text-gray-300 dark:text-slate-600">
          <Box size={34} />
        </div>
        {inactiveBadge}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setActiveIndex(0);
          setOpen(true);
        }}
        className="group/image relative h-28 w-28 shrink-0 cursor-zoom-in overflow-hidden rounded-2xl bg-gray-100 outline-none transition active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-orange-500 dark:bg-slate-800 sm:h-32 sm:w-32"
        aria-label={`ดูรูปขนาดใหญ่ของ ${name}`}
      >
        <Image
          src={thumbSrc}
          alt={name}
          fill
          className="object-cover transition duration-300 group-hover:scale-105"
          sizes="128px"
        />
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover/image:bg-black/25 group-hover/image:opacity-100">
          <ZoomIn size={22} />
        </span>
        {inactiveBadge}
        {hasMultiple ? (
          <span className="absolute bottom-0 right-0 flex h-5 min-w-[20px] items-center justify-center rounded-tl-md bg-black/60 px-1 text-[10px] font-bold leading-none text-white">
            {galleryImages.length}
          </span>
        ) : null}
      </button>

      <ProductImageZoomLightbox
        images={galleryImages}
        activeIndex={activeIndex}
        open={open}
        title={name}
        onClose={() => setOpen(false)}
        onActiveIndexChange={setActiveIndex}
        maxWidthClassName="max-w-4xl"
      />
    </>
  );
};

export default ProductCardImage;
