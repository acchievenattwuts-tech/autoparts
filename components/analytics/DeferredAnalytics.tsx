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
