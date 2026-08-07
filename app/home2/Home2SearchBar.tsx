"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import ProductAutocomplete from "@/components/shared/ProductAutocomplete";

/**
 * Shopee-style search field for the home2 header.
 *
 * Reuses the shared <ProductAutocomplete/> (real product + keyword suggestions
 * from the live catalogue) but supplies its own blue submit button instead of
 * the component's built-in orange one, so the header stays on the blue theme.
 */

const SEARCH_PLACEHOLDER = "ค้นหาสินค้า ยี่ห้อรถ รุ่นรถ หรือรหัสอะไหล่...";

const SearchField = ({ variant }: { variant: "mobile" | "desktop" }) => {
  const router = useRouter();
  const [value, setValue] = useState("");

  const submit = (query: string) => {
    // Link straight at /products — /products/search only 307s here anyway.
    const trimmed = query.trim();
    router.push(trimmed ? `/products?q=${encodeURIComponent(trimmed)}` : "/products");
  };

  return (
    <div
      className={
        variant === "desktop"
          ? "hidden min-w-0 flex-1 items-center gap-2 lg:flex"
          : "flex min-w-0 flex-1 items-center gap-2 lg:hidden"
      }
    >
      <ProductAutocomplete
        mode="storefront"
        placeholder={SEARCH_PLACEHOLDER}
        onSubmit={submit}
        onValueChange={setValue}
        enhanced={variant}
        className="w-full"
      />

      <button
        type="button"
        onClick={() => submit(value)}
        aria-label="ค้นหาสินค้า"
        className="flex h-9 w-11 shrink-0 items-center justify-center rounded-lg bg-[#2563eb] text-white transition-colors hover:bg-[#1d4ed8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        <Search className="h-4 w-4" />
      </button>
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
