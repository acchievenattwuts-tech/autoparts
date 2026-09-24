// Delivery tracking configuration constants
const DELIVERY_TRACKING_CONFIG = {
  EARTH_RADIUS_KM: 6371,
  STALE_THRESHOLD_MS: 30 * 60 * 1000, // 30 minutes
  NEARBY_THRESHOLD_KM: 2, // 2 km
  ROUTE_RECALC_THRESHOLD_KM: 0.1, // 100 metres
  OSRM_TIMEOUT_MS: 5000, // 5 seconds
  OSRM_RETRY_PER_ENDPOINT: 1,
  ESTIMATED_ROUTE_FACTOR: 1.25,
  ESTIMATED_SPEED_KMH: 35,
} as const;

export function generateTrackingToken(): string {
  return crypto.randomUUID();
}

/** Haversine formula returns distance in kilometres. */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return DELIVERY_TRACKING_CONFIG.EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isNearby(
  driverLat: number,
  driverLon: number,
  destLat: number,
  destLon: number,
): boolean {
  return haversineDistance(driverLat, driverLon, destLat, destLon) <= DELIVERY_TRACKING_CONFIG.NEARBY_THRESHOLD_KM;
}

export function isStale(updatedAt: Date): boolean {
  return Date.now() - updatedAt.getTime() > DELIVERY_TRACKING_CONFIG.STALE_THRESHOLD_MS;
}

export function shouldRecalcRoute(
  prevLat: number,
  prevLon: number,
  newLat: number,
  newLon: number,
): boolean {
  return haversineDistance(prevLat, prevLon, newLat, newLon) > DELIVERY_TRACKING_CONFIG.ROUTE_RECALC_THRESHOLD_KM;
}

/**
 * Phone shown on the tracking views: the shop's central number from site config
 * (`shop_phone`), never the driver's personal phone. Null (= hide the phone line)
 * when the shop has not configured one.
 */
export function getTrackingContactPhone(shopPhone: string | null | undefined): string | null {
  const phone = shopPhone?.trim();
  return phone ? phone : null;
}

/** A public tracking link lives at most this long after it was issued/renewed. */
export const TRACKING_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type TrackingLinkExpiryInput = {
  /** Explicit expiry stamped on the sale (DELIVERED +48h, sale cancelled +48h). */
  trackingExpiry: Date | null | undefined;
  shippingStatus: string;
  /**
   * Fallback anchor when no explicit expiry is stamped. Sale.updatedAt is the
   * closest stored instant to token issuance: it is bumped by the same update
   * that generates/renews the token (shippingStatus → OUT_FOR_DELIVERY) and is
   * never earlier than it, so a live delivery is never cut off early.
   */
  updatedAt: Date;
};

/**
 * A tracking link is expired when the shipment is cancelled, when its explicit
 * expiry has passed, or — with no explicit expiry — 7 days after the sale was
 * last updated. A missing expiry never means "valid forever".
 */
export function isTrackingExpired(input: TrackingLinkExpiryInput, now: Date = new Date()): boolean {
  if (input.shippingStatus === "CANCELLED") return true;
  if (input.trackingExpiry) return now > input.trackingExpiry;
  return now.getTime() > input.updatedAt.getTime() + TRACKING_LINK_TTL_MS;
}

export type OsrmRouteResult = {
  coordinates: [number, number][]; // [lat, lon] pairs
  durationSeconds: number;
  distanceMetres: number;
  estimated?: boolean;
};

export type RouteProvider = "self-host" | "backup" | "estimated" | "none";

export type TrackingRouteResponse = {
  status: "ok";
  coordinates: [number, number][] | null;
  distanceMetres: number | null;
  durationSeconds: number | null;
  estimated: boolean;
  provider: RouteProvider;
};

