"use client";

import { LoaderCircle, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
    <div className={`flex w-full flex-col gap-2 transition-opacity sm:w-auto sm:flex-row sm:items-center ${isPending ? "opacity-70" : ""}`}>
      <div className="relative w-full sm:w-auto">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={placeholder}
          className="h-10 w-full rounded-xl border border-slate-200 bg-white py-2 pl-8 pr-8 text-sm text-slate-800 shadow-sm transition-colors placeholder:text-slate-400 focus:border-[#1e3a5f]/50 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-sky-400/50 dark:focus:ring-sky-400/20 sm:w-72"
          disabled={isPending}
        />
        {value && (
          <button
            type="button"
            onClick={clear}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/10 dark:hover:text-slate-200"
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
        className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#1e3a5f] px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#162d4a] disabled:cursor-wait disabled:opacity-80 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400"
      >
        {isPending ? <LoaderCircle size={14} className="animate-spin" /> : null}
        ค้นหา
      </button>
    </div>
  );
};

export default SearchBar;
