/**
 * Request-level bot detection for product-search telemetry.
 *
 * Complements lib/search-noise.ts (which inspects the *query text*). Here we
 * inspect the request User-Agent so crawler / scraper traffic can be flagged
 * and excluded from the no-result quality report by default — keeping the
 * KPIs focused on genuine human misses.
 *
 * Deliberately conservative: only well-known crawler / automation tokens are
 * matched. A blank UA is treated as a bot (real browsers always send one).
 */

// Common crawler, scraper, automation and preview-fetcher tokens. Matched
// case-insensitively against the raw User-Agent string.
const BOT_UA_PATTERN =
  /(bot|crawl|spider|slurp|mediapartners|bingpreview|headless|phantomjs|puppeteer|playwright|selenium|python-requests|aiohttp|httpclient|okhttp|java\/|go-http|libwww|curl|wget|scrapy|ahrefs|semrush|mj12|dotbot|petalbot|dataforseo|facebookexternalhit|whatsapp|telegrambot|discordbot|preview|monitor|uptime|pingdom|lighthouse|gtmetrix)/i;

/**
 * Returns true when the User-Agent looks like a bot / automation client.
 * An empty or missing UA is treated as a bot.
 */
export const isLikelyBotUserAgent = (userAgent: string | null | undefined): boolean => {
  const ua = userAgent?.trim();
  if (!ua) return true;
  return BOT_UA_PATTERN.test(ua);
};
