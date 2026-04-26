"use client";

import { useEffect } from "react";
import Script from "next/script";

const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
  }
}

const GoogleAnalytics = () => {
  if (!GA_ID) return null;

  useEffect(() => {
    window.dataLayer = window.dataLayer || [];
    function gtag(...args: unknown[]) {
      window.dataLayer.push(args);
    }
    window.gtag = gtag;
  }, []);

  return (
    <Script
      src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
      strategy="afterInteractive"
      onLoad={() => {
        window.gtag("js", new Date());
        window.gtag("config", GA_ID);
      }}
    />
  );
};

export default GoogleAnalytics;
