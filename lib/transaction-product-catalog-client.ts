"use client";

import type { TransactionProductCatalogItem } from "@/lib/transaction-product-search";

let catalog: TransactionProductCatalogItem[] | null = null;
let catalogPromise: Promise<TransactionProductCatalogItem[]> | null = null;

export const getLoadedTransactionProductCatalog = (): TransactionProductCatalogItem[] | null => catalog;

export const loadTransactionProductCatalog = (): Promise<TransactionProductCatalogItem[]> => {
  if (catalog) return Promise.resolve(catalog);
  if (catalogPromise) return catalogPromise;

  catalogPromise = fetch("/api/admin/transaction-product-catalog", {
    cache: "no-cache",
    credentials: "same-origin",
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`CATALOG_HTTP_${response.status}`);
      const payload = (await response.json()) as { products?: TransactionProductCatalogItem[] };
      if (!Array.isArray(payload.products)) throw new Error("CATALOG_INVALID_PAYLOAD");
      catalog = payload.products;
      return catalog;
    })
    .catch((error) => {
      catalogPromise = null;
      throw error;
    });

  return catalogPromise;
};
