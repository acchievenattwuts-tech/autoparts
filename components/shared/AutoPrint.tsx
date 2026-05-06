"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { printWhenReady } from "./print-assets";

const AutoPrint = () => {
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get("print") === "1") {
      const timer = setTimeout(() => {
        void printWhenReady();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [searchParams]);

  return null;
};

export default AutoPrint;
