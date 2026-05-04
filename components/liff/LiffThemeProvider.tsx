"use client";

import { useSyncExternalStore, type ReactNode } from "react";

type LiffTheme = "light" | "dark";

function getSystemTheme(): LiffTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
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
  const theme = useSyncExternalStore(subscribe, getSystemTheme, () => "light");

  return (
    <div
      data-liff-theme={theme}
      className={`liff-theme-root min-h-dvh ${theme === "dark" ? "dark" : ""}`}
      style={{ colorScheme: theme }}
      suppressHydrationWarning
    >
      {children}
    </div>
  );
}
