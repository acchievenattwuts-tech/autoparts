// Delivery tracking configuration constants
const DELIVERY_TRACKING_CONFIG = {
  EARTH_RADIUS_KM: 6371,
  STALE_THRESHOLD_MS: 30 * 60 * 1000, // 30 minutes
  NEARBY_THRESHOLD_KM: 2, // 2 km
  ROUTE_RECALC_THRESHOLD_KM: 0.1, // 100 metres
  OSRM_TIMEOUT_MS: 15000, // 15 seconds
} as const;

export function generateTrackingToken(): string {
  return crypto.randomUUID();
}

/** Haversine formula — returns distance in kilometres */
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

export function isTrackingExpired(trackingExpiry: Date | null | undefined): boolean {
  if (!trackingExpiry) return false;
  return new Date() > trackingExpiry;
}

export type OsrmRouteResult = {
  coordinates: [number, number][]; // [lat, lon] pairs
  durationSeconds: number;
  distanceMetres: number;
};

/** Fetch route from OSRM public demo server */
export async function fetchOsrmRoute(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): Promise<OsrmRouteResult | null> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${fromLon},${fromLat};${toLon},${toLat}?overview=full&geometries=geojson&timeout=${DELIVERY_TRACKING_CONFIG.OSRM_TIMEOUT_MS / 1000}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(DELIVERY_TRACKING_CONFIG.OSRM_TIMEOUT_MS) });
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
    // OSRM returns [lon, lat] — convert to [lat, lon] for Leaflet
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
