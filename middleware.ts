import { NextResponse, type NextRequest } from "next/server";

/**
 * Bot/Rate-Limit Middleware
 *
 * เป้าหมาย: ลด Supabase Cached Egress จาก bot crawler และ scraper
 *
 * ขอบเขต:
 *   - Block user-agent ของ bot ที่ไม่นำลูกค้ามา (AI scrapers, SEO crawlers)
 *   - Rate limit `/_next/image` (Next.js Image optimization ที่ดึงรูปจาก Supabase)
 *
 * ไม่กระทบ:
 *   - /admin/*           (admin operations)
 *   - /api/auth/*        (NextAuth)
 *   - /api/admin/*       (admin internal)
 *   - /api/line/*        (LINE webhook server-to-server)
 *   - /api/internal/*    (cron / internal services)
 *   - /api/liff/*        (LIFF client — เป็นลูกค้าจริงผ่าน LINE)
 *   - /api/content/*     (cron content publish)
 *   - /api/revalidate/*  (internal cache invalidation)
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

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const userAgent = req.headers.get("user-agent") ?? "";

  // 1) Block abusive bots on public pages (admin already excluded via matcher)
  if (userAgent && BLOCKED_BOT_PATTERNS.some((pattern) => pattern.test(userAgent))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // 2) Rate limit Next.js image optimization (source of Supabase egress)
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
}

export const config = {
  /**
   * Match everything EXCEPT routes that must never be throttled or blocked:
   *  - admin pages and admin APIs
   *  - NextAuth, LINE webhook, internal cron, LIFF clients
   *  - Cache revalidation and content publish endpoints
   *  - Static assets (_next/static, favicon, manifest, sitemap, robots)
   */
  matcher: [
    "/((?!admin|api/auth|api/admin|api/line|api/internal|api/liff|api/content|api/revalidate|_next/static|_next/data|favicon.ico|manifest.json|sitemap.xml|robots.txt).*)",
  ],
};
