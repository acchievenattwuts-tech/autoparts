"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useTransition } from "react";

import {
  PARCEL_LABEL_SIZE_OPTIONS,
  PARCEL_LABEL_SIZE_PARAM,
  type ParcelLabelSize,
} from "@/app/admin/_components/print/parcel-label";
import { rememberParcelLabelSize } from "@/app/admin/_components/print/parcel-label-preference";

/**
 * สวิตช์ A5 / A4 บนหน้าพิมพ์ — เป็นการ "นำทาง" ไม่ใช่ toggle ในหน้า
 *
 * `@page { size: ... }` สลับด้วย JavaScript หลังเรนเดอร์ไม่ได้ ขนาดกระดาษจึงต้อง
 * ถูกเรนเดอร์มาจากเซิร์ฟเวอร์ตั้งแต่แรก การกดปุ่มนี้จึงโหลดหน้าใหม่พร้อม `size`
 * ตัวใหม่ และตัด `print` ออกเพื่อไม่ให้กล่องพิมพ์เด้งซ้ำระหว่างเทียบขนาด
 */
const ParcelLabelSizeSwitchInner = ({ value }: { value: ParcelLabelSize }) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const goToSize = (size: ParcelLabelSize) => {
    if (size === value) return;

    rememberParcelLabelSize(size);

    const params = new URLSearchParams(searchParams.toString());
    params.set(PARCEL_LABEL_SIZE_PARAM, size);
    params.delete("print");

    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  };

  return (
    <div
      role="group"
      aria-label="ขนาดกระดาษ"
      className={`no-print inline-flex items-center gap-0.5 rounded-lg border border-gray-300 p-0.5 ${
        isPending ? "opacity-60" : ""
      }`}
    >
      {PARCEL_LABEL_SIZE_OPTIONS.map((option) => {
        const isActive = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            disabled={isPending}
            onClick={() => goToSize(option.value)}
            className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              isActive
                ? "bg-[#1e3a5f] text-white"
                : "text-gray-600 hover:bg-gray-100 hover:text-[#1e3a5f]"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
};

const ParcelLabelSizeSwitch = ({ value }: { value: ParcelLabelSize }) => (
  <Suspense fallback={null}>
    <ParcelLabelSizeSwitchInner value={value} />
  </Suspense>
);

export default ParcelLabelSizeSwitch;
