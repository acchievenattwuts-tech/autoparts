import type { MetadataRoute } from "next";
import { SITE_URL, absoluteUrl } from "@/lib/seo";

const AGGRESSIVE_BOTS = [
  "AhrefsBot",
  "SemrushBot",
  "MJ12bot",
  "DotBot",
  "PetalBot",
  "BLEXBot",
  "DataForSeoBot",
  "SeekportBot",
  "Bytespider",
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "ChatGPT-User",
  "CCBot",
  "Amazonbot",
  "Diffbot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/products", "/about", "/faq", "/knowledge"],
        disallow: [
          "/admin/",
          "/api/",
          "/_next/image",
          "/home2",
          "/home3",
          "/home4",
        ],
        crawlDelay: 10,
      },
      ...AGGRESSIVE_BOTS.map((bot) => ({
        userAgent: bot,
        disallow: ["/"],
      })),
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE_URL,
  };
}
