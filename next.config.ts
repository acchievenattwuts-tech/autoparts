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
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
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
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com",
      // Tailwind uses inline styles
      "style-src 'self' 'unsafe-inline'",
      // Allow images from self, Supabase storage, and data URIs
      "img-src 'self' data: blob: https://*.supabase.co https://*.supabase.in",
      "font-src 'self' data:",
      // Allow API calls to Supabase and Google Analytics collection endpoints.
      "connect-src 'self' https://*.supabase.co https://*.supabase.in https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com",
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

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
  openAnalyzer: false,
});

const nextConfig: NextConfig = {
  // Remove X-Powered-By header (hides tech stack from attackers)
  poweredByHeader: false,

  experimental: {
    cpus: 1,
    serverActions: {
      // Keep server action payloads tight to protect upload performance.
      bodySizeLimit: "3mb",
    },
    // Keep prerender fan-out low enough for the current Supabase session pool during build.
    staticGenerationRetryCount: 1,
    staticGenerationMaxConcurrency: 1,
    staticGenerationMinPagesPerWorker: 80,
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
