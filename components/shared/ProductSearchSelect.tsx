"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { createPortal } from "react-dom";

import { useOptionalAdminTheme } from "@/components/shared/AdminThemeProvider";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import {
  filterProductSearchOptions,
  getProductSearchOptionState,
} from "@/lib/product-search-select-presentation";
import {
  getLoadedTransactionProductCatalog,
  loadTransactionProductCatalog,
} from "@/lib/transaction-product-catalog-client";
import type { TransactionProductCatalogItem } from "@/lib/transaction-product-search";

export interface SearchableProduct {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  categoryName: string;
  brandName?: string | null;
  aliases?: string[];
  isActive?: boolean;
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
const FOLLOW_UP_SEARCH_DEBOUNCE_MS = 100;

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
  const [coords, setCoords] = useState({
    top: 0, bottom: 0, left: 0, width: 0, maxHeight: 224, openUp: false,
  });
  const [remoteResults, setRemoteResults] = useState<T[]>([]);
  const [catalogProducts, setCatalogProducts] = useState<TransactionProductCatalogItem[] | null>(
    getLoadedTransactionProductCatalog,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const adminTheme = useOptionalAdminTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasStartedRemoteSearchRef = useRef(false);
  const listboxId = useId();

  const isDark = adminTheme?.isDark ?? false;
  const selected = selectedProduct ?? products.find((product) => product.id === value) ?? null;

  const trimmedQuery = query.trim();
  const isQueryReady = trimmedQuery.length >= MIN_QUERY_LENGTH;
  const localResults: SearchableProduct[] = isQueryReady
    ? searchProducts && catalogProducts
      ? filterProductSearchOptions(catalogProducts, trimmedQuery, MAX_RESULTS)
      : filterProductSearchOptions(products, trimmedQuery, MAX_RESULTS)
    : [];
  const filtered = searchProducts
    ? catalogProducts && (isLoading || searchError)
      ? localResults
      : remoteResults
    : localResults;

  useEffect(() => {
    if (!searchProducts || catalogProducts) return;
    let active = true;
    void loadTransactionProductCatalog()
      .then((nextCatalog) => {
        if (active) setCatalogProducts(nextCatalog);
      })
      .catch(() => {
        // Remote search remains the correctness-preserving fallback.
      });
    return () => {
      active = false;
    };
  }, [catalogProducts, searchProducts]);

  useEffect(() => {
    if (!open || !searchProducts) {
      setIsLoading(false);
      return;
    }

    if (!isQueryReady) {
      setRemoteResults([]);
      setIsLoading(false);
      setSearchError(false);
      return;
    }

    let isActive = true;
    setIsLoading(true);
    setSearchError(false);
    setRemoteResults([]);
    const delayMs = hasStartedRemoteSearchRef.current ? FOLLOW_UP_SEARCH_DEBOUNCE_MS : 0;
    hasStartedRemoteSearchRef.current = true;
    const timeoutId = window.setTimeout(async () => {
      try {
        const results = await searchProducts(trimmedQuery);
        if (!isActive) return;
        setRemoteResults(results.slice(0, MAX_RESULTS));
      } catch {
        if (!isActive) return;
        setRemoteResults([]);
        setSearchError(true);
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }, delayMs);

    return () => {
      isActive = false;
      window.clearTimeout(timeoutId);
    };
  }, [open, isQueryReady, searchProducts, trimmedQuery]);

  const updateCoords = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const MARGIN = 8;
    const MIN_HEIGHT = 160;
    const PREFERRED_HEIGHT = 400;
    const spaceBelow = window.innerHeight - rect.bottom - MARGIN;
    const spaceAbove = rect.top - MARGIN;
    const openUp = spaceBelow < MIN_HEIGHT && spaceAbove > spaceBelow;
    const available = openUp ? spaceAbove : spaceBelow;
    const maxHeight = Math.min(Math.max(available - MARGIN, MIN_HEIGHT), PREFERRED_HEIGHT);
    const w = Math.max(rect.width, 256);
    if (openUp) {
      setCoords({ top: 0, bottom: window.innerHeight - rect.top + 4, left: rect.left, width: w, maxHeight, openUp: true });
    } else {
      setCoords({ top: rect.bottom + 4, bottom: 0, left: rect.left, width: w, maxHeight, openUp: false });
    }
  };

  const handleOpen = () => {
    if (!disabled) {
      updateCoords();
      setOpen(true);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const handleSelect = (product: SearchableProduct) => {
    if (product.isActive === false) return;
    const hydratedProduct = searchProducts
      ? remoteResults.find((candidate) => candidate.id === product.id)
        ?? products.find((candidate) => candidate.id === product.id)
      : product as T;
    if (!hydratedProduct) return;
    onChange(hydratedProduct.id);
    onProductSelect?.(hydratedProduct);
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
    const close = (event: Event) => {
      if (event.target instanceof Node && dropdownRef.current?.contains(event.target)) return;
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

  const hasHydratedProduct = (productId: string): boolean =>
    !searchProducts
    || remoteResults.some((candidate) => candidate.id === productId)
    || products.some((candidate) => candidate.id === productId);

  const dropdown = open ? (
    <div
      id={listboxId}
      role="listbox"
      ref={dropdownRef}
      style={coords.openUp
        ? { bottom: coords.bottom, left: coords.left, width: coords.width }
        : { top: coords.top, left: coords.left, width: coords.width }}
      className={dropdownClassName}
    >
      <div style={{ maxHeight: coords.maxHeight }} className="overflow-y-auto overscroll-contain">
        {!isQueryReady ? (
          <p className={dropdownMessageClassName}>
            พิมพ์อย่างน้อย {MIN_QUERY_LENGTH} ตัวอักษรเพื่อค้นหา
          </p>
        ) : isLoading && filtered.length === 0 ? (
          <p className={dropdownMessageClassName}>กำลังโหลด...</p>
        ) : filtered.length === 0 ? (
          <p className={dropdownMessageClassName}>
            {searchError ? "ค้นหาสินค้าไม่สำเร็จ กรุณาลองอีกครั้ง" : "ไม่พบสินค้า"}
          </p>
        ) : (
          filtered.map((product) => {
            const selectedOption = product.id === value;
            const optionState = getProductSearchOptionState(product, selectedOption);
            const hydrated = hasHydratedProduct(product.id);
            const optionDisabled = optionState.disabled || !hydrated;
            return (
              <button
                key={product.id}
                type="button"
                disabled={optionDisabled}
                aria-disabled={optionDisabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => handleSelect(product)}
                className={`w-full px-3 py-2.5 text-left text-sm transition-colors disabled:pointer-events-auto ${
                  selectedOption ? selectedOptionClassName : defaultOptionClassName
                } ${optionState.rowClassName}`}
              >
                <span className="flex min-w-0 items-start justify-between gap-2">
                  <span className={`min-w-0 ${optionState.primaryTextClassName}`}>
                    <span
                      className={`font-mono text-xs ${
                        optionState.codeTextClassName || (isDark ? "text-slate-400" : "text-gray-400")
                      }`}
                    >
                      [{product.code}]
                    </span>{" "}
                    <span className="font-medium">{product.name}</span>
                  </span>
                  <AdminStatusBadge tone={optionState.badgeTone} className="shrink-0 px-2 py-0 text-[11px] leading-4">
                    {optionState.badgeLabel}
                  </AdminStatusBadge>
                </span>
                {(product.categoryName || product.brandName) && (
                  <span
                    className={`mt-0.5 ml-0.5 block text-xs ${
                      optionState.secondaryTextClassName || (isDark ? "text-slate-400" : "text-gray-400")
                    }`}
                  >
                    {product.categoryName}
                    {product.brandName ? ` · ${product.brandName}` : ""}
                  </span>
                )}
                {!hydrated && (
                  <span className={`mt-0.5 block text-xs ${isDark ? "text-sky-300" : "text-blue-600"}`}>
                    {searchError ? "โหลดรายละเอียดไม่สำเร็จ กรุณาพิมพ์ค้นหาอีกครั้ง" : "กำลังเตรียมราคาและหน่วยสินค้า..."}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  ) : null;

  return (
    <div ref={containerRef} className="relative">
      <div
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
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

      {typeof window !== "undefined" &&
        dropdown &&
        createPortal(
          // The dropdown is portaled to <body>, outside the AdminShell `.dark`
          // container, so `dark:` variants (used by the option presentation
          // helper) would not activate. Re-establish the `.dark` scope here.
          <div className={isDark ? "dark" : undefined}>{dropdown}</div>,
          document.body,
        )}
    </div>
  );
};

export default ProductSearchSelect;
