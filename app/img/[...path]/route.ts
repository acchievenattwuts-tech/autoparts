import { type NextRequest } from "next/server";
import {
  buildPublicProductImageUrl,
  isProductImageObjectPath,
} from "@/lib/product-image-url";

/**
 * Same-origin product-image CDN proxy.
 *
 * Flow:  client / crawler / next-image optimizer
 *          -> /img/<objectPath>  (cached by the Vercel CDN, see Cache-Control below)
 *          -> Supabase Storage   (only on a CDN cache miss)
 *
 * This keeps the public origin for product images on our own domain so that the
 * Supabase Storage object is fetched at most once per cache window, cutting both
 * Egress and Cached Egress on the Supabase side and shifting the delivery load to
 * the Vercel CDN.
 *
 * Only object paths inside our product-image bucket root are allowed, so this
 * route cannot be abused as an open fetch proxy.
 */

const ONE_YEAR_SECONDS = 31_536_000;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  if (!SUPABASE_URL) {
    return new Response("Image storage is not configured", { status: 500 });
  }

  const { path } = await params;
  // Next.js already URL-decodes catch-all segments, so joining reproduces the
  // original Supabase object path (e.g. "products/<code>/<file>.webp").
  const objectPath = path.join("/");

  if (!objectPath || !isProductImageObjectPath(objectPath)) {
    return new Response("Not Found", { status: 404 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(buildPublicProductImageUrl(SUPABASE_URL, objectPath), {
      // We add our own long-lived Cache-Control below; do not let fetch cache
      // an error body.
      cache: "no-store",
    });
  } catch {
    return new Response("Upstream image fetch failed", { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response("Not Found", { status: 404 });
  }

  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      // Filenames are content-addressed (timestamp + uuid), so an object never
      // changes under the same path — safe to cache immutably for a year.
      //
      // Three cache headers, each targeting a different layer (more specific wins):
      // - Cache-Control          -> the browser (and any other downstream client)
      // - CDN-Cache-Control      -> a standards-based shared CDN
      // - Vercel-CDN-Cache-Control -> the Vercel Edge Network specifically
      // Splitting them lets the CDN cache for a year while we could later relax the
      // browser TTL independently without re-fetching from Supabase.
      "Cache-Control": `public, max-age=${ONE_YEAR_SECONDS}, s-maxage=${ONE_YEAR_SECONDS}, immutable`,
      "CDN-Cache-Control": `public, s-maxage=${ONE_YEAR_SECONDS}, immutable`,
      "Vercel-CDN-Cache-Control": `public, s-maxage=${ONE_YEAR_SECONDS}, immutable`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
