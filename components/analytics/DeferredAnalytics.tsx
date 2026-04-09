"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const StorefrontVisitReporter = dynamic(() => import("./StorefrontVisitReporter"), {
  ssr: false,
});

const WebVitalsReporter = dynamic(() => import("./WebVitalsReporter"), {
  ssr: false,
});

export default function DeferredAnalytics() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    // After route-scoping analytics to storefront pages, keep the existing
    // idle gate so short sessions and early vitals still have coverage.
    const activate = () => setEnabled(true);

    if ("requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(activate, { timeout: 1500 });
      return () => window.cancelIdleCallback(idleId);
    }

    const timeoutId = globalThis.setTimeout(activate, 1200);
    return () => globalThis.clearTimeout(timeoutId);
  }, []);

  if (!enabled) {
    return null;
  }

  return (
    <>
      <StorefrontVisitReporter />
      <WebVitalsReporter />
    </>
  );
}
