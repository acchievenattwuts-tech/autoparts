import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import { db } from "@/lib/db";
import { compressJsonForCache, decompressJsonFromCache } from "@/lib/json-cache-compression";
import { filterProductSearchOptions } from "@/lib/product-search-select-presentation";
import {
  buildTransactionProductCatalog,
  searchTransactionProductDetailRows,
  TRANSACTION_PRODUCT_SEARCH_LIMIT,
  type TransactionProductCatalogItem,
} from "@/lib/transaction-product-search";

const GATES_MS = {
  warmCatalogP95: 1_000,
  remoteFallbackP95: 250,
  localSearchP95: 10,
} as const;

const percentile = (values: readonly number[], ratio: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
};

const addCandidate = (target: Set<string>, value: string | null | undefined): void => {
  const normalized = value?.trim();
  if (!normalized || normalized.length < 3) return;
  target.add(normalized.slice(0, Math.min(normalized.length, 24)));
};

const buildQueryCorpus = (catalog: TransactionProductCatalogItem[], limit: number): string[] => {
  const queries = new Set<string>();
  for (const product of catalog) {
    addCandidate(queries, product.code);
    addCandidate(queries, product.name);
    addCandidate(queries, product.categoryName);
    addCandidate(queries, product.brandName);
    for (const alias of product.aliasSearchText.split("\n")) addCandidate(queries, alias);
    if (queries.size >= limit) break;
  }
  return [...queries].slice(0, limit);
};

async function main(): Promise<void> {
  const coldStart = performance.now();
  const catalog = await buildTransactionProductCatalog();
  const coldCatalogMs = performance.now() - coldStart;
  const compressed = await compressJsonForCache(catalog);
  const compressedBytes = Buffer.from(compressed, "base64").byteLength;

  const warmCatalogSamples: number[] = [];
  for (let index = 0; index < 30; index += 1) {
    const startedAt = performance.now();
    createHash("sha256").update(compressed).digest("base64url");
    const products = await decompressJsonFromCache<TransactionProductCatalogItem[]>(compressed);
    JSON.stringify({ products });
    warmCatalogSamples.push(performance.now() - startedAt);
  }

  const localQueries = buildQueryCorpus(catalog, 100);
  assert.ok(localQueries.length >= 25, "not enough product data for a representative local benchmark");
  const localSamples: number[] = [];
  for (let iteration = 0; iteration < 30; iteration += 1) {
    for (const query of localQueries) {
      const startedAt = performance.now();
      filterProductSearchOptions(catalog, query, TRANSACTION_PRODUCT_SEARCH_LIMIT);
      localSamples.push(performance.now() - startedAt);
    }
  }

  const remoteQueries = localQueries.slice(0, 25);
  await searchTransactionProductDetailRows(remoteQueries[0]);
  const remoteSamples: number[] = [];
  for (const query of remoteQueries) {
    const startedAt = performance.now();
    await searchTransactionProductDetailRows(query);
    remoteSamples.push(performance.now() - startedAt);
  }

  const result = {
    products: catalog.length,
    catalogCompressedBytes: compressedBytes,
    coldCatalogMs,
    warmCatalogP95Ms: percentile(warmCatalogSamples, 0.95),
    remoteFallbackP95Ms: percentile(remoteSamples, 0.95),
    localSearchP95Ms: percentile(localSamples, 0.95),
    samples: {
      warmCatalog: warmCatalogSamples.length,
      remoteFallback: remoteSamples.length,
      localSearch: localSamples.length,
    },
    gatesMs: GATES_MS,
  };

  console.log(JSON.stringify(result, null, 2));
  assert.ok(result.warmCatalogP95Ms <= GATES_MS.warmCatalogP95, "warm catalog p95 regressed");
  assert.ok(result.remoteFallbackP95Ms <= GATES_MS.remoteFallbackP95, "remote fallback p95 regressed");
  assert.ok(result.localSearchP95Ms <= GATES_MS.localSearchP95, "local search p95 regressed");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
