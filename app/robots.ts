import type { MetadataRoute } from "next";
import { SITE_URL, absoluteUrl } from "@/lib/seo";
import {
  AGGRESSIVE_BOT_USER_AGENTS,
  AI_ANSWER_BOT_ALLOW,
  AI_ANSWER_BOT_DISALLOW,
  AI_ANSWER_BOT_USER_AGENTS,
} from "@/lib/public-crawler-policy";

// บอทของ AI answer engine ที่เปิดให้เข้าอ่านเฉพาะหน้า hub เชิงเนื้อหา (AEO)
// โดยยังกันหน้ารายสินค้ารายตัว + รูป ซึ่งเป็นตัวกิน Supabase egress หลัก
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
      ...AI_ANSWER_BOT_USER_AGENTS.map((bot) => ({
        userAgent: bot,
        allow: [...AI_ANSWER_BOT_ALLOW],
        disallow: [...AI_ANSWER_BOT_DISALLOW],
        crawlDelay: AI_ANSWER_BOT_CRAWL_DELAY,
      })),
      ...AGGRESSIVE_BOT_USER_AGENTS.map((bot) => ({
        userAgent: bot,
        disallow: ["/"],
      })),
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE_URL,
  };
}
