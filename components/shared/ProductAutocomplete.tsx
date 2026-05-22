"use client";

/**
 * Phase Q1 — Product autocomplete dropdown.
 *
 * Usage:
 *   <ProductAutocomplete
 *     initialValue=""
 *     placeholder="ค้นหาสินค้า..."
 *     mode="storefront"            // or "admin"
 *     onSubmit={(q) => router.push(...)}   // when user presses Enter without selecting
 *   />
 */

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Search, Loader2 } from "lucide-react";

interface AutocompleteItem {
  id: string;
  code: string;
  name: string;
  imageUrl: string | null;
  salePrice: number;
  inStock: boolean;
  reportUnitName: string;
  brand: string | null;
  category: string;
  href: string;
  adminHref: string;
}

interface Props {
  initialValue?: string;
  placeholder?: string;
  mode: "storefront" | "admin";
  /** Optional name for hidden input (when embedded in a GET form). */
  inputName?: string;
  /** Called when user presses Enter without selecting a suggestion. */
  onSubmit?: (q: string) => void;
  /** Optional className for the outer wrapper. */
  className?: string;
  /** Optional className for the input element. */
  inputClassName?: string;
  /** Whether to autofocus the input on mount. */
  autoFocus?: boolean;
  /** Show an orange submit button on the right side of the input. */
  showSubmitButton?: boolean;
}

const DEBOUNCE_MS = 200;
const MIN_QUERY_LEN = 2;

const inputBase =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] " +
  "dark:border-white/10 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:ring-sky-500";

const ProductAutocomplete = ({
  initialValue = "",
  placeholder = "ค้นหาสินค้า...",
  mode,
  inputName,
  onSubmit,
  className,
  inputClassName,
  autoFocus,
  showSubmitButton,
}: Props) => {
  const router = useRouter();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(initialValue);
  const [items, setItems] = useState<AutocompleteItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  // Debounced fetch
  useEffect(() => {
    if (value.trim().length < MIN_QUERY_LEN) {
      setItems([]);
      setOpen(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/search/products/autocomplete?q=${encodeURIComponent(value.trim())}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as { items: AutocompleteItem[] };
        setItems(data.items ?? []);
        setOpen(true);
        setActiveIndex(-1);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setItems([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [value]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const navigateTo = (item: AutocompleteItem) => {
    setOpen(false);
    router.push(mode === "admin" ? item.adminHref : item.href);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (items.length > 0) {
        setOpen(true);
        setActiveIndex((idx) => (idx + 1) % items.length);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length > 0) {
        setOpen(true);
        setActiveIndex((idx) => (idx <= 0 ? items.length - 1 : idx - 1));
      }
    } else if (e.key === "Enter") {
      if (open && activeIndex >= 0 && items[activeIndex]) {
        e.preventDefault();
        navigateTo(items[activeIndex]);
      } else if (onSubmit) {
        e.preventDefault();
        setOpen(false);
        onSubmit(value.trim());
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div ref={wrapperRef} className={`relative ${className ?? ""}`}>
      <div className="relative">
        {!showSubmitButton && (
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500"
          />
        )}
        <input
          ref={inputRef}
          id={id}
          type="text"
          name={inputName}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => {
            if (items.length > 0) setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          autoFocus={autoFocus}
          className={`${showSubmitButton ? "px-4 pr-12" : "pl-9 pr-10"} ${inputBase} ${inputClassName ?? ""}`}
          aria-autocomplete="list"
          aria-controls={`${id}-listbox`}
          aria-expanded={open}
          role="combobox"
        />
        {loading && !showSubmitButton && (
          <Loader2
            size={14}
            className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-400 dark:text-slate-500"
          />
        )}
        {showSubmitButton && (
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onSubmit?.(value.trim());
            }}
            className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-[#f97316] text-white transition-colors hover:bg-[#ea6c0a] active:scale-95"
            aria-label="ค้นหา"
          >
            {loading ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Search size={13} />
            )}
          </button>
        )}
      </div>

      {open && items.length > 0 && (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          className="absolute z-50 mt-1 max-h-96 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-white/10 dark:bg-slate-900"
        >
          {items.map((item, idx) => (
            <li key={item.id} role="option" aria-selected={idx === activeIndex}>
              <button
                type="button"
                onClick={() => navigateTo(item)}
                onMouseEnter={() => setActiveIndex(idx)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                  idx === activeIndex
                    ? "bg-gray-100 dark:bg-white/5"
                    : "hover:bg-gray-50 dark:hover:bg-white/5"
                }`}
              >
                <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-md bg-gray-100 dark:bg-slate-800">
                  {item.imageUrl ? (
                    <Image
                      src={item.imageUrl}
                      alt={item.name}
                      fill
                      className="object-cover"
                      sizes="40px"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-base opacity-30">
                      📦
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-gray-500 dark:text-slate-400">
                      {item.code}
                    </span>
                    {!item.inStock && (
                      <span className="rounded bg-red-50 px-1.5 py-0 text-[10px] text-red-600 dark:bg-red-500/10 dark:text-red-300">
                        ของหมด
                      </span>
                    )}
                  </div>
                  <p className="truncate text-sm font-medium text-gray-800 dark:text-slate-100">
                    {item.name}
                  </p>
                  <p className="truncate text-xs text-gray-500 dark:text-slate-400">
                    {item.category}
                    {item.brand ? ` · ${item.brand}` : ""}
                  </p>
                </div>
                <div className="flex-shrink-0 text-right">
                  <p className="text-sm font-bold text-[#f97316]">
                    ฿{item.salePrice.toLocaleString("th-TH")}
                  </p>
                  <p className="text-[10px] text-gray-400 dark:text-slate-500">
                    /{item.reportUnitName}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ProductAutocomplete;
