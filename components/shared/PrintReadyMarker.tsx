"use client";
import { useEffect, useRef } from "react";

/** Mounts only after React has committed the streamed document. */
export default function PrintReadyMarker() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const root = ref.current?.closest(".print-document-root");
    root?.setAttribute("data-print-ready", "true");
    return () => root?.removeAttribute("data-print-ready");
  }, []);
  return <span ref={ref} hidden aria-hidden="true" />;
}
