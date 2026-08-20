import test from "node:test";
import assert from "node:assert/strict";

import {
  isAggressiveBotUserAgent,
  isAiAnswerBotPathAllowed,
  isAiAnswerBotUserAgent,
} from "@/lib/public-crawler-policy";

test("recognizes approved answer-engine bots separately from aggressive crawlers", () => {
  assert.equal(isAiAnswerBotUserAgent("Mozilla/5.0 compatible; GPTBot/1.2"), true);
  assert.equal(isAiAnswerBotUserAgent("ClaudeBot/1.0"), true);
  assert.equal(isAggressiveBotUserAgent("AhrefsBot/7.0"), true);
  assert.equal(isAggressiveBotUserAgent("Googlebot/2.1"), false);
});

test("allows answer-engine bots on trusted hubs and knowledge content", () => {
  for (const pathname of [
    "/",
    "/products",
    "/about",
    "/faq",
    "/knowledge",
    "/knowledge/how-to-find-parts",
    "/llms.txt",
  ]) {
    assert.equal(isAiAnswerBotPathAllowed(pathname), true, pathname);
  }
});

test("keeps answer-engine bots away from product details, search routes, and private areas", () => {
  for (const pathname of [
    "/products/search",
    "/products/compressor/example-product",
    "/product/example-product",
    "/admin",
    "/api/products",
    "/_next/image",
  ]) {
    assert.equal(isAiAnswerBotPathAllowed(pathname), false, pathname);
  }
});
