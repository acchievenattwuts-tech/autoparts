import assert from "node:assert/strict";

import { db } from "@/lib/db";
import { filterProductSearchOptions } from "@/lib/product-search-select-presentation";
import {
  buildTransactionProductCatalog,
  getTransactionProductDetailRowsByIds,
  searchTransactionProductDetailRows,
  TRANSACTION_PRODUCT_SEARCH_LIMIT,
} from "@/lib/transaction-product-search";

const addCandidate = (target: Set<string>, value: string | null | undefined): void => {
  const normalized = value?.trim();
  if (!normalized || normalized.length < 3) return;
  target.add(normalized.slice(0, Math.min(normalized.length, 24)));
};

const buildQueryCorpus = (
  catalog: Awaited<ReturnType<typeof buildTransactionProductCatalog>>,
): string[] => {
  const queries = new Set<string>();

  for (const product of catalog) {
    addCandidate(queries, product.code);
    addCandidate(queries, product.name);
    addCandidate(queries, product.description);
    addCandidate(queries, product.categoryName);
    addCandidate(queries, product.brandName);
    for (const alias of product.aliasSearchText.split("\n")) addCandidate(queries, alias);
    if (queries.size >= 120) break;
  }

  // LIKE wildcards must remain literal to match String.includes in the browser.
  queries.add("%ab");
  queries.add("_ab");
  queries.add("\\ab");
  return [...queries];
};

async function main(): Promise<void> {
  const catalog = await buildTransactionProductCatalog();
  const queries = buildQueryCorpus(catalog);
  const mismatches: Array<{ query: string; local: string[]; remote: string[] }> = [];

  for (const query of queries) {
    const local = filterProductSearchOptions(
      catalog,
      query,
      TRANSACTION_PRODUCT_SEARCH_LIMIT,
    ).map((product) => product.id);
    const remote = (await searchTransactionProductDetailRows(query)).map((product) => product.id);
    if (JSON.stringify(local) !== JSON.stringify(remote)) {
      mismatches.push({ query, local, remote });
    }
  }

  assert.deepEqual(mismatches, [], `local/remote mismatches: ${JSON.stringify(mismatches, null, 2)}`);
  const hydrationIds = catalog.slice(0, 60).map((product) => product.id);
  const hydratedIds = (await getTransactionProductDetailRowsByIds(hydrationIds)).map((product) => product.id);
  assert.equal(hydratedIds.length, hydrationIds.length, "hydration must not truncate documents over 50 products");
  assert.deepEqual(new Set(hydratedIds), new Set(hydrationIds), "hydration returned different product IDs");
  console.log(
    JSON.stringify(
      {
        status: "passed",
        products: catalog.length,
        queries: queries.length,
        mismatches: mismatches.length,
        hydratedProducts: hydratedIds.length,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
