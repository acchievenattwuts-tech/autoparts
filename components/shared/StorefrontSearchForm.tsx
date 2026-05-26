"use client";

/**
 * Phase Q1 — Storefront search bar wrapper around <ProductAutocomplete/>.
 * Keeps the existing visual style (rounded pill + orange action button) while
 * adding autocomplete dropdown below the input on focus/typing.
 */

import { useRouter } from "next/navigation";
import ProductAutocomplete from "@/components/shared/ProductAutocomplete";

interface Props {
  initialValue?: string;
  /** "mobile" = compact, full width, square-ish. "desktop" = pill style. */
  variant: "mobile" | "desktop";
}

const StorefrontSearchForm = ({ initialValue, variant }: Props) => {
  const router = useRouter();

  const submit = (q: string) => {
    if (!q) {
      router.push("/products");
      return;
    }
    router.push(`/products/search?q=${encodeURIComponent(q)}`);
  };

  // Match the original navbar input shape via wrapper className override
  const inputClass =
    variant === "desktop"
      ? "rounded-full border-2 border-gray-200 bg-white py-2 shadow-sm transition-colors hover:border-[#1e3a5f]/40 focus:border-[#1e3a5f] dark:border-white/10"
      : "rounded-xl border-2 border-gray-200 bg-white py-2 shadow-sm transition-colors focus:border-[#1e3a5f] dark:border-white/10";

  return (
    <div className={variant === "desktop" ? "hidden flex-1 md:flex md:justify-center" : "flex min-w-0 flex-1 md:hidden"}>
      <ProductAutocomplete
        initialValue={initialValue}
        placeholder="ค้นหาสินค้า ยี่ห้อรถ รุ่นรถ..."
        mode="storefront"
        onSubmit={submit}
        inputClassName={inputClass}
        showSubmitButton
        enhanced={variant === "desktop" ? "desktop" : "mobile"}
        className={variant === "desktop" ? "w-full" : undefined}
      />
    </div>
  );
};

export default StorefrontSearchForm;
