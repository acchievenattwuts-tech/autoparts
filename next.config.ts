import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV === "development";
const isDeploymentBuild = process.env.VERCEL === "1" || process.env.CI === "true";
const distDir = isDevelopment
  ? ".next-dev"
  : isDeploymentBuild
    ? ".next-build"
    : ".next-local-build";

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
      // Next.js requires unsafe-inline for hydration scripts
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      // Tailwind uses inline styles
      "style-src 'self' 'unsafe-inline'",
      // Allow images from self, Supabase storage, and data URIs
      "img-src 'self' data: blob: https://*.supabase.co https://*.supabase.in",
      "font-src 'self' data:",
      // Allow API calls to Supabase
      "connect-src 'self' https://*.supabase.co https://*.supabase.in",
      // Allow embedding only from same origin (for iframe print from admin)
      "frame-ancestors 'self'",
      // Restrict base tag hijacking
      "base-uri 'self'",
      // Restrict form submissions to same origin
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  distDir,
  // Remove X-Powered-By header (hides tech stack from attackers)
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },

  images: {
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

export default nextConfig;
