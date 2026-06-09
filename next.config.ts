import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

const securityHeaders = [
  // Prevent MIME type sniffing
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Prevent clickjacking from external sites (SAMEORIGIN allows our own iframe print)
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Legacy XSS filter (IE/old browsers)
  { key: "X-XSS-Protection", value: "1; mode=block" },
  // Control referrer info
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Disable unused browser features
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self), interest-cohort=()",
  },
  // Force HTTPS (production only — safe to include, browsers ignore on HTTP)
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // Content Security Policy
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js requires unsafe-inline for hydration scripts; Google Analytics
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://static.line-scdn.net",
      // Tailwind uses inline styles
      "style-src 'self' 'unsafe-inline'",
      // Allow images from self, Supabase storage, analytics pixels, data URIs, and OpenStreetMap tiles
      "img-src 'self' data: blob: https://*.supabase.co https://*.supabase.in https://www.googletagmanager.com https://www.google-analytics.com https://*.line-scdn.net https://*.tile.openstreetmap.org",
      "font-src 'self' data:",
      // Allow API calls to Supabase and Google Analytics collection endpoints.
      "connect-src 'self' https://*.supabase.co https://*.supabase.in https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://api.line.me https://liff.line.me https://*.line-scdn.net https://nominatim.openstreetmap.org",
      // Allow local compression workers without allowing external worker scripts.
      "worker-src 'self' blob:",
      // Allow trusted iframe embeds such as Google Maps on the storefront
      "frame-src 'self' https://www.google.com https://maps.google.com",
      // Allow embedding only from same origin (for iframe print from admin)
      "frame-ancestors 'self'",
      // Restrict base tag hijacking
      "base-uri 'self'",
      // Restrict form submissions to same origin
      "form-action 'self'",
    ].join("; "),
  },
];

// Only invoke the analyzer wrapper when explicitly requested. Calling it on every
// build (even when disabled) has been observed to break Vercel's modifyConfig step
// when @next/bundle-analyzer and next versions are out of sync.
const withBundleAnalyzer =
  process.env.ANALYZE === "true"
    ? bundleAnalyzer({ enabled: true, openAnalyzer: false })
    : <T,>(config: T): T => config;

const nextConfig: NextConfig = {
  // Remove X-Powered-By header (hides tech stack from attackers)
  poweredByHeader: false,

  experimental: {
    // Vercel Pro supports more CPU resources during build — increased from 1.
    cpus: 4,
    webpackMemoryOptimizations: true,
    serverActions: {
      // Keep server action payloads tight to protect upload performance.
      bodySizeLimit: "3mb",
    },
    // Vercel Pro can handle higher prerender concurrency without pool exhaustion.
    staticGenerationRetryCount: 2,
    staticGenerationMaxConcurrency: 4,
    staticGenerationMinPagesPerWorker: 40,
    // Enable instrumentation hook for background services (cron jobs, etc.)
    // @ts-expect-error — instrumentationHook is valid in Next.js 15.1+
    instrumentationHook: true,
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },

  async redirects() {
    return [
      {
        source: "/:path*",
        has: [
          {
            type: "host",
            value: "sriwanparts.com",
          },
        ],
        destination: "https://www.sriwanparts.com/:path*",
        permanent: true,
        basePath: false,
      },
    ];
  },

  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 2678400,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
      {
        protocol: "https",
        hostname: "*.supabase.in",
      },
    ],
  },
};

export default withBundleAnalyzer(nextConfig);
