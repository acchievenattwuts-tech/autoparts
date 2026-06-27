/**
 * Rebuilds the SearchKeyword index that powers the keyword-first autocomplete
 * dropdown (Shopee-style). Pulls terms from master data + product names +
 * synonyms + successful search logs. Safe to run any time — it is a full rebuild.
 *
 * In production it runs via Vercel Cron (see vercel.json) and is also triggered
 * after catalog/master mutations through the storefront revalidate hook; this
 * script is the manual / local equivalent.
 *
 * Run:  npm run refresh:search-keywords
 */
import { refreshSearchKeywordIndex } from "@/lib/search-keyword-index";

async function main() {
  const rows = await refreshSearchKeywordIndex();
  console.log(`SearchKeyword index rebuilt. Rows written: ${rows}`);
}

main()
  .catch((error) => {
    console.error("SearchKeyword index refresh failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void import("@/lib/db").then(({ db }) => db.$disconnect());
  });
