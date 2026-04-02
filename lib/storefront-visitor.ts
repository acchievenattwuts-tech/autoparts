const BANGKOK_TIMEZONE = "Asia/Bangkok";
const TRACKED_HOSTS = new Set(["www.sriwanparts.com", "sriwanparts.com"]);

export const STOREFRONT_VISITOR_STORAGE_KEY = "sriwanparts.storefront.visitor";
export const STOREFRONT_VISITOR_DAY_KEY = "sriwanparts.storefront.last-visit-day";

function getDatePart(date: Date, type: "year" | "month" | "day") {
  return (
    new Intl.DateTimeFormat("en-US", {
      timeZone: BANGKOK_TIMEZONE,
      [type]: "numeric",
    })
      .formatToParts(date)
      .find((part) => part.type === type)?.value ?? ""
  );
}

export function getBangkokDayKey(date: Date = new Date()) {
  const year = getDatePart(date, "year");
  const month = getDatePart(date, "month").padStart(2, "0");
  const day = getDatePart(date, "day").padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isStorefrontPath(pathname: string) {
  return pathname === "/" || (!pathname.startsWith("/admin") && !pathname.startsWith("/api") && !pathname.startsWith("/_next"));
}

export function isTrackedStorefrontHost(hostname: string) {
  return TRACKED_HOSTS.has(hostname.toLowerCase());
}

export function normalizeStorefrontPath(pathname: string) {
  if (!pathname.startsWith("/")) {
    return `/${pathname}`;
  }

  return pathname;
}
