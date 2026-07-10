import { LineIntent } from "@/lib/generated/prisma";
import type { ChatIntentRouteResult } from "@/lib/chat-core/intent-router";
import { extractChatRequiredSearchTokens } from "@/lib/chat-core/search-guards";
import { extractProductSearchRequiredTokens } from "@/lib/product-search-required-tokens";

type ProductSearchInput = {
  query?: string | null;
  isActive?: boolean;
  isStorefrontVisible?: boolean;
  categoryName?: string | null;
  carBrandName?: string | null;
  carModelName?: string | null;
  fitmentYear?: number | null;
  requiredTokens?: string[] | null;
  skip?: number;
  take?: number;
  cacheProfile?: "admin" | "storefront";
};
type ProductSearchOutput = {
  ids: string[];
  total: number;
  mode: "v2" | "fallback";
  matchReasons?: Record<string, string[]>;
};
type ProductSearchFn = (input: ProductSearchInput) => Promise<ProductSearchOutput>;

export type ChatProductSearchBridgeInput = {
  route: ChatIntentRouteResult;
  text?: string | null;
  extractedPartNumber?: string | null;
  extractedImageHints?: string[] | null;
  /** Car/brand/year terms carried over from earlier turns (short-term memory). */
  contextHints?: string[] | null;
  fitmentHints?: {
    categoryName?: string | null;
    carBrandName?: string | null;
    carModelName?: string | null;
    fitmentYear?: number | null;
  } | null;
  /**
   * Head noun for a universal/accessory inquiry (e.g. "ฟองน้ำ", "โอริง"). Set by the
   * caller ONLY for accessory intents that resolve to no category. When present and
   * no category filter applies, it is required (soft-anchored) so the results stay
   * on-topic instead of drifting into other accessories that merely share generic
   * tokens ("แอร์"/"ตู้แอร์") or are semantic neighbours ("โฟม" tape). If the strict
   * search finds nothing, the requirement is dropped and the broad search runs — so
   * the worst case is identical to the previous behaviour. Fitment parts (which
   * resolve a category) never reach this path. */
  accessoryHeadNoun?: string | null;
  /**
   * Head noun for a SPECIFIC fitment part the customer named that resolved to NO
   * category (e.g. "เทอร์โมสตรัท" — no thermostat category/product exists). Without
   * an anchor the search drifts to model-only and returns unrelated parts of that
   * car ("show me a Vios thermostat" → random Vios compressor/radiator). When set
   * and no category filter applies, it is required (contains-matched against
   * name/alias/fitment text) so results must actually be that part. Unlike
   * {@link accessoryHeadNoun}, there is NO broaden-on-empty fallback: if nothing
   * matches, the search returns empty (needsMoreInfo) so the reply says "we don't
   * carry this yet" instead of listing unrelated parts. Never set together with
   * accessoryHeadNoun.
   */
  fitmentPartHeadNoun?: string | null;
  take?: number;
};

export type ChatProductSearchBridgeResult =
  | {
      searched: false;
      reason: string;
      query: null;
      result: null;
    }
  | {
      searched: true;
      reason: string;
      query: string;
      result: ProductSearchOutput;
      needsMoreInfo: boolean;
      /** The fitment filters actually applied to the successful search. Mirrored
       *  into the "view all on web" link so the storefront lands on the SAME set
       *  the customer saw — after a did-you-mean retry the year is dropped, so the
       *  link must reflect that (not the original frame's year). */
      appliedFilters: {
        categoryName: string | null;
        carBrandName: string | null;
        carModelName: string | null;
        fitmentYear: number | null;
      };
      /** Code-like tokens read from an image (OCR) that did NOT resolve to any
       *  product, so they were dropped from the query instead of zeroing the
       *  search. Non-empty → the OCR was unsure; surfaced for audit. */
      droppedImageCodes: string[];
      /** Set ONLY when the results came from a "did you mean" spelling/synonym
       *  recovery (the original query found nothing). The caller must tell the
       *  customer these are a best-guess correction — and that the year filter was
       *  dropped — so a corrected/year-stripped match never reads as an exact hit.
       *  Null on a normal (non-recovered) search. */
      didYouMean: { suggestion: string; droppedYear: boolean } | null;
    };

export type ChatMatchedProductSummary = {
  id: string;
  name: string;
  code: string | null;
  imageUrl: string | null;
  /** ราคาที่จะแสดงในแชท (หลังเลือกตามระดับราคาแล้ว) — 0 = "สอบถามราคา" */
  salePrice: number;
  /** ราคาขายปลีก (Product.retailPrice) — ใช้เลือกราคาตามระดับราคาของลูกค้า */
  retailPrice: number;
};

/**
 * Fetches summaries (id, name, code, image, price) for matched product ids,
 * preserving the search rank order. Values come straight from the catalog — never
 * fabricated — so the reply can show the customer what was actually found and link
 * to the real storefront pages (the canonical product URL embeds the id).
 */
