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
 *
 * Enhanced storefront variants:
 *   enhanced="desktop" → expand-on-focus + backdrop + brand-grouped rich dropdown
 *   enhanced="mobile"  → tap-to-open full-screen slide-in modal
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Search, Loader2, ArrowLeft, ArrowRight, X } from "lucide-react";

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
  /** Storefront enhanced UX. */
  enhanced?: "desktop" | "mobile";
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
  enhanced,
}: Props) => {
  const router = useRouter();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const modalInputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(initialValue);
  const [items, setItems] = useState<AutocompleteItem[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
        const data = (await res.json()) as { items: AutocompleteItem[]; totalCount?: number };
        setItems(data.items ?? []);
        setTotalCount(data.totalCount ?? null);
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

  // Close on outside click (skip when modal is open — modal has its own handlers)
  useEffect(() => {
    if (modalOpen) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [modalOpen]);

  // Lock body scroll when mobile modal is open
  useEffect(() => {
    if (!modalOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [modalOpen]);

  // Auto-focus modal input + close modal on Escape
  useEffect(() => {
    if (!modalOpen) return;
    modalInputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModalOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  // Group items by brand (used by all variants)
  const groups = useMemo(() => {
    const map = new Map<string, AutocompleteItem[]>();
    items.forEach((it) => {
      const key = it.brand || "อื่นๆ";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    });
    return Array.from(map.entries());
  }, [items]);

  const navigateTo = (item: AutocompleteItem) => {
    setOpen(false);
    setModalOpen(false);
    router.push(mode === "admin" ? item.adminHref : item.href);
  };

  const submitQuery = () => {
    setOpen(false);
    setModalOpen(false);
    onSubmit?.(value.trim());
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
        submitQuery();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  // --- Rich dropdown body (used by both desktop dropdown + mobile modal) ---
  const renderGroupedResults = () => {
    if (!groups || groups.length === 0) return null;
    let runningIndex = -1;
    return (
      <>
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2 text-xs text-gray-500 dark:border-white/10 dark:text-slate-400">
          <span className="font-medium">
            ผลการค้นหา &ldquo;{value.trim()}&rdquo;
          </span>
          <span>
            {totalCount !== null && totalCount > items.length
              ? `แสดง ${items.length} จาก ${totalCount} รายการ`
              : `${items.length} รายการ`}
          </span>
        </div>
        <ul id={`${id}-listbox`} role="listbox" className="py-1">
          {groups.map(([brand, brandItems]) => (
            <li key={brand}>
              <div className="sticky top-0 border-l-2 border-orange-500 bg-white pl-3 pr-4 py-2 text-[15px] font-bold text-gray-800 dark:bg-slate-900 dark:text-slate-100">
                {brand}
              </div>
              <ul>
                {brandItems.map((item) => {
                  runningIndex += 1;
                  const idx = runningIndex;
                  return (
                    <li key={item.id} role="option" aria-selected={idx === activeIndex}>
                      <button
                        type="button"
                        onClick={() => navigateTo(item)}
                        onMouseEnter={() => setActiveIndex(idx)}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          idx === activeIndex
                            ? "bg-orange-50 dark:bg-orange-500/10"
                            : "hover:bg-gray-50 dark:hover:bg-white/5"
                        }`}
                      >
                        <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-md bg-gray-100 dark:bg-slate-800">
                          {item.imageUrl ? (
                            <Image
                              src={item.imageUrl}
                              alt={item.name}
                              fill
                              className="object-cover"
                              sizes="56px"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-xl opacity-30">
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
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
        {onSubmit && value.trim().length >= MIN_QUERY_LEN && (
          <button
            type="button"
            onClick={submitQuery}
            className="flex w-full items-center justify-center gap-2 border-t border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium text-[#1e3a5f] transition-colors hover:bg-gray-100 dark:border-white/10 dark:bg-slate-800/50 dark:text-sky-300 dark:hover:bg-slate-800"
          >
            ดูผลการค้นหาทั้งหมด {totalCount ?? items.length} รายการ
            <ArrowRight size={14} />
          </button>
        )}
      </>
    );
  };

  // --- MOBILE MODAL VARIANT ---
  if (enhanced === "mobile") {
    return (
      <>
        <div ref={wrapperRef} className={`relative ${className ?? ""}`}>
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500"
            />
            {/* Read-only trigger — tapping opens modal */}
            <input
              type="text"
              readOnly
              value={value}
              placeholder={placeholder}
              onClick={() => setModalOpen(true)}
              onFocus={(e) => {
                e.target.blur();
                setModalOpen(true);
              }}
              className={`pl-9 pr-3 ${inputBase} ${inputClassName ?? ""} cursor-pointer`}
              aria-label="เปิดช่องค้นหา"
            />
          </div>
        </div>

        {mounted && modalOpen &&
          createPortal(
            <div
              className="fixed inset-0 z-[100] flex animate-in slide-in-from-right duration-200 flex-col bg-white dark:bg-slate-950"
              role="dialog"
              aria-modal="true"
            >
              {/* Header */}
              <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-3 py-3 dark:border-white/10 dark:bg-slate-950">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-white/10"
                  aria-label="ปิด"
                >
                  <ArrowLeft size={20} />
                </button>
                <div className="relative flex-1">
                  <Search
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500"
                  />
                  <input
                    ref={modalInputRef}
                    type="text"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    autoComplete="off"
                    className={`${inputBase} pl-9 pr-9`}
                  />
                  {value && (
                    <button
                      type="button"
                      onClick={() => setValue("")}
                      className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/10"
                      aria-label="ล้างคำค้น"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto">
                {loading && (
                  <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-500 dark:text-slate-400">
                    <Loader2 size={16} className="animate-spin" />
                    กำลังค้นหา...
                  </div>
                )}
                {!loading && value.trim().length < MIN_QUERY_LEN && (
                  <div className="px-4 py-8 text-center text-sm text-gray-400 dark:text-slate-500">
                    พิมพ์อย่างน้อย {MIN_QUERY_LEN} ตัวอักษรเพื่อค้นหา
                  </div>
                )}
                {!loading && value.trim().length >= MIN_QUERY_LEN && items.length === 0 && (
                  <div className="px-4 py-8 text-center text-sm text-gray-400 dark:text-slate-500">
                    ไม่พบสินค้าที่ตรงกับ &ldquo;{value.trim()}&rdquo;
                  </div>
                )}
                {!loading && items.length > 0 && renderGroupedResults()}
              </div>
            </div>,
            document.body,
          )}
      </>
    );
  }

  // --- DESKTOP ENHANCED VARIANT ---
  if (enhanced === "desktop") {
    const isExpanded = open || value.trim().length >= MIN_QUERY_LEN;
    return (
      <>
        <div
          ref={wrapperRef}
          className={`relative z-50 transition-[max-width] duration-300 ease-out ${
            isExpanded ? "max-w-2xl" : "max-w-sm"
          } ${className ?? ""}`}
        >
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
                setOpen(true);
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
                onClick={submitQuery}
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

          {open && (
            <div className="absolute left-0 right-0 z-50 mt-2 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-900">
              {loading && items.length === 0 && (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-gray-500 dark:text-slate-400">
                  <Loader2 size={16} className="animate-spin" />
                  กำลังค้นหา...
                </div>
              )}
              {!loading && value.trim().length >= MIN_QUERY_LEN && items.length === 0 && (
                <div className="px-4 py-6 text-center text-sm text-gray-400 dark:text-slate-500">
                  ไม่พบสินค้าที่ตรงกับ &ldquo;{value.trim()}&rdquo;
                </div>
              )}
              {items.length > 0 && (
                <div className="max-h-[70vh] overflow-y-auto">
                  {renderGroupedResults()}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Backdrop */}
        {mounted && open &&
          createPortal(
            <div
              className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px] transition-opacity duration-200 animate-in fade-in"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />,
            document.body,
          )}
      </>
    );
  }

  // --- ORIGINAL VARIANT (admin / non-enhanced) ---
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
            onClick={submitQuery}
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
        <div
          id={`${id}-listbox`}
          role="listbox"
          className="absolute z-50 mt-1 max-h-96 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-white/10 dark:bg-slate-900"
        >
          {(() => {
            let flatIdx = -1;
            return groups.map(([brand, brandItems]) => (
              <ul key={brand} role="group">
                <li
                  role="presentation"
                  className="sticky top-0 border-l-2 border-orange-500 bg-white pl-3 pr-3 py-2 text-[15px] font-bold text-gray-800 dark:bg-slate-900 dark:text-slate-100"
                >
                  {brand}
                </li>
                {brandItems.map((item) => {
                  flatIdx += 1;
                  const idx = flatIdx;
                  return (
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
                  );
                })}
              </ul>
            ));
          })()}
        </div>
      )}
    </div>
  );
};

export default ProductAutocomplete;
