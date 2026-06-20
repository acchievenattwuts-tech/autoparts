"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

type LiffTheme = "light" | "dark";

declare global {
  interface Window {
    __liffThemeHydrated?: boolean;
  }
}

function getBootstrappedTheme(): LiffTheme | null {
  if (typeof document === "undefined") return null;
  const theme = document.documentElement.dataset.liffTheme ?? document.body?.dataset.liffTheme;
  return theme === "dark" || theme === "light" ? theme : null;
}

function getSystemTheme(): LiffTheme {
  if (typeof window === "undefined") return "light";
  if (!window.__liffThemeHydrated) {
    const bootstrappedTheme = getBootstrappedTheme();
    if (bootstrappedTheme) return bootstrappedTheme;
  }
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
    window.__liffThemeHydrated = true;
    document.documentElement.dataset.liffTheme = theme;
    document.body.dataset.liffTheme = theme;
    document.documentElement.style.colorScheme = isPrintMode ? "only light" : theme;
    document.body.style.colorScheme = isPrintMode ? "only light" : theme;
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.body.classList.toggle("dark", theme === "dark");
    document.documentElement.style.backgroundColor = isPrintMode ? "#ffffff" : "";
    document.body.style.backgroundColor = isPrintMode ? "#ffffff" : theme === "dark" ? "#06162d" : "#eef7ff";

    // App-shell: stop the document from scrolling so the mobile browser toolbar
    // never toggles (which made the fixed bottom nav jump). The scroll happens in
    // .liff-scroll-region instead. Never lock in print mode — receipts must flow.
    if (!isPrintMode) {
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.documentElement.removeAttribute("data-liff-theme");
      document.body.removeAttribute("data-liff-theme");
      document.documentElement.style.colorScheme = "";
      document.documentElement.style.backgroundColor = "";
      document.body.style.colorScheme = "";
      document.documentElement.classList.remove("dark");
      document.body.classList.remove("dark");
      document.body.style.backgroundColor = "";
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
    };
  }, [isPrintMode, theme]);

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
