export const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_ID;

type GoogleAnalyticsParam = string | number | boolean | null | undefined;

export type GoogleAnalyticsEventParams = Record<string, GoogleAnalyticsParam>;

type GoogleAnalyticsCommand =
  | [command: "js", date: Date]
  | [
      command: "config",
      targetId: string,
      config?: GoogleAnalyticsEventParams,
    ]
  | [command: "event", eventName: string, params?: GoogleAnalyticsEventParams]
  | [command: "set", params: Record<string, unknown>];

declare global {
  interface Window {
    dataLayer?: GoogleAnalyticsCommand[];
    gtag?: (...args: GoogleAnalyticsCommand) => void;
  }
}

export function isGoogleAnalyticsEnabled() {
  return Boolean(GA_MEASUREMENT_ID);
}

export function trackGoogleAnalyticsPageView(
  pagePath: string,
  pageTitle?: string,
) {
  if (!GA_MEASUREMENT_ID || typeof window.gtag !== "function") {
    return;
  }

  window.gtag("event", "page_view", {
    page_path: pagePath,
    page_location: window.location.href,
    page_title: pageTitle ?? document.title,
  });
}

export function trackGoogleAnalyticsEvent(
  eventName: string,
  params: GoogleAnalyticsEventParams = {},
) {
  if (!GA_MEASUREMENT_ID || typeof window.gtag !== "function") {
    return;
  }

  window.gtag("event", eventName, params);
}
