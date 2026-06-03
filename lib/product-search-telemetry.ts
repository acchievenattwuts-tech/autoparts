import { isLikelyNoiseQuery } from "@/lib/search-noise";
import { normalizeSearchText } from "@/lib/search-normalization";

type ProductSearchTelemetryInput = {
  query?: string | null;
  isActive?: boolean;
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

type ProductSearchLogSource = "storefront" | "admin";

type ProductSearchLogInputArgs = {
  input: ProductSearchTelemetryInput;
  resultCount: number;
  source: ProductSearchLogSource;
  path: string;
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
}: {
  query: string;
  source: ProductSearchLogSource;
  at: Date;
}): string => {
  const normalized = normalizeSearchText(query);
  if (!normalized) return "";
  const bucket = Math.floor(at.getTime() / DEDUPE_BUCKET_MS);
  return `${normalized}|${source}|${bucket}`.slice(0, MAX_DEDUPE_KEY_LENGTH);
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
}: ProductSearchLogInputArgs) => {
  const query = cleanText(input.query, MAX_QUERY_LENGTH) ?? "";
  const filters = Object.fromEntries(
    Object.entries({
      isActive: cleanBoolean(input.isActive),
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
    });

    // Fire-and-forget: telemetry must never block the search response.
    // Repeated identical searches inside the same hourly bucket upsert into a
    // single row (incrementing hitCount) instead of bloating the table.
    void db.productSearchLog
      .upsert({
        where: { dedupeKey },
        create: { ...data, dedupeKey, hitCount: 1 },
        update: {
          resultCount: data.resultCount,
          filters: data.filters,
          path: data.path,
          hitCount: { increment: 1 },
        },
      })
      .catch((error) => {
        console.error("Product search telemetry logging failed.", error);
      });
  } catch (error) {
    console.error("Product search telemetry logging failed.", error);
  }
}
