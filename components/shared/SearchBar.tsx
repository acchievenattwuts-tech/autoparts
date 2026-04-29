"use client";

import { LoaderCircle, Search, X } from "lucide-react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition } from "react";

interface SearchBarProps {
  placeholder?: string;
}

const SearchBar = ({ placeholder = "ค้นหา..." }: SearchBarProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get("q") ?? "");
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    const params = new URLSearchParams(searchParams.toString());
    if (value.trim()) {
      params.set("q", value.trim());
    } else {
      params.delete("q");
    }
    params.delete("page");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const clear = () => {
    setValue("");
    const params = new URLSearchParams(searchParams.toString());
    params.delete("q");
    params.delete("page");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  return (
    <div className={`flex items-center gap-2 transition-opacity ${isPending ? "opacity-70" : ""}`}>
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={placeholder}
          className="w-64 rounded-lg border border-gray-200 py-2 pl-8 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
          disabled={isPending}
        />
        {value && (
          <button
            type="button"
            onClick={clear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            disabled={isPending}
          >
            <X size={14} />
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={isPending}
        className="inline-flex items-center gap-2 rounded-lg bg-[#1e3a5f] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#162d4a] disabled:cursor-wait disabled:opacity-80"
      >
        {isPending ? <LoaderCircle size={14} className="animate-spin" /> : null}
        ค้นหา
      </button>
    </div>
  );
};

export default SearchBar;