export async function getChatProductSummaries(ids: string[]): Promise<ChatMatchedProductSummary[]> {
  if (ids.length === 0) return [];
  const { db } = await import("@/lib/db");
  const rows = await db.product.findMany({
    where: {
      id: { in: ids },
      isActive: true,
      isStorefrontVisible: true,
    },
    select: { id: true, name: true, code: true, imageUrl: true, salePrice: true, retailPrice: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids
    .map((id) => byId.get(id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      imageUrl: row.imageUrl,
      salePrice: Number(row.salePrice),
      retailPrice: Number(row.retailPrice),
    }));
}

/** ระดับราคาที่ใช้เลือกราคาแสดงในแชท (ตาม CustomerType.priceTier)
 *  - UNKNOWN = resolve ระดับราคาไม่ได้ (เช่น DB สะดุด) → ซ่อนราคา ปลอดภัยกว่าเดาผิด tier */
export type ChatPriceTier = "RETAIL" | "WHOLESALE" | "UNKNOWN";

/**
 * เลือกราคาแสดงในแชทตามระดับราคาของลูกค้า โดยเขียนทับ salePrice (ฟิลด์ราคาแสดงเดิม):
 * - RETAIL (ลูกค้าทั่วไป / ยังไม่ผูกบัญชี / ประเภทถูกปิด) → Product.retailPrice
 * - WHOLESALE (เช่น อู่ซ่อมรถ) → Product.salePrice (ราคาขายส่ง)
 * - UNKNOWN (resolve ระดับราคาไม่สำเร็จ) → 0 → แสดง "สอบถามราคา" เสมอ (ห้ามแสดงราคาผิด tier)
 * ราคา = 0 เป็น sentinel เดิมของระบบ → Flex การ์ดและข้อความ AI แสดง "สอบถามราคา" อัตโนมัติ
 */
export function applyChatPriceTier<T extends { salePrice: number; retailPrice: number }>(
  products: T[],
  tier: ChatPriceTier,
): T[] {
  if (tier === "WHOLESALE") return products;
  // Price tier could not be resolved (transient DB failure at the call site): hide
  // every price behind "สอบถามราคา" rather than risk showing a wrong-tier price.
  if (tier === "UNKNOWN") return products.map((product) => ({ ...product, salePrice: 0 }));
  return products.map((product) => ({ ...product, salePrice: product.retailPrice }));
}

const MAX_QUERY_LENGTH = 120;

function normalizeSearchSeed(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Builds the search query. An explicit part number wins outright (keep exact-code
 * matching precise). Otherwise combine the message text, vision hints, and carried-
 * over context terms into one query — token-deduped, order preserved, length capped
 * — which the V2 search ranks the same way the storefront handles full queries.
 */
function buildSearchQuery(input: ChatProductSearchBridgeInput): string | null {
  const partNumber = normalizeSearchSeed(input.extractedPartNumber);
  if (partNumber) return partNumber.slice(0, MAX_QUERY_LENGTH);

  const sources = [
    input.text,
    ...(input.extractedImageHints ?? []),
    ...(input.contextHints ?? []),
  ];

  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const source of sources) {
    const normalized = normalizeSearchSeed(source);
    if (!normalized) continue;
    for (const token of normalized.split(/\s+/)) {
      const key = token.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      tokens.push(token);
    }
  }

  if (tokens.length === 0) return null;
  return tokens.join(" ").slice(0, MAX_QUERY_LENGTH).trim() || null;
}

type SuggestFn = (query: string) => Promise<string[]>;

/** Resolves which code-like tokens actually exist in the catalog (product code /
 *  OEM / alias / name). Used to validate OCR-read part numbers from images before
 *  they shape the search. Injectable for tests. */
export type ResolveCatalogCodesFn = (codes: string[]) => Promise<string[]>;

const defaultResolveCatalogCodes: ResolveCatalogCodesFn = async (codes) => {
  if (codes.length === 0) return [];
  const { db } = await import("@/lib/db");
  const { Prisma } = await import("@/lib/generated/prisma");
  const rows = await db.$queryRaw<Array<{ code: string }>>(Prisma.sql`
    SELECT c.code
    FROM (
      ${Prisma.join(
        codes.map((code) => Prisma.sql`SELECT ${code}::text AS code`),
        " UNION ALL ",
      )}
    ) AS c
    WHERE EXISTS (
      SELECT 1 FROM product_search_documents psd
      INNER JOIN "Product" p ON p.id = psd.product_id
      WHERE psd.is_active = true
        AND p."isStorefrontVisible" = true
        AND (
          f_unaccent(lower(psd.product_code)) LIKE f_unaccent(lower('%' || c.code || '%'))
          OR f_unaccent(lower(psd.oem_text)) LIKE f_unaccent(lower('%' || c.code || '%'))
          OR f_unaccent(lower(psd.alias_text)) LIKE f_unaccent(lower('%' || c.code || '%'))
          OR f_unaccent(lower(psd.product_name)) LIKE f_unaccent(lower('%' || c.code || '%'))
        )
    )
  `);
  return rows.map((row) => row.code);
};

/** Public handle to the catalog-code resolver (validates code-like tokens against
 *  product code / OEM / alias / name). Exposed so the LINE processor can run the
 *  product-code fast-path — resolving a customer-typed / image-OCR'd code straight
 *  to its product — before the completeness gate. Injectable for tests. */
export const resolveCatalogCodes: ResolveCatalogCodesFn = defaultResolveCatalogCodes;

/** A token is "code-like" when it carries a digit and ≥3 chars (e.g. STB-2116S,
 *  2903E) — the same heuristic the search uses to treat a token as a part-code
 *  anchor. Plain words (แผงแอร์, vios) are never code-like. */
const isCodeLikeToken = (token: string): boolean =>
  extractProductSearchRequiredTokens(token).length > 0;

export async function searchChatProductInquiry(
  input: ChatProductSearchBridgeInput,
  searchFn?: ProductSearchFn,
  suggestFn?: SuggestFn,
  resolveCatalogCodesFn: ResolveCatalogCodesFn = defaultResolveCatalogCodes,
): Promise<ChatProductSearchBridgeResult> {
  const searchableIntent =
    input.route.intent === LineIntent.PRODUCT_INQUIRY_TEXT ||
    input.route.intent === LineIntent.PART_IMAGE_INQUIRY;

  if (!input.route.allowsSearch || !searchableIntent) {
    return {
      searched: false,
      reason: `NON_SEARCHABLE_INTENT_${input.route.intent}`,
      query: null,
      result: null,
    };
  }

  // OCR safety: code-like hints read from an image (e.g. the number printed on a
  // part) are error-prone. Validate them against the catalog and DROP any that
  // resolve to nothing — an OCR misread must never zero out the search (a single
  // unmatched code token turns the precise AND query into 0 results, or blows the
  // OR fallback up to the whole catalog). Word hints (part type, brand, model)
  // always pass through. Customer-typed text is trusted and never validated here.
  const rawImageHints = (input.extractedImageHints ?? []).filter(Boolean);
  const imageCodeHints = rawImageHints.filter(isCodeLikeToken);
  const resolvedImageCodes =
    imageCodeHints.length > 0
      ? new Set(await resolveCatalogCodesFn(imageCodeHints).catch(() => []))
      : new Set<string>();
  const droppedImageCodes = imageCodeHints.filter((code) => !resolvedImageCodes.has(code));
  const safeImageHints = rawImageHints.filter((hint) => !droppedImageCodes.includes(hint));

  const query = buildSearchQuery({ ...input, extractedImageHints: safeImageHints });
  if (!query) {
    return {
      searched: false,
      reason: "NO_SEARCH_QUERY",
      query: null,
      result: null,
    };
  }

  // Required tokens (hard recall anchors) come only from CUSTOMER-typed sources —
  // never from image OCR hints. A code the customer typed is intentional; a code
  // an image reader guessed is not, so it must stay a soft signal at most.
  const customerSeed = [input.extractedPartNumber, input.text, ...(input.contextHints ?? [])]
    .filter(Boolean)
    .join(" ");
  const requiredTokens = extractChatRequiredSearchTokens(customerSeed);

  const resolvedSearchFn =
    searchFn ??
    (async (searchInput: ProductSearchInput) => {
      const { searchProductIds } = await import("@/lib/product-search");
      return searchProductIds(searchInput);
    });

  const baseFilters = {
    categoryName: input.fitmentHints?.categoryName ?? null,
    carBrandName: input.fitmentHints?.carBrandName ?? null,
    carModelName: input.fitmentHints?.carModelName ?? null,
    fitmentYear: input.fitmentHints?.fitmentYear ?? null,
  };

  // Accessory precision anchor: for a universal/accessory inquiry with NO category
  // filter, require the head noun (e.g. "ฟองน้ำ") so results must actually be that
  // kind of item — not tape/duct/drier that only share "แอร์"/"ตู้แอร์" or are
  // semantic neighbours. Gated on the absence of a category filter, so fitment
  // parts are never affected. Matched via the standard requiredTokens mechanism,
  // which also checks alias_text (so an English-only alias like "foam strip"
  // still counts).
  const accessoryHeadNoun =
    !baseFilters.categoryName ? normalizeSearchSeed(input.accessoryHeadNoun) : null;

  // Fitment-part precision anchor: a SPECIFIC part the customer named that resolved
  // to no category. Required in EVERY search (primary + did-you-mean retry) and,
  // unlike the accessory anchor, never dropped — a specific part that isn't in the
  // catalog must return empty, not drift to model-only unrelated parts.
  const fitmentPartHeadNoun =
    !baseFilters.categoryName && !accessoryHeadNoun ? normalizeSearchSeed(input.fitmentPartHeadNoun) : null;
  // Anchor kept through the did-you-mean retry too (persistent).
  const persistentRequiredTokens = fitmentPartHeadNoun
    ? [...requiredTokens, fitmentPartHeadNoun]
    : requiredTokens;
  const primaryRequiredTokens = accessoryHeadNoun
    ? [...persistentRequiredTokens, accessoryHeadNoun]
    : persistentRequiredTokens;

  let result = await resolvedSearchFn({
    query,
    isActive: true,
    isStorefrontVisible: true,
    ...baseFilters,
    ...(primaryRequiredTokens.length > 0 ? { requiredTokens: primaryRequiredTokens } : {}),
    skip: 0,
    take: input.take ?? 5,
    cacheProfile: "storefront",
  });

  // Graceful fallback: the strict head-noun search found nothing (e.g. the
  // customer's word differs from the catalog wording). Drop the head-noun anchor
  // and rerun the broad search — the worst case is exactly the previous behaviour,
  // never a wrong "not found". Applies ONLY to the accessory anchor; the fitment
  // anchor deliberately has no broaden fallback (see fitmentPartHeadNoun).
  let accessoryHeadFallback = false;
  if (result.total === 0 && accessoryHeadNoun) {
    accessoryHeadFallback = true;
    result = await resolvedSearchFn({
      query,
      isActive: true,
      isStorefrontVisible: true,
      ...baseFilters,
      ...(persistentRequiredTokens.length > 0 ? { requiredTokens: persistentRequiredTokens } : {}),
      skip: 0,
      take: input.take ?? 5,
      cacheProfile: "storefront",
    });
  }

  // No hits → try a "did you mean" spelling/synonym correction and re-search once.
  if (result.total === 0) {
    const resolvedSuggestFn =
      suggestFn ??
      (async (rawQuery: string) => {
        const { suggestDidYouMean } = await import("@/lib/product-search");
        return suggestDidYouMean(rawQuery);
      });

    const suggestions = await resolvedSuggestFn(query).catch(() => []);
    for (const suggestion of suggestions) {
      const normalizedSuggestion = normalizeSearchSeed(suggestion);
      if (!normalizedSuggestion || normalizedSuggestion.toLowerCase() === query.toLowerCase()) continue;

      // Keep the detected category/brand/model so the recovery stays on-topic
      // (don't widen into unrelated categories). Drop the YEAR only: the year
      // hard-filter is what zeroed the first search, and the suggestion may imply
      // a different model year than the customer's shorthand.
      const retryFilters = { ...baseFilters, fitmentYear: null };
      const retry = await resolvedSearchFn({
        query: normalizedSuggestion,
        isActive: true,
        isStorefrontVisible: true,
        ...retryFilters,
        // Keep the fitment-part anchor through the spelling retry so a "did you
        // mean" can't drift the recovery into unrelated same-car parts.
        ...(persistentRequiredTokens.length > 0 ? { requiredTokens: persistentRequiredTokens } : {}),
        skip: 0,
        take: input.take ?? 5,
        cacheProfile: "storefront",
      });

      if (retry.total > 0) {
        return {
          searched: true,
          reason: `DID_YOU_MEAN:${normalizedSuggestion}`,
          query: normalizedSuggestion,
          result: retry,
          needsMoreInfo: false,
          appliedFilters: retryFilters,
          droppedImageCodes,
          didYouMean: {
            suggestion: normalizedSuggestion,
            // The retry always strips the year hard-filter (retryFilters.fitmentYear
            // = null); flag it when the customer actually supplied one, so the caller
            // can add a "year not confirmed" note + re-ask for the year.
            droppedYear: baseFilters.fitmentYear !== null,
          },
        };
      }
    }
  }

  return {
    searched: true,
    reason: fitmentPartHeadNoun && result.total === 0
      ? "SEARCHED_FITMENT_PART_NO_MATCH"
      : fitmentPartHeadNoun
        ? "SEARCHED_FITMENT_PART_ANCHORED"
        : accessoryHeadNoun && !accessoryHeadFallback
          ? "SEARCHED_ACCESSORY_HEAD_ANCHORED"
          : accessoryHeadFallback
            ? "SEARCHED_ACCESSORY_HEAD_FALLBACK"
            : "SEARCHED_PRODUCT_INQUIRY",
    query,
    result,
    needsMoreInfo: result.total === 0 || result.ids.length === 0,
    appliedFilters: baseFilters,
    droppedImageCodes,
    didYouMean: null,
  };
}
