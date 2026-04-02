"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  getBangkokDayKey,
  isStorefrontPath,
  isTrackedStorefrontHost,
  normalizeStorefrontPath,
  STOREFRONT_VISITOR_DAY_KEY,
  STOREFRONT_VISITOR_STORAGE_KEY,
} from "@/lib/storefront-visitor";

const endpoint = "/api/storefront-visit";

function getOrCreateVisitorKey() {
  const existing = window.localStorage.getItem(STOREFRONT_VISITOR_STORAGE_KEY);

  if (existing) {
    return existing;
  }

  const nextVisitorKey = window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  window.localStorage.setItem(STOREFRONT_VISITOR_STORAGE_KEY, nextVisitorKey);
  return nextVisitorKey;
}

export default function StorefrontVisitReporter() {
  const pathname = usePathname();

  useEffect(() => {
    if (navigator.webdriver) {
      return;
    }

    if (
      process.env.NODE_ENV !== "production" ||
      !pathname ||
      !isStorefrontPath(pathname) ||
      !isTrackedStorefrontHost(window.location.hostname)
    ) {
      return;
    }

    try {
      const visitDay = getBangkokDayKey();
      const alreadyTrackedDay = window.localStorage.getItem(STOREFRONT_VISITOR_DAY_KEY);

      if (alreadyTrackedDay === visitDay) {
        return;
      }

      const payload = JSON.stringify({
        visitorKey: getOrCreateVisitorKey(),
        pathname: normalizeStorefrontPath(pathname),
      });

      window.localStorage.setItem(STOREFRONT_VISITOR_DAY_KEY, visitDay);

      if (navigator.sendBeacon) {
        navigator.sendBeacon(endpoint, payload);
        return;
      }

      void fetch(endpoint, {
        method: "POST",
        body: payload,
        headers: {
          "Content-Type": "application/json",
        },
        keepalive: true,
      });
    } catch {
      // Ignore storage/transport issues to avoid breaking the storefront experience.
    }
  }, [pathname]);

  return null;
}
