"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { X } from "lucide-react";

interface Props {
  src: string;
  alt: string;
}

const ProductImagePreview = ({ src, alt }: Props) => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative h-10 w-10 flex-shrink-0 cursor-zoom-in overflow-hidden rounded-lg border border-gray-100 transition-all hover:ring-2 hover:ring-[#1e3a5f] dark:border-white/10 dark:hover:ring-sky-400"
      >
        <Image src={src} alt={alt} fill className="object-cover" sizes="40px" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative max-w-2xl max-h-[80vh] w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute -top-10 right-0 text-white transition-colors hover:text-gray-300"
            >
              <X size={28} />
            </button>
            <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-white dark:bg-slate-950">
              <Image
                src={src}
                alt={alt}
                fill
                className="object-contain"
                sizes="(max-width: 768px) 100vw, 672px"
              />
            </div>
            <p className="mt-3 text-center text-sm text-white opacity-70">{alt}</p>
          </div>
        </div>
      )}
    </>
  );
};

export default ProductImagePreview;
