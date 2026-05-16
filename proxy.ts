import { auth } from "./auth";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Bot/Rate-Limit Protection + Admin Auth
 *
 * Admin paths (/admin/*):
 *   auth() callback handles session checking (unchanged from original)
 *
 * Public paths:
 *   - Block aggressive bot user-agents (AI scrapers, SEO crawlers)
 *   - Rate limit /_next/image to reduce Supabase Cached Egress
 *
 * Exempt from bot/rate-limit:
 *   /api/auth, /api/admin, /api/line, /api/internal,
 *   /api/liff, /api/content, /api/revalidate (via matcher)
 */

const BLOCKED_BOT_PATTERNS = [
  /AhrefsBot/i,
  /SemrushBot/i,
  /MJ12bot/i,
  /DotBot/i,
  /PetalBot/i,
  /BLEXBot/i,
  /DataForSeoBot/i,
  /SeekportBot/i,
  /Bytespider/i,
  /GPTBot/i,
  /ClaudeBot/i,
  /anthropic-ai/i,
  /ChatGPT-User/i,
  /CCBot/i,
  /Amazonbot/i,
  /Diffbot/i,
];

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_IMAGE_PER_MIN = 300;
const MAX_TRACKED_IPS = 2000;

type RateEntry = { count: number; resetAt: number };
const ipHits = new Map<string, RateEntry>();

function getClientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() ?? "unknown";
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}

function isRateLimited(ip: string, max: number, now: number): boolean {
  const entry = ipHits.get(ip);
  if (!entry || entry.resetAt < now) {
    ipHits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
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

export const proxy = auth((req) => {
  const { pathname } = req.nextUrl;
  const userAgent = req.headers.get("user-agent") ?? "";

  // Admin paths — leave entirely to auth session logic (no bot check needed)
  if (pathname.startsWith("/admin")) {
    return NextResponse.next();
  }

  // Block aggressive bots on public paths
  if (userAgent && BLOCKED_BOT_PATTERNS.some((pattern) => pattern.test(userAgent))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // Rate limit /_next/image (source of Supabase Cached Egress)
  if (pathname.startsWith("/_next/image")) {
    const now = Date.now();
    const ip = getClientIp(req);
    if (isRateLimited(ip, RATE_LIMIT_MAX_IMAGE_PER_MIN, now)) {
      return new NextResponse("Too Many Requests", {
        status: 429,
        headers: { "Retry-After": "60" },
      });
    }
    sweepStaleEntries(now);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Admin paths — auth session check (original behavior)
    "/admin/:path*",
    // Public paths — bot protection + image rate limiting
    // Exempt: API routes that must never be throttled
    "/((?!admin|api/auth|api/admin|api/line|api/internal|api/liff|api/content|api/revalidate|_next/static|_next/data|favicon.ico|manifest.json|sitemap.xml|robots.txt).*)",
  ],
};