export type OsrmRouteWithProvider = OsrmRouteResult & {
  provider: Exclude<RouteProvider, "estimated" | "none">;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function getOsrmTimeoutMs(): number {
  const value = Number(process.env.OSRM_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DELIVERY_TRACKING_CONFIG.OSRM_TIMEOUT_MS;
}

function getOsrmRetryPerEndpoint(): number {
  const value = Number(process.env.OSRM_RETRY_PER_ENDPOINT);
  if (!Number.isFinite(value) || value < 0) {
    return DELIVERY_TRACKING_CONFIG.OSRM_RETRY_PER_ENDPOINT;
  }
  return Math.min(Math.floor(value), 2);
}

type OsrmEndpointConfig = {
  endpoint: string;
  provider: Exclude<RouteProvider, "estimated" | "none">;
};

function getOsrmEndpoints(): OsrmEndpointConfig[] {
  const endpoints = process.env.OSRM_ENDPOINTS?.split(",")
    .map((endpoint) => endpoint.trim().replace(/\/+$/, ""))
    .filter(Boolean);

  if (!endpoints?.length) {
    return [{ endpoint: "https://router.project-osrm.org", provider: "backup" }];
  }

  return endpoints.map((endpoint, index) => ({
    endpoint,
    provider: index === 0 ? "self-host" : "backup",
  }));
}

export function estimateDeliveryRoute(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): OsrmRouteResult {
  const straightLineKm = haversineDistance(fromLat, fromLon, toLat, toLon);
  const distanceMetres = Math.max(
    1,
    straightLineKm * DELIVERY_TRACKING_CONFIG.ESTIMATED_ROUTE_FACTOR * 1000,
  );
  const metresPerSecond = (DELIVERY_TRACKING_CONFIG.ESTIMATED_SPEED_KMH * 1000) / 3600;

  return {
    coordinates: [
      [fromLat, fromLon],
      [toLat, toLon],
    ],
    durationSeconds: Math.max(60, distanceMetres / metresPerSecond),
    distanceMetres,
    estimated: true,
  };
}

/** Fetch one route attempt from an OSRM-compatible endpoint. */
export async function fetchOsrmRoute(
  endpoint: string,
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
  timeoutMs = getOsrmTimeoutMs(),
): Promise<OsrmRouteResult | null> {
  const cleanEndpoint = endpoint.trim().replace(/\/+$/, "");
  const url = `${cleanEndpoint}/route/v1/driving/${fromLon},${fromLat};${toLon},${toLat}?overview=full&geometries=geojson`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      code: string;
      routes?: {
        geometry: { coordinates: [number, number][] };
        duration: number;
        distance: number;
      }[];
    };
    if (data.code !== "Ok" || !data.routes?.[0]) return null;

    const route = data.routes[0];
    // OSRM returns [lon, lat], convert to [lat, lon] for Leaflet.
    const coordinates: [number, number][] = route.geometry.coordinates.map(
      ([lon, lat]) => [lat, lon],
    );
    return {
      coordinates,
      durationSeconds: route.duration,
      distanceMetres: route.distance,
    };
  } catch {
    return null;
  }
}

export async function fetchOsrmRouteWithFailover(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): Promise<OsrmRouteWithProvider | null> {
  const endpoints = getOsrmEndpoints();
  const timeoutMs = getOsrmTimeoutMs();
  const retryPerEndpoint = getOsrmRetryPerEndpoint();

  for (const { endpoint, provider } of endpoints) {
    for (let attempt = 0; attempt <= retryPerEndpoint; attempt += 1) {
      const route = await fetchOsrmRoute(endpoint, fromLat, fromLon, toLat, toLon, timeoutMs);
      if (route) {
        return { ...route, provider };
      }
      if (attempt < retryPerEndpoint) {
        await sleep(400 * (attempt + 1));
      }
    }
  }

  return null;
}

export async function fetchTrackingRoute(token: string): Promise<TrackingRouteResponse | null> {
  try {
    const res = await fetch(`/api/liff/tracking/${token}/route`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as TrackingRouteResponse;
  } catch {
    return null;
  }
}

export function formatEta(durationSeconds: number): string {
  const minutes = Math.round(durationSeconds / 60);
  if (minutes < 60) return `${minutes} นาที`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hours} ชม. ${rem} นาที` : `${hours} ชม.`;
}

export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} ม.`;
  return `${(metres / 1000).toFixed(1)} กม.`;
}
