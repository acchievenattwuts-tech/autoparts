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

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Search, Loader2, ArrowLeft, ArrowRight, X, Store } from "lucide-react";
import { toProductImageCdnPath } from "@/lib/product-image-url";
import { HIDE_STOREFRONT_PRICE, STOREFRONT_PRICE_INQUIRY_LABEL } from "@/lib/storefront-pricing";

interface AutocompleteItem {
  id: string;
  code: string;
  name: string;
  imageUrl: string | null;
  salePrice: number;
  stock: number;
  inStock: boolean;
  saleUnitName: string | null;
  reportUnitName: string;
  brand: string | null;
  category: string;
  href: string;
  adminHref: string;
}

interface KeywordSuggestion {
  term: string;
  kind: string;
  sublabel: string | null;
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
  /** Admin-only return URL appended when selecting a suggestion. */
  adminReturnTo?: string;
}

const DEBOUNCE_MS = 300;
// Keyword lookup is a single indexed query (~40ms) so it can debounce much shorter
// than the product-card path for a snappier as-you-type feel.
const KEYWORD_DEBOUNCE_MS = 120;
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
  adminReturnTo,
}: Props) => {
  const router = useRouter();
  // ซ่อนราคาบนหน้าบ้านตามนโยบาย storefront — ฝั่งแอดมินยังเห็นราคาปกติ
  const showItemPrice = mode === "admin" || !HIDE_STOREFRONT_PRICE;
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const modalInputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Client-side cache of keyword results per query — makes backspacing / retyping a
  // previous prefix instant (no refetch, no flicker).
  const keywordCacheRef = useRef<Map<string, KeywordSuggestion[]>>(new Map());
  const [value, setValue] = useState(initialValue);
  const [items, setItems] = useState<AutocompleteItem[]>([]);
  const [keywordItems, setKeywordItems] = useState<KeywordSuggestion[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  // Storefront (enhanced) uses the keyword-first index: the dropdown shows search
  // terms, not product cards, and the heavy product search only fires on submit.
  const keywordMode = Boolean(enhanced);
  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [hasInlineFocus, setHasInlineFocus] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [mounted, setMounted] = useState(false);
  const [isNavigating, startNavigation] = useTransition();
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const getDisplayUnitName = (item: AutocompleteItem) =>
    item.saleUnitName || item.reportUnitName || "หน่วย";

  useEffect(() => {
    setValue(initialValue ?? "");
  }, [initialValue]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Debounced fetch
  useEffect(() => {
    const q = value.trim();
    if (q.length < MIN_QUERY_LEN) {
      setItems([]);
      setKeywordItems([]);
      setOpen(false);
      setLoading(false);
      return;
    }

    const shouldAutoOpen = modalOpen || hasInlineFocus;

    if (keywordMode) {
      // Open as soon as there is a query — the "search for this text" row is always
      // shown, independent of whether any suggestions come back.
      setOpen(shouldAutoOpen);

      // Instant path: serve from the client cache so typing/backspacing through
      // already-seen prefixes never refetches or flickers.
      const cached = keywordCacheRef.current.get(q);
      if (cached) {
        setKeywordItems(cached);
        setActiveIndex(-1);
        setLoading(false);
        return;
      }

      const controller = new AbortController();
      const timer = setTimeout(async () => {
        // Keep the previous suggestions visible while loading (no empty flash).
        setLoading(true);
        try {
          const res = await fetch(`/api/search/keywords?q=${encodeURIComponent(q)}`, {
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`status ${res.status}`);
          const data = (await res.json()) as { items: KeywordSuggestion[] };
          const next = data.items ?? [];
          keywordCacheRef.current.set(q, next);
          setKeywordItems(next);
          setActiveIndex(-1);
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
          // Keep previous suggestions on a transient error.
        } finally {
          setLoading(false);
        }
      }, KEYWORD_DEBOUNCE_MS);

      return () => {
        controller.abort();
        clearTimeout(timer);
      };
    }

    // Product (admin) mode — unchanged product-card lookup.
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/search/products/autocomplete?q=${encodeURIComponent(q)}&mode=${mode}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as { items: AutocompleteItem[]; totalCount?: number };
        setItems(data.items ?? []);
        setTotalCount(data.totalCount ?? null);
        setOpen(shouldAutoOpen);
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
  }, [value, modalOpen, hasInlineFocus, mode, keywordMode]);

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
    if (isNavigating) return;
    setPendingItemId(item.id);
    startNavigation(() => {
      const href =
        mode === "admin" && adminReturnTo
          ? `${item.adminHref}?returnTo=${encodeURIComponent(adminReturnTo)}`
          : mode === "admin"
            ? item.adminHref
            : item.href;
      router.push(href);
    });
  };

  // Close dropdown + clear pending after navigation completes
  useEffect(() => {
    if (!isNavigating && pendingItemId) {
      setPendingItemId(null);
      setOpen(false);
      setModalOpen(false);
    }
  }, [isNavigating, pendingItemId]);

  const submitQuery = (overrideQuery?: string) => {
    setOpen(false);
    setModalOpen(false);
    if (onSubmit) {
      onSubmit((overrideQuery ?? value).trim());
      return;
    }
    (modalInputRef.current?.form ?? inputRef.current?.form)?.requestSubmit();
  };

  // Picking a keyword fills the input and runs the real search immediately.
  const selectKeyword = (term: string) => {
    setValue(term);
    submitQuery(term);
  };

  const navLength = keywordMode ? keywordItems.length : items.length;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (navLength > 0) {
        setOpen(true);
        setActiveIndex((idx) => (idx + 1) % navLength);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (navLength > 0) {
        setOpen(true);
        setActiveIndex((idx) => (idx <= 0 ? navLength - 1 : idx - 1));
      }
    } else if (e.key === "Enter") {
      if (keywordMode && open && activeIndex >= 0 && keywordItems[activeIndex]) {
        e.preventDefault();
        selectKeyword(keywordItems[activeIndex].term);
      } else if (!keywordMode && open && activeIndex >= 0 && items[activeIndex]) {
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

  // --- Keyword suggestion list (storefront, Shopee-style) ---
  // Always leads with a "search for the typed text" row (click / tap = run the
  // real search), then the keyword suggestions. So even when nothing matches, the
  // customer still has a clear way to search — and we never show a "not found" msg.
  const renderKeywordResults = () => {
    const q = value.trim();
    if (q.length < MIN_QUERY_LEN) return null;
    return (
      <>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => submitQuery(q)}
          className="flex w-full items-center gap-3 border-b border-gray-100 px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5"
        >
          <Store size={18} className="flex-shrink-0 text-[#f97316]" />
          <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-gray-800 dark:text-slate-100">
            ค้นหา &ldquo;{q}&rdquo;
          </span>
        </button>
        {keywordItems.length > 0 && (
      <ul id={`${id}-listbox`} role="listbox" className="py-1">
        {keywordItems.map((kw, idx) => (
          <li key={`${kw.term}-${kw.kind}`} role="option" aria-selected={idx === activeIndex}>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectKeyword(kw.term)}
              // Hover highlight is pure CSS (:hover) so it tracks the mouse with no
              // lag; activeIndex stays for keyboard navigation only.
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-orange-50 dark:hover:bg-orange-500/10 ${
                idx === activeIndex ? "bg-orange-50 dark:bg-orange-500/10" : ""
              }`}
            >
              <Search size={16} className="flex-shrink-0 text-gray-400 dark:text-slate-500" />
              <span className="min-w-0 flex-1 truncate text-[15px] text-gray-800 dark:text-slate-100">
                {kw.term}
              </span>
              {kw.sublabel && (
                <span className="flex-shrink-0 text-xs text-gray-400 dark:text-slate-500">
                  {kw.sublabel}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
        )}
      </>
    );
  };

  const handleInlineFocusCapture = () => {
    setHasInlineFocus(true);
  };

  const handleInlineBlurCapture = (e: React.FocusEvent<HTMLDivElement>) => {
    const nextFocused = e.relatedTarget as Node | null;
    if (nextFocused && e.currentTarget.contains(nextFocused)) return;
    setHasInlineFocus(false);
    setOpen(false);
    setActiveIndex(-1);
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
                  const isThisPending = pendingItemId === item.id;
                  const isOtherPending = isNavigating && !isThisPending;
                  return (
                    <li key={item.id} role="option" aria-selected={idx === activeIndex}>
                      <button
                        type="button"
                        // Safari does not focus <button> on click → wrapper's
                        // onBlurCapture fires with relatedTarget=null and closes
                        // the dropdown before onClick runs. preventDefault on
                        // mousedown blocks the focus transition, keeping the
                        // dropdown mounted long enough for onClick to fire.
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => navigateTo(item)}
                        onMouseEnter={() => !isNavigating && setActiveIndex(idx)}
                        disabled={isNavigating}
                        aria-busy={isThisPending}
                        className={`relative flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          isThisPending
                            ? "bg-orange-50 dark:bg-orange-500/10"
                            : isOtherPending
                            ? "opacity-50 cursor-not-allowed"
                            : idx === activeIndex
                            ? "bg-orange-50 dark:bg-orange-500/10"
                            : "hover:bg-gray-50 dark:hover:bg-white/5"
                        }`}
                      >
                        <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-md bg-gray-100 dark:bg-slate-800">
                          {item.imageUrl ? (
                            <Image
                              src={toProductImageCdnPath(item.imageUrl) ?? item.imageUrl}
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
                          {isThisPending ? (
                            <Loader2 size={18} className="animate-spin text-[#f97316]" />
                          ) : (
                            showItemPrice ? (
                              <>
                                <p className="text-sm font-bold text-[#f97316]">
                                  ฿{item.salePrice.toLocaleString("th-TH")}
                                </p>
                                <p className="text-[10px] text-gray-400 dark:text-slate-500">
                                  /{getDisplayUnitName(item)}
                                </p>
                              </>
                            ) : (
                              <p className="text-xs font-semibold text-[#f97316]">
                                {STOREFRONT_PRICE_INQUIRY_LABEL}
                              </p>
                            )
                          )}
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
            // Same Safari blur-before-click guard as suggestion buttons above.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => submitQuery()}
            className="flex w-full items-center justify-center gap-2 border-t border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium text-[#1e3a5f] transition-colors hover:bg-gray-100 dark:border-white/10 dark:bg-slate-800/50 dark:text-sky-300 dark:hover:bg-slate-800"
          >
            ดูผลการค้นหาทั้งหมด {totalCount ?? items.length} รายการ
            <ArrowRight size={14} />
          </button>
        )}
      </>
    );
  };

  // --- Shared pending overlay (top progress bar + toast) — rendered via portal ---
  const pendingOverlay =
    mounted && isNavigating
      ? createPortal(
          <>
            {/* Top progress bar — indeterminate animation, no layout shift */}
            <div
              className="pointer-events-none fixed inset-x-0 top-0 z-[200] h-[3px] overflow-hidden bg-orange-100/40 dark:bg-orange-500/10"
              aria-hidden="true"
            >
              <div className="autocomplete-progress h-full w-1/3 bg-gradient-to-r from-[#f97316] via-[#fb923c] to-[#f97316] shadow-[0_0_8px_rgba(249,115,22,0.6)]" />
            </div>

            {/* Bottom toast — respects iOS safe area, responsive */}
            <div
              role="status"
              aria-live="polite"
              className="pointer-events-none fixed inset-x-0 z-[200] flex justify-center px-4"
              style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}
            >
              <div className="autocomplete-toast pointer-events-auto inline-flex items-center gap-2 rounded-full bg-slate-900/95 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-black/20 backdrop-blur dark:bg-slate-100/95 dark:text-slate-900">
                <Loader2 size={14} className="animate-spin text-[#f97316]" />
                <span>กำลังเปิดสินค้า...</span>
              </div>
            </div>

            <style jsx global>{`
              @keyframes autocomplete-progress-slide {
                0% {
                  transform: translateX(-100%);
                }
                100% {
                  transform: translateX(400%);
                }
              }
              .autocomplete-progress {
                animation: autocomplete-progress-slide 1.1s ease-in-out infinite;
                will-change: transform;
              }
              @keyframes autocomplete-toast-in {
                from {
                  opacity: 0;
                  transform: translateY(8px);
                }
                to {
                  opacity: 1;
                  transform: translateY(0);
                }
              }
              .autocomplete-toast {
                animation: autocomplete-toast-in 180ms ease-out;
                will-change: transform, opacity;
              }
              @media (prefers-reduced-motion: reduce) {
                .autocomplete-progress,
                .autocomplete-toast {
                  animation: none;
                }
              }
            `}</style>
          </>,
          document.body,
        )
      : null;

  // --- MOBILE MODAL VARIANT ---
  if (enhanced === "mobile") {
    return (
      <>
        {pendingOverlay}
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
                {value.trim().length < MIN_QUERY_LEN ? (
                  <div className="px-4 py-8 text-center text-sm text-gray-400 dark:text-slate-500">
                    พิมพ์อย่างน้อย {MIN_QUERY_LEN} ตัวอักษรเพื่อค้นหา
                  </div>
                ) : (
                  // Always shows the "search for this text" row + any suggestions.
                  renderKeywordResults()
                )}
              </div>
            </div>,
            document.body,
          )}
      </>
    );
  }

  // --- DESKTOP ENHANCED VARIANT ---
  if (enhanced === "desktop") {
    const isExpanded = hasInlineFocus || open;
    return (
      <>
        {pendingOverlay}
        <div
          ref={wrapperRef}
          onFocusCapture={handleInlineFocusCapture}
          onBlurCapture={handleInlineBlurCapture}
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
                onClick={() => submitQuery()}
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

          {open && value.trim().length >= MIN_QUERY_LEN && (
            <div className="absolute left-0 right-0 z-50 mt-2 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-900">
              <div className="max-h-[70vh] overflow-y-auto">{renderKeywordResults()}</div>
            </div>
          )}
        </div>

        {/* Backdrop — shown whenever the dropdown is open (search row is present) */}
        {mounted && open && value.trim().length >= MIN_QUERY_LEN &&
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
    <>
      {pendingOverlay}
      <div
        ref={wrapperRef}
        onFocusCapture={handleInlineFocusCapture}
        onBlurCapture={handleInlineBlurCapture}
        className={`relative ${className ?? ""}`}
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
            onClick={() => submitQuery()}
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
                  const isThisPending = pendingItemId === item.id;
                  const isOtherPending = isNavigating && !isThisPending;
                  return (
                    <li key={item.id} role="option" aria-selected={idx === activeIndex}>
                      <button
                        type="button"
                        // Safari does not focus <button> on click → wrapper's
                        // onBlurCapture fires with relatedTarget=null and closes
                        // the dropdown before onClick runs. preventDefault on
                        // mousedown blocks the focus transition, keeping the
                        // dropdown mounted long enough for onClick to fire.
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => navigateTo(item)}
                        onMouseEnter={() => !isNavigating && setActiveIndex(idx)}
                        disabled={isNavigating}
                        aria-busy={isThisPending}
                        className={`relative flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                          isThisPending
                            ? "bg-orange-50 dark:bg-orange-500/10"
                            : isOtherPending
                            ? "opacity-50 cursor-not-allowed"
                            : idx === activeIndex
                            ? "bg-gray-100 dark:bg-white/5"
                            : "hover:bg-gray-50 dark:hover:bg-white/5"
                        }`}
                      >
                        <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-md bg-gray-100 dark:bg-slate-800">
                          {item.imageUrl ? (
                            <Image
                              src={toProductImageCdnPath(item.imageUrl) ?? item.imageUrl}
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
                            {!item.inStock && mode !== "admin" && (
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
                          {mode === "admin" && (
                            <span
                              className={`mt-0.5 inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                                item.stock <= 0
                                  ? "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300"
                                  : item.stock <= 5
                                  ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
                                  : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                              }`}
                            >
                              Stock {item.stock.toLocaleString("en-US")} {getDisplayUnitName(item)}
                            </span>
                          )}
                        </div>
                        <div className="flex-shrink-0 text-right">
                          {isThisPending ? (
                            <Loader2 size={18} className="animate-spin text-[#f97316]" />
                          ) : (
                            showItemPrice ? (
                              <>
                                <p className="text-sm font-bold text-[#f97316]">
                                  ฿{item.salePrice.toLocaleString("th-TH")}
                                </p>
                                <p className="text-[10px] text-gray-400 dark:text-slate-500">
                                  /{getDisplayUnitName(item)}
                                </p>
                              </>
                            ) : (
                              <p className="text-xs font-semibold text-[#f97316]">
                                {STOREFRONT_PRICE_INQUIRY_LABEL}
                              </p>
                            )
                          )}
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
    </>
  );
};

export default ProductAutocomplete;
