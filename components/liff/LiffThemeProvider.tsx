"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

type LiffTheme = "light" | "dark";

function getSystemTheme(): LiffTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function isPrintTokenRequest() {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).has("printToken");
}

function subscribe(onStoreChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");

  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", onStoreChange);
    return () => media.removeEventListener("change", onStoreChange);
  }

  media.addListener(onStoreChange);
  return () => media.removeListener(onStoreChange);
}

export default function LiffThemeProvider({ children }: { children: ReactNode }) {
  const systemTheme = useSyncExternalStore<LiffTheme>(subscribe, getSystemTheme, () => "light");
  const [isPrintMode] = useState(isPrintTokenRequest);
  const theme: LiffTheme = isPrintMode ? "light" : systemTheme;

  useEffect(() => {
    if (!isPrintMode) return;

    const previousColorScheme = document.documentElement.style.colorScheme;
    const previousBackground = document.documentElement.style.backgroundColor;
    document.documentElement.style.colorScheme = "only light";
    document.documentElement.style.backgroundColor = "#ffffff";
    document.body.style.colorScheme = "only light";
    document.body.style.backgroundColor = "#ffffff";

    return () => {
      document.documentElement.style.colorScheme = previousColorScheme;
      document.documentElement.style.backgroundColor = previousBackground;
      document.body.style.colorScheme = "";
      document.body.style.backgroundColor = "";
    };
  }, [isPrintMode]);

  return (
    <div
      data-liff-theme={theme}
      data-liff-print={isPrintMode ? "true" : undefined}
      className={`liff-theme-root min-h-dvh ${theme === "dark" ? "dark" : ""}`}
      style={{ colorScheme: isPrintMode ? "only light" : theme, backgroundColor: isPrintMode ? "#ffffff" : undefined }}
      suppressHydrationWarning
    >
      {children}
    </div>
  );
}
