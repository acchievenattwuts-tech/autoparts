import { after } from "next/server";

import { isLikelyNoiseQuery } from "@/lib/search-noise";
import { normalizeSearchText } from "@/lib/search-normalization";

type ProductSearchTelemetryInput = {
  query?: string | null;
  isActive?: boolean;
  isStorefrontVisible?: boolean;
  categoryName?: string | null;
  categoryId?: string | null;
  brandId?: string | null;
  carBrandId?: string | null;
  carModelId?: string | null;
  carBrandName?: string | null;
  carModelName?: string | null;
  carModelNames?: string[] | null;
  fitmentYear?: number | null;
  skip?: number;
  take?: number;
  order?: string | null;
};

/**
 * Where the search came from. `line` / `messenger` were added so CHAT traffic
 * feeds the same no-result quality report the storefront already feeds — until
 * then the report only ever saw storefront + admin searches, while chat (the
 * shop's busiest channel) was invisible to it and its misses were never reviewed.
 * The column is used as a filter everywhere, so the existing reports can still be
 * read per channel.
 */
type ProductSearchLogSource = "storefront" | "admin" | "line" | "messenger";

type ProductSearchLogInputArgs = {
  input: ProductSearchTelemetryInput;
  resultCount: number;
  source: ProductSearchLogSource;
  path: string;
  isBot?: boolean;
  /**
   * How the write is scheduled.
   *  - `"after"` (default) defers via `next/server`'s `after()`, keeping it off the
   *    response path. Requires a request scope.
   *  - `"await"` writes inline. Used by the chat pipeline, which runs inside a
   *    queue worker / coalescing loop where a request scope is not guaranteed —
   *    there `after()` throws and the row would be silently dropped.
   */
  flush?: "after" | "await";
};

const MAX_QUERY_LENGTH = 200;
const MAX_PATH_LENGTH = 200;
const MAX_FILTER_VALUE_LENGTH = 100;
const MAX_DEDUPE_KEY_LENGTH = 280;
const DEDUPE_BUCKET_MS = 60 * 60 * 1000;
export const LOW_RESULT_SEARCH_THRESHOLD = 3;

export const buildProductSearchDedupeKey = ({
  query,
  source,
  at,
  isBot = false,
}: {
  query: string;
  source: ProductSearchLogSource;
  at: Date;
  isBot?: boolean;
}): string => {
  const normalized = normalizeSearchText(query);
  if (!normalized) return "";
  const bucket = Math.floor(at.getTime() / DEDUPE_BUCKET_MS);
  // Keep bot and human hits of the same query in separate rows so the bot flag
  // is never overwritten by an upsert across the two traffic kinds.
  return `${normalized}|${source}|${isBot ? "b1" : "b0"}|${bucket}`.slice(0, MAX_DEDUPE_KEY_LENGTH);
};

const cleanText = (value: string | null | undefined, maxLength = MAX_FILTER_VALUE_LENGTH): string | undefined => {
  const normalized = value?.trim().replace(/\s+/g, " ");
  if (!normalized) return undefined;
  return normalized.slice(0, maxLength);
};

const cleanNumber = (value: number | null | undefined): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const cleanBoolean = (value: boolean | undefined): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

export const shouldLogProductSearchTelemetry = ({
  input,
  resultCount,
}: Pick<ProductSearchLogInputArgs, "input" | "resultCount">): boolean =>
  resultCount >= 0 &&
  resultCount <= LOW_RESULT_SEARCH_THRESHOLD &&
  Boolean(cleanText(input.query, MAX_QUERY_LENGTH)) &&
  // Skip bot / keyboard-mashing / foreign-spam queries so the no-result quality
  // report reflects genuine customer misses, not noise.
  !isLikelyNoiseQuery(input.query);

export const buildProductSearchLogInput = ({
  input,
  resultCount,
  source,
  path,
  isBot = false,
}: ProductSearchLogInputArgs) => {
  const query = cleanText(input.query, MAX_QUERY_LENGTH) ?? "";
  const filters = Object.fromEntries(
    Object.entries({
      isActive: cleanBoolean(input.isActive),
      isStorefrontVisible: cleanBoolean(input.isStorefrontVisible),
      categoryName: cleanText(input.categoryName),
      categoryId: cleanText(input.categoryId),
      brandId: cleanText(input.brandId),
      carBrandId: cleanText(input.carBrandId),
      carModelId: cleanText(input.carModelId),
      carBrandName: cleanText(input.carBrandName),
      carModelName: cleanText(input.carModelName),
      carModelNames: input.carModelNames
        ?.map((item) => cleanText(item))
        .filter((item): item is string => Boolean(item)),
      fitmentYear: cleanNumber(input.fitmentYear),
      skip: cleanNumber(input.skip),
      take: cleanNumber(input.take),
      order: cleanText(input.order),
    }).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined;
    }),
  );

  return {
    query,
    filters,
    resultCount,
    source,
    path: cleanText(path, MAX_PATH_LENGTH) ?? "",
    isBot,
  };
};

export async function logProductSearchTelemetry(args: ProductSearchLogInputArgs): Promise<void> {
  if (!shouldLogProductSearchTelemetry(args)) return;

  try {
    const { db } = await import("@/lib/db");
    const data = buildProductSearchLogInput(args);
    const now = new Date();
    const dedupeKey = buildProductSearchDedupeKey({
      query: data.query,
      source: args.source,
      at: now,
      isBot: data.isBot,
    });

    // Off the response path, but still guaranteed to run. A bare `void promise`
    // used to leak the write past the response: Vercel freezes the instance the
    // moment the response is flushed, so an upsert still in flight was dropped
    // and the search log silently under-counted. `after()` keeps the request
    // alive until the callback settles, so telemetry stops losing rows without
    // adding anything to what the user waits for.
    //
    // Every caller is a Server Component, Route Handler or Server Action, which
    // is what `after()` requires. If it is ever called outside a request scope
    // it throws — caught below, same as any other telemetry failure.
    //
    // Repeated identical searches inside the same hourly bucket upsert into a
    // single row (incrementing hitCount) instead of bloating the table.
    const write = async (): Promise<void> => {
      try {
        await db.productSearchLog.upsert({
          where: { dedupeKey },
          create: { ...data, dedupeKey, hitCount: 1 },
          update: {
            resultCount: data.resultCount,
            filters: data.filters,
            path: data.path,
            hitCount: { increment: 1 },
          },
        });
      } catch (error) {
        console.error("Product search telemetry logging failed.", error);
      }
    };

    if (args.flush === "await") {
      await write();
      return;
    }

    after(write);
  } catch (error) {
    console.error("Product search telemetry logging failed.", error);
  }
}
