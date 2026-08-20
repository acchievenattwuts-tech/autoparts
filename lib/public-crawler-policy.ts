export const AGGRESSIVE_BOT_USER_AGENTS = [
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
] as const;

export const AI_ANSWER_BOT_USER_AGENTS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "anthropic-ai",
  "Claude-User",
  "PerplexityBot",
  "Google-Extended",
] as const;

export const AI_ANSWER_BOT_ALLOW = [
  "/",
  "/products",
  "/about",
  "/faq",
  "/knowledge",
  "/llms.txt",
] as const;

export const AI_ANSWER_BOT_DISALLOW = [
  "/admin/",
  "/api/",
  "/_next/image",
  "/product/",
  "/products/*/*",
  "/products/search",
  "/home2",
  "/home3",
  "/home4",
] as const;

const matchesUserAgent = (userAgent: string, names: readonly string[]) => {
  const normalized = userAgent.toLowerCase();
  return names.some((name) => normalized.includes(name.toLowerCase()));
};

export const isAggressiveBotUserAgent = (userAgent: string) =>
  matchesUserAgent(userAgent, AGGRESSIVE_BOT_USER_AGENTS);

export const isAiAnswerBotUserAgent = (userAgent: string) =>
  matchesUserAgent(userAgent, AI_ANSWER_BOT_USER_AGENTS);

export const isAiAnswerBotPathAllowed = (pathname: string) =>
  AI_ANSWER_BOT_ALLOW.includes(pathname as (typeof AI_ANSWER_BOT_ALLOW)[number]) ||
  pathname.startsWith("/knowledge/");
