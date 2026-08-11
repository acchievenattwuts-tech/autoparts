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
  "CCBot",
  "Amazonbot",
  "Diffbot",
];

// บอทของ AI answer engine ที่เปิดให้เข้าอ่านเฉพาะหน้า hub เชิงเนื้อหา (AEO)
// โดยยังกันหน้ารายสินค้ารายตัว + รูป ซึ่งเป็นตัวกิน Supabase egress หลัก
const AI_ANSWER_BOTS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "anthropic-ai",
  "Claude-User",
  "PerplexityBot",
  "Google-Extended",
];

const AI_ANSWER_BOT_ALLOW = ["/", "/products", "/about", "/faq", "/knowledge", "/llms.txt"];

const AI_ANSWER_BOT_DISALLOW = [
  "/admin/",
  "/api/",
  "/_next/image",
  "/product/",
  "/products/*/*",
  "/products/search",
  "/home2",
  "/home3",
  "/home4",
];

const AI_ANSWER_BOT_CRAWL_DELAY = 30;

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
      ...AI_ANSWER_BOTS.map((bot) => ({
        userAgent: bot,
        allow: AI_ANSWER_BOT_ALLOW,
        disallow: AI_ANSWER_BOT_DISALLOW,
        crawlDelay: AI_ANSWER_BOT_CRAWL_DELAY,
      })),
      ...AGGRESSIVE_BOTS.map((bot) => ({
        userAgent: bot,
        disallow: ["/"],
      })),
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE_URL,
  };
}
