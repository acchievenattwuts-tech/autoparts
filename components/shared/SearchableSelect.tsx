"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";
import { useOptionalAdminTheme } from "@/components/shared/AdminThemeProvider";

export interface SelectOption {
  id: string;
  label: string;
  sublabel?: string;
}

interface Props {
  options: SelectOption[];
  value: string;
  onChange: (id: string) => void;
  onOptionSelect?: (option: SelectOption) => void;
  searchOptions?: (query: string) => Promise<SelectOption[]>;
  selectedOption?: SelectOption | null;
  placeholder?: string;
  disabled?: boolean;
}

const MAX_RESULTS = 50;
const MIN_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 200;

const SearchableSelect = ({
  options,
  value,
  onChange,
  onOptionSelect,
  searchOptions,
  selectedOption,
  placeholder = "โปรดระบุ",
  disabled = false,
}: Props) => {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });
  const [remoteResults, setRemoteResults] = useState<SelectOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const adminTheme = useOptionalAdminTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isDark = adminTheme?.isDark ?? false;
  const selected = selectedOption ?? options.find((option) => option.id === value) ?? null;
  const trimmedQuery = query.trim();
  const isQueryReady = trimmedQuery.length >= MIN_QUERY_LENGTH;

  const localResults = trimmedQuery
    ? options.filter((option) => {
        const normalized = trimmedQuery.toLowerCase();
        return (
          option.label.toLowerCase().includes(normalized) ||
          (option.sublabel?.toLowerCase().includes(normalized) ?? false)
        );
      }).slice(0, MAX_RESULTS)
    : options.slice(0, MAX_RESULTS);

  const filtered = searchOptions ? remoteResults : localResults;

  useEffect(() => {
    if (!open || !searchOptions) {
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
        const results = await searchOptions(trimmedQuery);
        if (!isActive) return;
        setRemoteResults(results.slice(0, MAX_RESULTS));
      } catch {
        if (!isActive) return;
        setRemoteResults([]);
      } finally {
        if (isActive) setIsLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      isActive = false;
      window.clearTimeout(timeoutId);
    };
  }, [open, isQueryReady, searchOptions, trimmedQuery]);

  const updateCoords = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      setCoords({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 240) });
    }
  };

  const handleOpen = () => {
    if (!disabled) {
      updateCoords();
      setOpen(true);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const handleSelect = (option: SelectOption) => {
    onChange(option.id);
    onOptionSelect?.(option);
    setQuery("");
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
    setQuery("");
    setOpen(false);
  };

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

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (dropdownRef.current?.contains(e.target as Node)) return;
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
  const dropdownSearchWrapClassName = isDark
    ? "border-b border-slate-800/80 bg-slate-950/90 p-2"
    : "border-b border-gray-100 p-2";
  const dropdownInputClassName = isDark
    ? "w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-400/20"
    : "w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20";
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
      : value
        ? "border-slate-700 bg-slate-950 text-slate-100 hover:border-slate-600"
        : "border-orange-500/30 bg-orange-500/10 text-orange-200 hover:border-orange-400/45"
    : open
      ? "border-[#1e3a5f] ring-2 ring-[#1e3a5f]/20 bg-white"
      : value
        ? "border-gray-300 hover:border-gray-400 bg-white"
        : "border-orange-300 hover:border-orange-400 bg-orange-50/30";

  const dropdown = open
    ? createPortal(
        <div
          ref={dropdownRef}
          style={{ top: coords.top, left: coords.left, width: coords.width }}
          className={dropdownClassName}
        >
          <div className={dropdownSearchWrapClassName}>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="พิมพ์เพื่อค้นหา..."
              className={dropdownInputClassName}
            />
          </div>
          <div className="max-h-56 overflow-y-auto overscroll-contain">
            {searchOptions && !isQueryReady ? (
              <p className={dropdownMessageClassName}>
                พิมพ์อย่างน้อย {MIN_QUERY_LENGTH} ตัวอักษรเพื่อค้นหา
              </p>
            ) : isLoading ? (
              <p className={dropdownMessageClassName}>กำลังโหลด...</p>
            ) : filtered.length === 0 ? (
              <p className={dropdownMessageClassName}>ไม่พบรายการ</p>
            ) : (
              filtered.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelect(option)}
                  className={`w-full px-3 py-2.5 text-left text-sm transition-colors ${
                    option.id === value ? selectedOptionClassName : defaultOptionClassName
                  }`}
                >
                  <span className="font-medium">{option.label}</span>
                  {option.sublabel && (
                    <span className={`mt-0.5 block text-xs ${isDark ? "text-slate-400" : "text-gray-400"}`}>
                      {option.sublabel}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div ref={containerRef} className="relative">
      <div
        role="combobox"
        aria-expanded={open}
        onClick={handleOpen}
        className={`flex w-full cursor-pointer select-none items-center rounded-lg border px-3 py-2 text-sm transition-colors ${
          triggerClassName
        } ${disabled ? "opacity-70 cursor-not-allowed" : ""}`}
      >
        {open ? (
          <span className={`flex-1 text-sm ${isDark ? "text-slate-400" : "text-gray-400"}`}>
            {selected?.label ?? placeholder}
          </span>
        ) : selected ? (
          <>
            <span className={`flex-1 truncate ${isDark ? "text-slate-100" : "text-gray-800"}`}>
              {selected.label}
            </span>
            {!disabled && (
              <X
                size={14}
                className={`ml-1 shrink-0 ${isDark ? "text-slate-500 hover:text-slate-300" : "text-gray-400 hover:text-gray-600"}`}
                onClick={handleClear}
              />
            )}
          </>
        ) : (
          <span className={`flex-1 font-medium ${isDark ? "text-orange-200" : "text-orange-400"}`}>
            {placeholder}
          </span>
        )}
        {!open && (
          <ChevronDown
            size={16}
            className={`ml-1 shrink-0 ${isDark ? "text-slate-500" : "text-gray-400"}`}
          />
        )}
      </div>
      {dropdown}
    </div>
  );
};

export default SearchableSelect;
