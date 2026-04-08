"use client";

import { useEffect, useState } from "react";
import FloatingLine from "./FloatingLine";

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
