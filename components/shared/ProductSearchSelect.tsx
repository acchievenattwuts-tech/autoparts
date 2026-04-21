"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { createPortal } from "react-dom";

import { useOptionalAdminTheme } from "@/components/shared/AdminThemeProvider";

export interface SearchableProduct {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  categoryName: string;
  brandName?: string | null;
  aliases?: string[];
}

interface Props<T extends SearchableProduct> {
  products: T[];
  value: string;
  onChange: (id: string) => void;
  onProductSelect?: (product: T) => void;
  searchProducts?: (query: string) => Promise<T[]>;
  selectedProduct?: T | null;
  placeholder?: string;
  disabled?: boolean;
}

const MAX_RESULTS = 50;
const MIN_QUERY_LENGTH = 3;
const SEARCH_DEBOUNCE_MS = 200;

const ProductSearchSelect = <T extends SearchableProduct,>({
  products,
  value,
  onChange,
  onProductSelect,
  searchProducts,
  selectedProduct,
  placeholder = "-- ค้นหาสินค้า --",
  disabled = false,
}: Props<T>) => {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });
  const [remoteResults, setRemoteResults] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const adminTheme = useOptionalAdminTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isDark = adminTheme?.isDark ?? false;
  const selected = selectedProduct ?? products.find((product) => product.id === value) ?? null;

  const trimmedQuery = query.trim();
  const isQueryReady = trimmedQuery.length >= MIN_QUERY_LENGTH;
  const localResults = isQueryReady
    ? products
        .filter((product) => {
          const normalizedQuery = trimmedQuery.toLowerCase();
          return (
            product.code.toLowerCase().includes(normalizedQuery) ||
            product.name.toLowerCase().includes(normalizedQuery) ||
            (product.description?.toLowerCase().includes(normalizedQuery) ?? false) ||
            (product.brandName?.toLowerCase().includes(normalizedQuery) ?? false) ||
            product.categoryName.toLowerCase().includes(normalizedQuery) ||
            (product.aliases?.some((alias) => alias.toLowerCase().includes(normalizedQuery)) ?? false)
          );
        })
        .slice(0, MAX_RESULTS)
    : [];
  const filtered = searchProducts
    ? isLoading && localResults.length > 0
      ? localResults
      : remoteResults
    : localResults;

  useEffect(() => {
    if (!open || !searchProducts) {
      setIsLoading(false);
      return;
    }

    if (!isQueryReady) {
      setRemoteResults([]);
      setIsLoading(false);
      return;
    }

    let isActive = true;
    setIsLoading(true);
    const timeoutId = window.setTimeout(async () => {
      try {
        const results = await searchProducts(trimmedQuery);
        if (!isActive) return;
        setRemoteResults(results.slice(0, MAX_RESULTS));
      } catch {
        if (!isActive) return;
        setRemoteResults([]);
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      isActive = false;
      window.clearTimeout(timeoutId);
    };
  }, [open, isQueryReady, searchProducts, trimmedQuery]);

  const updateCoords = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      setCoords({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 256) });
    }
  };

  const handleOpen = () => {
    if (!disabled) {
      updateCoords();
      setOpen(true);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const handleSelect = (product: T) => {
    onChange(product.id);
    onProductSelect?.(product);
    setQuery("");
    setOpen(false);
  };

  const handleClear = (event: React.MouseEvent) => {
    event.stopPropagation();
    onChange("");
    setQuery("");
    setOpen(false);
  };

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (
        !containerRef.current?.contains(event.target as Node) &&
        !dropdownRef.current?.contains(event.target as Node)
      ) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      setQuery("");
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const dropdownClassName = isDark
    ? "fixed z-[9999] overflow-hidden rounded-xl border border-slate-700/80 bg-slate-950/95 shadow-2xl backdrop-blur"
    : "fixed z-[9999] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl";
  const dropdownMessageClassName = isDark
    ? "px-4 py-3 text-center text-sm text-slate-400"
    : "px-4 py-3 text-center text-sm text-gray-400";
  const selectedOptionClassName = isDark
    ? "bg-sky-500/15 text-sky-200 hover:bg-sky-500/20"
    : "bg-blue-50 text-[#1e3a5f]";
  const defaultOptionClassName = isDark
    ? "text-slate-200 hover:bg-slate-900"
    : "text-gray-800 hover:bg-blue-50";
  const triggerClassName = isDark
    ? open
      ? "border-sky-400/70 bg-slate-950 text-slate-100 ring-2 ring-sky-400/20"
      : "border-slate-700 bg-slate-950 text-slate-100 hover:border-slate-600"
    : open
      ? "border-[#1e3a5f] ring-2 ring-[#1e3a5f]/20 bg-white"
      : "border-gray-300 hover:border-gray-400 bg-white";

  const dropdown = open ? (
    <div
      ref={dropdownRef}
      style={{ top: coords.top, left: coords.left, width: coords.width }}
      className={dropdownClassName}
    >
      <div className="max-h-56 overflow-y-auto overscroll-contain">
        {!isQueryReady ? (
          <p className={dropdownMessageClassName}>
            พิมพ์อย่างน้อย {MIN_QUERY_LENGTH} ตัวอักษรเพื่อค้นหา
          </p>
        ) : isLoading && filtered.length === 0 ? (
          <p className={dropdownMessageClassName}>กำลังโหลด...</p>
        ) : filtered.length === 0 ? (
          <p className={dropdownMessageClassName}>ไม่พบสินค้า</p>
        ) : (
          filtered.map((product) => (
            <button
              key={product.id}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => handleSelect(product)}
              className={`w-full px-3 py-2.5 text-left text-sm transition-colors ${
                product.id === value ? selectedOptionClassName : defaultOptionClassName
              }`}
            >
              <span className={`font-mono text-xs ${isDark ? "text-slate-400" : "text-gray-400"}`}>
                [{product.code}]
              </span>{" "}
              <span className="font-medium">{product.name}</span>
              {(product.categoryName || product.brandName) && (
                <span className={`mt-0.5 ml-0.5 block text-xs ${isDark ? "text-slate-400" : "text-gray-400"}`}>
                  {product.categoryName}
                  {product.brandName ? ` · ${product.brandName}` : ""}
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  ) : null;

  return (
    <div ref={containerRef} className="relative">
      <div
        role="combobox"
        aria-expanded={open}
        onClick={handleOpen}
        className={`flex w-full cursor-pointer select-none items-center rounded-lg border px-3 py-2 text-sm transition-colors ${
          triggerClassName
        } ${disabled ? "cursor-not-allowed opacity-70" : ""}`}
      >
        {open ? (
          <>
            <Search size={13} className={`mr-1.5 shrink-0 ${isDark ? "text-slate-500" : "text-gray-400"}`} />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setOpen(false);
                  setQuery("");
                }
              }}
              placeholder={selected ? `[${selected.code}] ${selected.name}` : "พิมพ์เพื่อค้นหา..."}
              className={`min-w-0 flex-1 bg-transparent outline-none ${
                isDark ? "text-slate-100 placeholder:text-slate-500" : "placeholder-gray-400"
              }`}
            />
          </>
        ) : (
          <span
            className={`flex-1 truncate ${
              selected
                ? isDark
                  ? "text-slate-100"
                  : "text-gray-800"
                : isDark
                  ? "text-slate-400"
                  : "text-gray-400"
            }`}
          >
            {selected ? `[${selected.code}] ${selected.name}` : placeholder}
          </span>
        )}
        <div className="ml-2 flex shrink-0 items-center gap-0.5">
          {value && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              className={`rounded p-0.5 transition-colors ${
                isDark ? "text-slate-600 hover:text-slate-300" : "text-gray-300 hover:text-gray-500"
              }`}
            >
              <X size={12} />
            </button>
          )}
          <ChevronDown
            size={14}
            className={`transition-transform duration-150 ${
              open ? "rotate-180" : ""
            } ${isDark ? "text-slate-500" : "text-gray-400"}`}
          />
        </div>
      </div>

      {typeof window !== "undefined" && dropdown && createPortal(dropdown, document.body)}
    </div>
  );
};

export default ProductSearchSelect;
