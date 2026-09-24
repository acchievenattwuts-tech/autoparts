import { auth } from "./auth";
import { NextResponse, type NextFetchEvent, type NextProxy, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getClientIp } from "@/lib/client-ip";
import { shouldRejectRootPost } from "@/lib/root-request-guard";
import { countsTowardStorefrontCatalogLimit } from "@/lib/storefront-catalog-rate-limit";
import {
  isAggressiveBotUserAgent,
  isAiAnswerBotPathAllowed,
  isAiAnswerBotUserAgent,
} from "@/lib/public-crawler-policy";
import {
  extractProductIdFromSlug,
  getLegacyThaiProductPathRedirectTarget,
  getProductPath,
  isLegacyThaiProductPath,
} from "@/lib/product-slug";

/**
 * Bot/Rate-Limit Protection + Admin Auth
 *
 * Admin paths (/admin/*):
 *   delegated to the auth()-wrapped handler: session check + authorized()
 *   callback in auth.config.ts (login redirect, 403 on a denied permission).
 *
 * Public paths never call auth(): a staff member's session cookie is not read,
 * re-checked against the DB or re-issued on storefront pages and images.
 *
 * Public paths:
 *   - Block aggressive bot user-agents (AI scrapers, SEO crawlers)
 *   - Rate limit /_next/image to reduce Supabase Cached Egress
 *
 * Exempt from bot/rate-limit:
 *   /api/auth, /api/admin, /api/line, /api/internal,
 *   /api/liff, /api/content, /api/revalidate (via matcher)
 */

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_IMAGE_PER_MIN = 300;
const RATE_LIMIT_MAX_STOREFRONT_CATALOG_PER_MIN = 60;
const MAX_TRACKED_IPS = 2000;

type RateEntry = { count: number; resetAt: number };
const ipHits = new Map<string, RateEntry>();

function isRateLimited(key: string, max: number, now: number): boolean {
  const entry = ipHits.get(key);
  if (!entry || entry.resetAt < now) {
    ipHits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > max;
}

function sweepStaleEntries(now: number) {
  if (ipHits.size < MAX_TRACKED_IPS) return;
  for (const [ip, entry] of ipHits) {
    if (entry.resetAt < now) ipHits.delete(ip);
  }
}

/**
 * The URL the auth() wrapper used to hand this request: next-auth swaps the
 * origin for AUTH_URL / NEXTAUTH_URL (reqWithEnvURL in next-auth/lib/env.js).
 * Public requests no longer pass through auth(), so the legacy product
 * redirect resolves against this to keep its Location exactly as before.
 */
function getAuthEnvRequestUrl(req: NextRequest): string {
  const envUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  if (!envUrl) return req.url;
  const { href, origin } = req.nextUrl;
  return href.replace(origin, new URL(envUrl).origin);
}

type AdminPassThrough = (req: NextRequest, event: NextFetchEvent) => NextResponse;

// Everything admin-specific happens inside auth(): the session read and the
// authorized() decision. Once that allows the request it just continues.
const passAdminRequestThrough: AdminPassThrough = () => NextResponse.next();
const adminProxy = auth(passAdminRequestThrough);

async function handlePublicRequest(req: NextRequest, pathname: string, method: string): Promise<Response> {
  const userAgent = req.headers.get("user-agent") ?? "";

  if (userAgent && isAggressiveBotUserAgent(userAgent)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  if (userAgent && isAiAnswerBotUserAgent(userAgent) && !isAiAnswerBotPathAllowed(pathname)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // Link prefetches are not counted (see lib/storefront-catalog-rate-limit.ts);
  // page loads and real navigations still are.
  if (countsTowardStorefrontCatalogLimit(pathname, method, req.headers)) {
    const now = Date.now();
    const ip = getClientIp(req.headers);
    if (isRateLimited(`storefront-catalog:${ip}`, RATE_LIMIT_MAX_STOREFRONT_CATALOG_PER_MIN, now)) {
      return new NextResponse("Too Many Requests", {
        status: 429,
        headers: {
          "Retry-After": "60",
          "Cache-Control": "private, no-store",
        },
      });
    }
    sweepStaleEntries(now);
  }

  if (pathname.startsWith("/product/")) {
    const productSlug = pathname.slice("/product/".length);

    if (!isLegacyThaiProductPath(pathname)) {
      return NextResponse.next();
    }

    const productId = extractProductIdFromSlug(productSlug);

    if (!productId) {
      return new NextResponse("Not Found", { status: 404 });
    }

    const product = await db.product.findFirst({
      where: {
        id: productId,
        isActive: true,
      },
      select: {
        id: true,
        slug: true,
        name: true,
        code: true,
        category: { select: { id: true, name: true, slug: true } },
      },
    });

    if (!product) {
      return new NextResponse("Not Found", { status: 404 });
    }

    const canonicalPath = getProductPath({
      category: product.category,
      product,
    });
    const redirectTarget = getLegacyThaiProductPathRedirectTarget({
      pathname,
      canonicalPath,
    });

    if (redirectTarget) {
      return NextResponse.redirect(new URL(redirectTarget, getAuthEnvRequestUrl(req)), 308);
    }
  }

  // Rate limit /_next/image (source of Supabase Cached Egress)
  if (pathname.startsWith("/_next/image")) {
    const now = Date.now();
    const ip = getClientIp(req.headers);
    if (isRateLimited(`next-image:${ip}`, RATE_LIMIT_MAX_IMAGE_PER_MIN, now)) {
      return new NextResponse("Too Many Requests", {
        status: 429,
        headers: { "Retry-After": "60" },
      });
    }
    sweepStaleEntries(now);
  }

  return NextResponse.next();
}

export const proxy: NextProxy = async (req, event) => {
  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();

  // First for every path, admin included.
  if (shouldRejectRootPost(pathname, method)) {
    return new NextResponse("Method Not Allowed", {
      status: 405,
      headers: {
        Allow: "GET, HEAD",
        "Cache-Control": "no-store",
      },
    });
  }

  if (pathname.startsWith("/admin")) {
    return adminProxy(req, event);
  }

  return handlePublicRequest(req, pathname, method);
};

export const config = {
  matcher: [
    // Admin paths — auth session check (original behavior)
    "/admin/:path*",
    // Public paths — bot protection + image rate limiting
    // Exempt: API routes that must never be throttled
    "/((?!admin|api/auth|api/admin|api/line|api/internal|api/liff|api/content|api/revalidate|_next/static|_next/data|favicon.ico|manifest.json|sitemap.xml|robots.txt).*)",
  ],
};
