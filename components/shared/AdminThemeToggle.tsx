"use client";

import { MoonStar, SunMedium } from "lucide-react";

import { useAdminTheme } from "@/components/shared/AdminThemeProvider";
import { cn } from "@/lib/utils";

const AdminThemeToggle = () => {
  const { isDark, theme, toggleTheme } = useAdminTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "สลับเป็นโหมดสว่าง" : "สลับเป็นโหมดมืด"}
      aria-pressed={isDark}
      title={isDark ? "Dark mode" : "Light mode"}
      className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-white/10 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
    >
      <span
        className={cn(
          "relative flex h-5 w-9 items-center rounded-full transition-colors",
          isDark ? "bg-sky-500/80" : "bg-slate-300",
        )}
      >
        <span
          className={cn(
            "absolute h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
            isDark ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </span>
      <span className="hidden sm:inline">{theme === "dark" ? "Dark" : "Light"}</span>
      {isDark ? <MoonStar size={16} className="text-sky-300" /> : <SunMedium size={16} className="text-amber-500" />}
    </button>
  );
};

export default AdminThemeToggle;
