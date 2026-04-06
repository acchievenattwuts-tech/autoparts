"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X, Search } from "lucide-react";

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
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = selectedProduct ?? products.find((p) => p.id === value) ?? null;

  const trimmedQuery = query.trim();
  const isQueryReady = trimmedQuery.length >= MIN_QUERY_LENGTH;
  const localResults = isQueryReady
    ? products
        .filter((p) => {
          const q = trimmedQuery.toLowerCase();
          return (
            p.code.toLowerCase().includes(q) ||
            p.name.toLowerCase().includes(q) ||
            (p.description?.toLowerCase().includes(q) ?? false) ||
            (p.brandName?.toLowerCase().includes(q) ?? false) ||
            p.categoryName.toLowerCase().includes(q) ||
            (p.aliases?.some((a) => a.toLowerCase().includes(q)) ?? false)
          );
        })
        .slice(0, MAX_RESULTS)
    : [];
  const filtered = searchProducts ? remoteResults : localResults;

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

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
    setQuery("");
    setOpen(false);
  };

  // Close on outside click (must check both trigger and portal dropdown)
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (
        !containerRef.current?.contains(e.target as Node) &&
        !dropdownRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  // Close on scroll or resize (dropdown is fixed, would drift otherwise)
  useEffect(() => {
    if (!open) return;
    const close = () => { setOpen(false); setQuery(""); };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const dropdown = open ? (
    <div
      ref={dropdownRef}
      style={{ top: coords.top, left: coords.left, width: coords.width }}
      className="fixed z-[9999] bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden"
    >
      <div className="max-h-56 overflow-y-auto overscroll-contain">
        {!isQueryReady ? (
          <p className="px-4 py-3 text-sm text-gray-400 text-center">
            พิมพ์อย่างน้อย {MIN_QUERY_LENGTH} ตัวอักษรเพื่อค้นหา
          </p>
        ) : isLoading ? (
          <p className="px-4 py-3 text-sm text-gray-400 text-center">เธเธณเธฅเธฑเธเธเนเธเธซเธฒ...</p>
        ) : filtered.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-400 text-center">ไม่พบสินค้า</p>
        ) : (
          filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(p)}
              className={`w-full text-left px-3 py-2.5 text-sm transition-colors hover:bg-blue-50 ${
                p.id === value ? "bg-blue-50 text-[#1e3a5f]" : "text-gray-800"
              }`}
            >
              <span className="font-mono text-xs text-gray-400">[{p.code}]</span>{" "}
              <span className="font-medium">{p.name}</span>
              {(p.categoryName || p.brandName) && (
                <span className="block text-xs text-gray-400 mt-0.5 ml-0.5">
                  {p.categoryName}
                  {p.brandName ? ` · ${p.brandName}` : ""}
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
        className={`flex items-center w-full px-3 py-2 border rounded-lg text-sm cursor-pointer select-none transition-colors ${
          open
            ? "border-[#1e3a5f] ring-2 ring-[#1e3a5f]/20 bg-white"
            : "border-gray-300 hover:border-gray-400 bg-white"
        } ${disabled ? "opacity-70 cursor-not-allowed" : ""}`}
      >
        {open ? (
          <>
            <Search size={13} className="text-gray-400 mr-1.5 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setOpen(false);
                  setQuery("");
                }
              }}
              placeholder={
                selected ? `[${selected.code}] ${selected.name}` : "พิมพ์เพื่อค้นหา..."
              }
              className="flex-1 outline-none bg-transparent placeholder-gray-400 min-w-0"
            />
          </>
        ) : (
          <span className={`flex-1 truncate ${selected ? "text-gray-800" : "text-gray-400"}`}>
            {selected ? `[${selected.code}] ${selected.name}` : placeholder}
          </span>
        )}
        <div className="flex items-center gap-0.5 ml-2 shrink-0">
          {value && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              className="text-gray-300 hover:text-gray-500 p-0.5 rounded transition-colors"
            >
              <X size={12} />
            </button>
          )}
          <ChevronDown
            size={14}
            className={`text-gray-400 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          />
        </div>
      </div>

      {typeof window !== "undefined" && dropdown && createPortal(dropdown, document.body)}
    </div>
  );
};

export default ProductSearchSelect;
