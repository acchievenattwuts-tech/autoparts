"use client";

import { useRouter } from "next/navigation";
import ProductAutocomplete from "@/components/shared/ProductAutocomplete";

/**
 * Shopee-style search field for the home2 header.
 *
 * Reuses the shared <ProductAutocomplete/> (real product + keyword suggestions
 * from the live catalogue). Like shopee.co.th the field stretches across the
 * whole header row and the submit button sits inside the box; it is restyled
 * blue via submitButtonClassName so the header stays on the blue theme.
 */

/** Blue submit button pinned inside the field — Shopee's in-box search key. */
const SUBMIT_BUTTON_CLASS =
  "absolute right-1 top-1/2 flex h-8 w-12 -translate-y-1/2 items-center justify-center rounded-md bg-[#2563eb] text-white transition-colors hover:bg-[#1d4ed8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70";

const SEARCH_PLACEHOLDER = "ค้นหาสินค้า ยี่ห้อรถ รุ่นรถ หรือรหัสอะไหล่...";

const SearchField = ({ variant }: { variant: "mobile" | "desktop" }) => {
  const router = useRouter();

  const submit = (query: string) => {
    // Link straight at /products — /products/search only 307s here anyway.
    const trimmed = query.trim();
    router.push(trimmed ? `/products?q=${encodeURIComponent(trimmed)}` : "/products");
  };

  return (
    <div
      className={
        variant === "desktop"
          ? "hidden min-w-0 flex-1 items-center lg:flex"
          : "flex min-w-0 flex-1 items-center lg:hidden"
      }
    >
      <ProductAutocomplete
        mode="storefront"
        placeholder={SEARCH_PLACEHOLDER}
        onSubmit={submit}
        enhanced={variant}
        fullWidth
        showSubmitButton
        submitButtonClassName={SUBMIT_BUTTON_CLASS}
        className="w-full"
      />
    </div>
  );
};

const Home2SearchBar = () => (
  <>
    <SearchField variant="mobile" />
    <SearchField variant="desktop" />
  </>
);

export default Home2SearchBar;
