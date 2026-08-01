"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";
import { useOptionalAdminTheme } from "@/components/shared/AdminThemeProvider";

export interface MultiSelectOption {
  id: string;
  label: string;
  sublabel?: string;
}

interface Props {
  options: MultiSelectOption[];
  /** id ที่เลือกอยู่ — ว่าง = ไม่กรอง */
  values: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  /** ข้อความหัวข้อในกล่อง dropdown */
  searchPlaceholder?: string;
}

const MAX_RESULTS = 200;

/**
 * Dropdown แบบเลือกได้หลายค่า (checkbox) สำหรับตัวกรองฝั่งแอดมิน
 * โครงสร้าง/ธีมอิงกับ SearchableSelect เพื่อให้หน้าตาเข้าชุดกัน และ portal
 * ออกไปที่ document.body เหมือนกัน จึงต้องพก class `dark` จาก AdminTheme ไปเอง
 */
const MultiSelectFilter = ({
  options,
  values,
  onChange,
  placeholder = "ทั้งหมด",
  disabled = false,
  searchPlaceholder = "พิมพ์เพื่อค้นหา...",
}: Props) => {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });
  const adminTheme = useOptionalAdminTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isDark = adminTheme?.isDark ?? false;
  const selectedSet = useMemo(() => new Set(values), [values]);
  const selectedOptions = useMemo(
    () => options.filter((option) => selectedSet.has(option.id)),
    [options, selectedSet],
  );

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return options.slice(0, MAX_RESULTS);
    return options
      .filter(
        (option) =>
          option.label.toLowerCase().includes(trimmed) ||
          (option.sublabel?.toLowerCase().includes(trimmed) ?? false),
      )
      .slice(0, MAX_RESULTS);
  }, [options, query]);

  const updateCoords = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      setCoords({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 240) });
    }
  };

  const handleOpen = () => {
    if (disabled) return;
    updateCoords();
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const toggle = (id: string) => {
    onChange(selectedSet.has(id) ? values.filter((value) => value !== id) : [...values, id]);
  };

  const handleClear = (event: React.MouseEvent) => {
    event.stopPropagation();
    onChange([]);
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
      if (dropdownRef.current?.contains(event.target as Node)) return;
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
  const optionRowClassName = isDark
    ? "text-slate-200 hover:bg-slate-900"
    : "text-gray-800 hover:bg-blue-50";
  const selectedRowClassName = isDark
    ? "bg-sky-500/15 text-sky-200 hover:bg-sky-500/20"
    : "bg-blue-50 text-[#1e3a5f]";
  const hasValues = values.length > 0;
  const triggerClassName = isDark
    ? open
      ? "border-sky-400/70 bg-slate-950 text-slate-100 ring-2 ring-sky-400/20"
      : hasValues
        ? "border-slate-700 bg-slate-950 text-slate-100 hover:border-slate-600"
        : "border-orange-500/30 bg-orange-500/10 text-orange-200 hover:border-orange-400/45"
    : open
      ? "border-[#1e3a5f] ring-2 ring-[#1e3a5f]/20 bg-white"
      : hasValues
        ? "border-gray-300 hover:border-gray-400 bg-white"
        : "border-orange-300 hover:border-orange-400 bg-orange-50/30";

  const triggerLabel =
    selectedOptions.length === 0
      ? placeholder
      : selectedOptions.length === 1
        ? selectedOptions[0].label
        : `เลือกแล้ว ${selectedOptions.length} หมวด`;

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
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              className={dropdownInputClassName}
            />
          </div>
          <div className="max-h-56 overflow-y-auto overscroll-contain">
            {filtered.length === 0 ? (
              <p className={dropdownMessageClassName}>ไม่พบรายการ</p>
            ) : (
              filtered.map((option) => {
                const isSelected = selectedSet.has(option.id);
                return (
                  <label
                    key={option.id}
                    className={`flex w-full cursor-pointer items-start gap-2.5 px-3 py-2.5 text-left text-sm transition-colors ${
                      isSelected ? selectedRowClassName : optionRowClassName
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(option.id)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-[#f97316] focus:ring-[#f97316] dark:border-slate-500 dark:bg-slate-800"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{option.label}</span>
                      {option.sublabel ? (
                        <span
                          className={`mt-0.5 block text-xs ${isDark ? "text-slate-400" : "text-gray-400"}`}
                        >
                          {option.sublabel}
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })
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
        className={`flex w-full cursor-pointer select-none items-center rounded-lg border px-3 py-2 text-sm transition-colors ${triggerClassName} ${
          disabled ? "cursor-not-allowed opacity-70" : ""
        }`}
      >
        {hasValues ? (
          <>
            <span className={`flex-1 truncate ${isDark ? "text-slate-100" : "text-gray-800"}`}>
              {triggerLabel}
            </span>
            {!disabled && (
              <X
                size={14}
                className={`ml-1 shrink-0 ${
                  isDark ? "text-slate-500 hover:text-slate-300" : "text-gray-400 hover:text-gray-600"
                }`}
                onClick={handleClear}
                aria-label="ล้างหมวดหมู่ที่เลือก"
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

export default MultiSelectFilter;
