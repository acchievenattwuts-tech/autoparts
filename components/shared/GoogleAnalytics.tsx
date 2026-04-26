"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Script from "next/script";
import {
  GA_MEASUREMENT_ID,
  isGoogleAnalyticsEnabled,
  trackGoogleAnalyticsEvent,
  trackGoogleAnalyticsPageView,
} from "@/lib/google-analytics";
import {
  isStorefrontPath,
  isTrackedStorefrontHost,
  normalizeStorefrontPath,
} from "@/lib/storefront-visitor";

const LINE_HOSTS = new Set(["lin.ee", "line.me", "liff.line.me"]);
const MAX_LINK_TEXT_LENGTH = 120;

function shouldTrackCurrentStorefront() {
  return (
    typeof window !== "undefined" &&
    isTrackedStorefrontHost(window.location.hostname) &&
    isStorefrontPath(window.location.pathname)
  );
}

function getContactChannel(anchor: HTMLAnchorElement) {
  const href = anchor.getAttribute("href") ?? "";

  if (href.startsWith("tel:")) {
    return "phone";
  }

  try {
    const url = new URL(href, window.location.href);
    return LINE_HOSTS.has(url.hostname.toLowerCase()) ? "line" : null;
  } catch {
    return null;
  }
}

function getSafeLinkUrl(anchor: HTMLAnchorElement) {
  const href = anchor.getAttribute("href") ?? "";

  if (href.startsWith("tel:")) {
    return "tel";
  }

  try {
    const url = new URL(href, window.location.href);
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}

const GoogleAnalyticsContactTracker = () => {
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!shouldTrackCurrentStorefront() || !(event.target instanceof Element)) {
        return;
      }

      const anchor = event.target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      const contactChannel = getContactChannel(anchor);
      if (!contactChannel) {
        return;
      }

      trackGoogleAnalyticsEvent("qualify_lead", {
        contact_channel: contactChannel,
        event_category: "contact",
        link_url: getSafeLinkUrl(anchor),
        link_text: anchor.innerText.trim().slice(0, MAX_LINK_TEXT_LENGTH),
        page_path: normalizeStorefrontPath(window.location.pathname),
      });
    };

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  return null;
};

const GoogleAnalyticsPageViewTracker = () => {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (
      !pathname ||
      typeof window === "undefined" ||
      !isTrackedStorefrontHost(window.location.hostname) ||
      !isStorefrontPath(pathname)
    ) {
      return;
    }

    const queryString = searchParams.toString();
    const pagePath = `${normalizeStorefrontPath(pathname)}${
      queryString ? `?${queryString}` : ""
    }`;

    trackGoogleAnalyticsPageView(pagePath);
  }, [pathname, searchParams]);

  return null;
};

const GoogleAnalytics = () => {
  if (!isGoogleAnalyticsEnabled() || !GA_MEASUREMENT_ID) return null;

  return (
    <>
      <Script
        id="google-analytics-init"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            window.gtag = gtag;
            gtag('js', new Date());
            gtag('config', ${JSON.stringify(GA_MEASUREMENT_ID)}, { send_page_view: false });
          `,
        }}
      />
      <Script
        id="google-analytics-loader"
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
      <Suspense fallback={null}>
        <GoogleAnalyticsPageViewTracker />
      </Suspense>
      <GoogleAnalyticsContactTracker />
    </>
  );
};

export default GoogleAnalytics;
