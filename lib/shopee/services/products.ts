import { createShopeeClient } from "@/lib/shopee/client";
import { getValidShopAuth } from "@/lib/shopee/services/auth";

/**
 * Shopee item catalog fetch (Phase D — read-only mapping source).
 *
 * Pulls the shop's items so the admin can map them to internal products. This
 * NEVER writes stock or sales — it only reads Shopee's catalog. Stock comparison
 * and push are deferred to Phase G.
 *
 * Endpoints (Shopee Open Platform v2, shop-scoped GET):
 *   - /api/v2/product/get_item_list      → item_id[] (paged)
 *   - /api/v2/product/get_item_base_info → name / sku / has_model per item
 *   - /api/v2/product/get_model_list     → variations (model_id / model_sku)
 */

const ITEM_LIST_PATH = "/api/v2/product/get_item_list";
const ITEM_BASE_INFO_PATH = "/api/v2/product/get_item_base_info";
const MODEL_LIST_PATH = "/api/v2/product/get_model_list";

const ITEM_LIST_PAGE_SIZE = 100;
const BASE_INFO_CHUNK = 50;
const MAX_PAGES = 50; // safety cap (≤ 5000 items)
const MODEL_FETCH_CONCURRENCY = 5; // parallel get_model_list calls (cap burst vs latency)

export type ShopeeItemModel = {
  modelId: string;
  sku: string | null;
  name: string | null;
};

export type ShopeeItemSummary = {
  itemId: string;
  name: string;
  sku: string | null;
  hasModel: boolean;
  models: ShopeeItemModel[];
};

type ItemListResponse = {
  item?: Array<{ item_id?: number }>;
  has_next_page?: boolean;
  next_offset?: number;
};

type ItemBaseInfoResponse = {
  item_list?: Array<{
    item_id?: number;
    item_name?: string;
    item_sku?: string;
    has_model?: boolean;
  }>;
};

type ModelListResponse = {
  model?: Array<{
    model_id?: number;
    model_sku?: string;
    model_name?: string;
  }>;
};

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

async function fetchAllItemIds(
  client: ReturnType<typeof createShopeeClient>,
  auth: { accessToken: string; shopId: number },
): Promise<string[]> {
  const ids: string[] = [];
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await client.callShop<ItemListResponse>(ITEM_LIST_PATH, auth, {
      method: "GET",
      query: { offset, page_size: ITEM_LIST_PAGE_SIZE, item_status: "NORMAL" },
    });
    for (const entry of response.item ?? []) {
      if (typeof entry.item_id === "number") ids.push(String(entry.item_id));
    }
    if (!response.has_next_page || typeof response.next_offset !== "number") break;
    offset = response.next_offset;
  }

  return ids;
}

/** Runs `fn` over `items` with at most `limit` in flight (bounded concurrency). */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      await fn(items[current]);
    }
  });
  await Promise.all(workers);
}

/** Fetches and normalizes all NORMAL items (with variations) for a shop. */
export async function fetchShopeeItems(shopRecordId: string): Promise<ShopeeItemSummary[]> {
  const auth = await getValidShopAuth(shopRecordId);
  const client = createShopeeClient();

  const itemIds = await fetchAllItemIds(client, auth);
  if (itemIds.length === 0) return [];

  const summaries: ShopeeItemSummary[] = [];
  const needModels: ShopeeItemSummary[] = [];

  for (const idChunk of chunk(itemIds, BASE_INFO_CHUNK)) {
    const info = await client.callShop<ItemBaseInfoResponse>(ITEM_BASE_INFO_PATH, auth, {
      method: "GET",
      query: { item_id_list: idChunk.join(",") },
    });

    for (const item of info.item_list ?? []) {
      if (typeof item.item_id !== "number") continue;
      const itemId = String(item.item_id);
      const hasModel = item.has_model === true;
      const summary: ShopeeItemSummary = {
        itemId,
        name: item.item_name?.trim() || `Item ${itemId}`,
        sku: item.item_sku?.trim() || null,
        hasModel,
        models: [],
      };
      summaries.push(summary);
      if (hasModel) needModels.push(summary);
    }
  }

  // Fetch variation models with bounded concurrency (one call per item) instead
  // of one slow sequential round-trip per variation item.
  await mapWithConcurrency(needModels, MODEL_FETCH_CONCURRENCY, async (summary) => {
    const modelList = await client.callShop<ModelListResponse>(MODEL_LIST_PATH, auth, {
      method: "GET",
      query: { item_id: summary.itemId },
    });
    summary.models = (modelList.model ?? [])
      .filter((model): model is { model_id: number; model_sku?: string; model_name?: string } =>
        typeof model.model_id === "number",
      )
      .map((model) => ({
        modelId: String(model.model_id),
        sku: model.model_sku?.trim() || null,
        name: model.model_name?.trim() || null,
      }));
  });

  return summaries;
}
