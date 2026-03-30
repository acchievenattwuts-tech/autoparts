"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";

export interface SelectOption {
  id: string;
  label: string;       // primary text (name)
  sublabel?: string;   // secondary text (code, phone, etc.)
}

interface Props {
  options: SelectOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

const SearchableSelect = ({
  options,
  value,
  onChange,
  placeholder = "โปรดระบุ",
  disabled = false,
}: Props) => {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.id === value);

  const filtered = query.trim()
    ? options.filter((o) => {
        const q = query.trim().toLowerCase();
        return (
          o.label.toLowerCase().includes(q) ||
          (o.sublabel?.toLowerCase().includes(q) ?? false)
        );
      }).slice(0, 50)
    : options.slice(0, 50);

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

  const handleSelect = (id: string) => {
    onChange(id);
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
      // Don't close when scrolling inside the dropdown list
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

  const dropdown = open
    ? createPortal(
        <div
          ref={dropdownRef}
          style={{ top: coords.top, left: coords.left, width: coords.width }}
          className="fixed z-[9999] bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden"
        >
          <div className="p-2 border-b border-gray-100">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="พิมพ์เพื่อค้นหา..."
              className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20"
            />
          </div>
          <div className="max-h-56 overflow-y-auto overscroll-contain">
            {filtered.length === 0 ? (
              <p className="px-4 py-3 text-sm text-gray-400 text-center">ไม่พบรายการ</p>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelect(o.id)}
                  className={`w-full text-left px-3 py-2.5 text-sm transition-colors hover:bg-blue-50 ${
                    o.id === value ? "bg-blue-50 text-[#1e3a5f]" : "text-gray-800"
                  }`}
                >
                  <span className="font-medium">{o.label}</span>
                  {o.sublabel && (
                    <span className="block text-xs text-gray-400 mt-0.5">{o.sublabel}</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <div ref={containerRef} className="relative">
      <div
        role="combobox"
        aria-expanded={open}
        onClick={handleOpen}
        className={`flex items-center w-full px-3 py-2 border rounded-lg text-sm cursor-pointer select-none transition-colors ${
          open
            ? "border-[#1e3a5f] ring-2 ring-[#1e3a5f]/20 bg-white"
            : value
            ? "border-gray-300 hover:border-gray-400 bg-white"
            : "border-orange-300 hover:border-orange-400 bg-orange-50/30"
        } ${disabled ? "opacity-70 cursor-not-allowed" : ""}`}
      >
        {open ? (
          <span className="flex-1 text-gray-400 text-sm">{selected?.label ?? placeholder}</span>
        ) : selected ? (
          <>
            <span className="flex-1 truncate text-gray-800">{selected.label}</span>
            {!disabled && (
              <X size={14} className="ml-1 text-gray-400 hover:text-gray-600 flex-shrink-0" onClick={handleClear} />
            )}
          </>
        ) : (
          <span className="flex-1 text-orange-400 font-medium">{placeholder}</span>
        )}
        {!open && <ChevronDown size={16} className="ml-1 text-gray-400 flex-shrink-0" />}
      </div>
      {dropdown}
    </div>
  );
};

export default SearchableSelect;
