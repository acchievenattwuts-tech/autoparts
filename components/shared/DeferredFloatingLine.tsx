"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const FloatingLine = dynamic(() => import("./FloatingLine"), {
  ssr: false,
});

export default function DeferredFloatingLine({ lineUrl }: { lineUrl?: string }) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const activate = () => setEnabled(true);

    if ("requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(activate, { timeout: 1800 });
      return () => window.cancelIdleCallback(idleId);
    }

    const timeoutId = globalThis.setTimeout(activate, 1400);
    return () => globalThis.clearTimeout(timeoutId);
  }, []);

  if (!enabled) {
    return null;
  }

  return <FloatingLine lineUrl={lineUrl} />;
}
