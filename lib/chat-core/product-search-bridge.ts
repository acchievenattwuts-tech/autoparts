import { LineIntent } from "@/lib/generated/prisma";
import type { ChatIntentRouteResult } from "@/lib/chat-core/intent-router";
import { extractChatRequiredSearchTokens } from "@/lib/chat-core/search-guards";
import { normalizeInboundChatQuery } from "@/lib/chat-core/text-normalize";
import { extractProductSearchRequiredTokens } from "@/lib/product-search-required-tokens";
import {
  buildChatProductSpecRequiredTokenGroups,
  COOLING_FAN_BLADE_CATEGORY_HINT,
  extractChatProductIdentityConstraints,
  resolveChatProductSpecs,
} from "@/lib/chat-core/product-spec-resolve";

type ProductSearchInput = {
  query?: string | null;
  isActive?: boolean;
  isStorefrontVisible?: boolean;
  categoryName?: string | null;
  carBrandName?: string | null;
  carModelName?: string | null;
  fitmentYear?: number | null;
  requiredTokens?: string[] | null;
  requiredNameAliasTokenGroups?: string[][] | null;
  skip?: number;
  take?: number;
  cacheProfile?: "admin" | "storefront";
};
type ProductSearchOutput = {
  ids: string[];
  total: number;
  mode: "v2" | "fallback";
  matchReasons?: Record<string, string[]>;
  /** True when results came from the engine's broad OR recall (precise AND
   *  matched nothing) — every row matched only PART of the query. Surfaced so
   *  the chat reply can warn the customer these are near-matches. */
  usedBroadFallback?: boolean;
  /** Product ids whose best lexical trigram similarity reached the chat "strong"
   *  threshold — the relevance gate uses this to allow a category-less near-match
   *  through when the customer's text is genuinely close. */
  highTrigramProductIds?: string[];
  /** Deterministic customer-grounded physical constraints applied by chat only. */
  appliedConstraintKeys?: string[];
};
type ProductSearchFn = (input: ProductSearchInput) => Promise<ProductSearchOutput>;

export type ChatProductSearchBridgeInput = {
  route: ChatIntentRouteResult;
  /**
   * The customer's latest product text before an AI/inquiry-frame rewrite.
   * Keep this separate from `text`: `text` is the effective catalog query and may
   * legitimately be rebuilt from structured context, while customerText is the
   * source of truth for customer-grounded codes/specs that must never be dropped.
   */
  customerText?: string | null;
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
      /** Set ONLY when the customer supplied a car year, the year hard-filter found
       *  nothing, and the recovery search could offer rows from OTHER model years
       *  only. The caller MUST say plainly that the requested year was not found and
       *  that these are different-year alternatives — never restate the customer's
       *  year over these rows (see the 1996 City incident, 2026-08-01). Null when the
       *  shown rows do cover the requested year (or no year was given). */
      yearMismatch?: { requestedYear: number } | null;
      /** True when an accessory/universal search only succeeded after the carried
       *  vehicle filters were dropped (see the rescue in the search body). Surfaced
       *  for the audit trail so the rescue rate is measurable. */
      accessoryVehicleDropped?: boolean;
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
  /** ราคาสมาชิก (Product.memberPrice) — ใช้เลือกราคาตามระดับราคาของลูกค้า */
  memberPrice: number;
  /** Catalog fitment evidence used by the chat compatibility guard. */
  fitments?: Array<{
    carBrandName: string | null;
    carModelName: string | null;
    submodel: string | null;
    engineSize: string | null;
    note: string | null;
  }>;
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
    select: {
      id: true,
      name: true,
      code: true,
      imageUrl: true,
      salePrice: true,
      retailPrice: true,
      memberPrice: true,
      carModels: {
        orderBy: [{ carModel: { name: "asc" } }, { yearStart: "asc" }, { id: "asc" }],
        select: {
          submodel: true,
          engineSize: true,
          note: true,
          carModel: {
            select: {
              name: true,
              carBrand: { select: { name: true } },
            },
          },
        },
      },
    },
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
      memberPrice: Number(row.memberPrice),
      fitments: row.carModels.map((fitment) => ({
        carBrandName: fitment.carModel.carBrand.name,
        carModelName: fitment.carModel.name,
        submodel: fitment.submodel,
        engineSize: fitment.engineSize,
        note: fitment.note,
      })),
    }));
}

/** ระดับราคาที่ใช้เลือกราคาแสดงในแชท (ตาม CustomerType.priceTier)
 *  - UNKNOWN = resolve ระดับราคาไม่ได้ (เช่น DB สะดุด) → ซ่อนราคา ปลอดภัยกว่าเดาผิด tier */
export type ChatPriceTier = "UNLINKED" | "RETAIL" | "MEMBER" | "WHOLESALE" | "UNKNOWN";

/**
 * ข้อความต่อท้ายสำหรับลูกค้าที่ยังไม่ผูกบัญชีกับระบบร้าน — ราคาที่เห็นคือราคาขายปลีก
 * ซึ่งยังไม่ได้ลด ต้องบอกให้ชัดว่ายังมีราคาพิเศษรออยู่ ไม่ให้เข้าใจว่านี่คือราคาสุดท้าย
 * ส่งเป็น bubble สุดท้ายเสมอ (ยืนยันโดยเจ้าของร้าน 2026-07-19)
 */
export const UNLINKED_SPECIAL_PRICE_NOTE =
  "ราคานี้เป็นราคาปกติค่ะ 🙏 เดี๋ยวแอดมินมาแจ้งราคาพิเศษให้อีกทีนะคะ รอสักครู่ค่ะ";

/**
 * ใช้เมื่อการ์ดทุกใบยังไม่ได้ตั้งราคา (แสดง "สอบถามราคา") — พูดว่า "ราคานี้เป็นราคาปกติ"
 * ไม่ได้เพราะไม่มีตัวเลขให้อ้างถึง จะทำให้ลูกค้าสับสนว่าหมายถึงราคาไหน
 */
export const UNLINKED_NO_PRICE_NOTE = "เดี๋ยวแอดมินมาแจ้งราคาให้นะคะ รอสักครู่ค่ะ 🙏";

/**
 * เลือกข้อความแจ้งราคาพิเศษให้ตรงกับสิ่งที่ลูกค้าเห็นบนการ์ด
 * คืน null เมื่อไม่ต้องแนบข้อความ (ผูกบัญชีแล้ว / ไม่มีการ์ดสินค้า / resolve tier ไม่ได้)
 */
export function buildUnlinkedPriceNote(
  tier: ChatPriceTier,
  products: Array<{ salePrice: number }>,
): string | null {
  if (tier !== "UNLINKED" || products.length === 0) return null;
  const everyPriceHidden = products.every((product) => product.salePrice <= 0);
  return everyPriceHidden ? UNLINKED_NO_PRICE_NOTE : UNLINKED_SPECIAL_PRICE_NOTE;
}

/**
 * เลือกราคาแสดงในแชทตามระดับราคาของลูกค้า โดยเขียนทับ salePrice (ฟิลด์ราคาแสดงเดิม):
 * - RETAIL (ลูกค้าทั่วไปที่ผูกบัญชีแล้ว) → Product.retailPrice
 * - UNLINKED (ยังไม่ผูกบัญชี / บัญชีหรือประเภทถูกปิด) → Product.retailPrice เหมือน RETAIL
 *   ต่างกันแค่ระดับข้อความที่แนบท้าย (ดู buildUnlinkedPriceNote) ไม่ใช่ตัวเลขราคา
 * - MEMBER (ลูกค้าที่ผูกบัญชีแล้วและอยู่กลุ่ม "สมาชิก") → Product.memberPrice
 * - WHOLESALE (เช่น อู่ซ่อมรถ) → Product.salePrice (ราคาขายส่ง)
 * - UNKNOWN (resolve ระดับราคาไม่สำเร็จ) → 0 → แสดง "สอบถามราคา" เสมอ (ห้ามแสดงราคาผิด tier)
 * ราคา = 0 เป็น sentinel เดิมของระบบ → Flex การ์ดและข้อความ AI แสดง "สอบถามราคา" อัตโนมัติ
 * (สินค้าที่ยังไม่ตั้งราคาสมาชิกจึงแสดง "สอบถามราคา" ให้เอง ไม่ fallback ไป tier อื่น)
 */
export function applyChatPriceTier<
  T extends { salePrice: number; retailPrice: number; memberPrice: number },
>(products: T[], tier: ChatPriceTier): T[] {
  if (tier === "WHOLESALE") return products;
  // Price tier could not be resolved (transient DB failure at the call site): hide
  // every price behind "สอบถามราคา" rather than risk showing a wrong-tier price.
  if (tier === "UNKNOWN") return products.map((product) => ({ ...product, salePrice: 0 }));
  if (tier === "MEMBER") return products.map((product) => ({ ...product, salePrice: product.memberPrice }));
  return products.map((product) => ({ ...product, salePrice: product.retailPrice }));
}

const MAX_QUERY_LENGTH = 120;

// C1 (2026-07-17): cap the did-you-mean recovery at the top-N suggestions.
// Suggestions arrive ranked by trigram similarity (best first), so the tail
// entries rarely rescue a query — but each one costs a FULL extra search on a
// turn that is already the slowest in the pipeline (every retry runs only when
// everything before it found nothing). Applies to the chat retry loop only
// (LINE + Messenger via this bridge); storefront/admin "did you mean" chips
// call suggestDidYouMean directly and still show up to 3.
const DID_YOU_MEAN_MAX_RETRIES = 2;

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

/** Catalog fitment year windows per product id, used to re-check a recovery result
 *  against the year the customer actually asked for. Injectable for tests. */
export type FitmentYearWindow = { yearStart: number | null; yearEnd: number | null };
export type ResolveFitmentYearsFn = (
  productIds: string[],
) => Promise<Map<string, FitmentYearWindow[]>>;

const defaultResolveFitmentYears: ResolveFitmentYearsFn = async (productIds) => {
  const byProduct = new Map<string, FitmentYearWindow[]>();
  if (productIds.length === 0) return byProduct;
  const { db } = await import("@/lib/db");
  const rows = await db.productFitment.findMany({
    where: { productId: { in: productIds } },
    select: { productId: true, yearStart: true, yearEnd: true },
  });
  for (const row of rows) {
    const windows = byProduct.get(row.productId);
    const window = { yearStart: row.yearStart, yearEnd: row.yearEnd };
    if (windows) windows.push(window);
    else byProduct.set(row.productId, [window]);
  }
  return byProduct;
};

/**
 * True when a product's catalog fitment can plausibly cover `year`.
 *
 * Deliberately permissive in the two "no evidence" directions, because the goal is
 * to drop rows that are provably a DIFFERENT generation — not to invent a hard
 * compatibility verdict (the shop's rule is "ห้ามตัดสินแทนลูกค้า"):
 *  - a product with NO fitment rows at all is universal → always covers.
 *  - an open-ended window (yearStart with no yearEnd, e.g. "2006–") covers anything
 *    from yearStart on; a row with neither bound covers everything.
 */
const fitmentCoversYear = (windows: FitmentYearWindow[] | undefined, year: number): boolean => {
  if (!windows || windows.length === 0) return true;
  return windows.some(({ yearStart, yearEnd }) => {
    if (yearStart === null && yearEnd === null) return true;
    if (yearStart !== null && year < yearStart) return false;
    if (yearEnd !== null && year > yearEnd) return false;
    return true;
  });
};

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

/**
 * Re-applies the customer's car year to a recovery result that had to run without
 * the year hard-filter. Returns the year-covering subset when one exists (the year
 * is then genuinely honoured), otherwise the untouched result plus a mismatch flag
 * so the reply can present the rows as other-year alternatives instead of silently
 * answering the wrong year.
 */
async function applyRecoveryYearCheck(input: {
  result: ProductSearchOutput;
  requestedYear: number | null;
  resolveFitmentYearsFn: ResolveFitmentYearsFn;
}): Promise<{ result: ProductSearchOutput; yearMismatch: { requestedYear: number } | null }> {
  const { result, requestedYear, resolveFitmentYearsFn } = input;
  if (requestedYear === null || result.ids.length === 0) {
    return { result, yearMismatch: null };
  }

  // A lookup failure must never turn a usable recovery into a wrong-year claim:
  // treat "we could not verify the years" as a mismatch (the honest, cautious side).
  const fitmentYears = await resolveFitmentYearsFn(result.ids).catch(() => null);
  if (!fitmentYears) return { result, yearMismatch: { requestedYear } };

  const covering = result.ids.filter((id) => fitmentCoversYear(fitmentYears.get(id), requestedYear));
  if (covering.length === 0) return { result, yearMismatch: { requestedYear } };
  if (covering.length === result.ids.length) return { result, yearMismatch: null };

  return {
    result: { ...result, ids: covering, total: covering.length },
    yearMismatch: null,
  };
}

export async function searchChatProductInquiry(
  input: ChatProductSearchBridgeInput,
  searchFn?: ProductSearchFn,
  suggestFn?: SuggestFn,
  resolveCatalogCodesFn: ResolveCatalogCodesFn = defaultResolveCatalogCodes,
  resolveFitmentYearsFn: ResolveFitmentYearsFn = defaultResolveFitmentYears,
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
  const authoritativeCustomerText = normalizeInboundChatQuery(input.customerText ?? input.text);
  const customerSeed = [
    input.extractedPartNumber,
    authoritativeCustomerText,
    ...(input.contextHints ?? []),
  ]
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
  // Structured/AI query text may carry useful context, but customer-authored
  // details are authoritative. Reading both preserves e.g. a compact model code
  // or voltage even when an inquiry-frame topic shift rebuilt `text` to only the
  // canonical part name.
  const groundedSpecText = [authoritativeCustomerText, input.text].filter(Boolean).join(" ");
  const productSpecs = resolveChatProductSpecs(groundedSpecText);
  const fanSpecRequiredTokenGroups =
    baseFilters.categoryName?.includes(COOLING_FAN_BLADE_CATEGORY_HINT) &&
    productSpecs.categoryHint === COOLING_FAN_BLADE_CATEGORY_HINT
      ? buildChatProductSpecRequiredTokenGroups(productSpecs)
      : [];
  const identityConstraints = extractChatProductIdentityConstraints(groundedSpecText);
  const requiredTokenGroups = [
    ...fanSpecRequiredTokenGroups,
    ...identityConstraints.map((constraint) => constraint.variants),
  ];

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
    ...(requiredTokenGroups.length > 0 ? { requiredNameAliasTokenGroups: requiredTokenGroups } : {}),
    skip: 0,
    take: input.take ?? 5,
    cacheProfile: "storefront",
  });

  // Accessory rescue #1 — drop the VEHICLE, keep the head noun. A universal SKU
  // (น้ำยาล้างคอยล์, ฟองน้ำ, โอริง…) has no fitment rows at all, so ANY carried
  // brand/model/year filter forces the search to zero. The LINE inquiry frame keeps
  // the customer's car across a topic shift on purpose, and its vehicle-carryover
  // guard only fires when the turn carries a digit-bearing token — so a plain-word
  // ask ("มีน้ำยาล้างคอยล์ไหม") right after "หม้อน้ำ vios 2010" searched Vios+2010 and
  // came back empty, which the caller reports as "we don't stock this". Measured
  // against the live catalog: น้ำยาล้างคอยล์ 1 → 0, ฟองน้ำ 4 → 0, โอริง 68 → 1.
  //
  // Done as a retry-on-empty rather than stripping the filters up-front: a turn that
  // already found vehicle-scoped rows is never affected, so a fitment part the
  // classifier mislabelled as `universal` cannot lose its vehicle scope and start
  // showing another car's parts. The head-noun anchor still constrains every row,
  // and the caller's relevance gate still judges the result.
  let accessoryVehicleDropped = false;
  const vehicleScoped = Boolean(
    baseFilters.carBrandName || baseFilters.carModelName || baseFilters.fitmentYear !== null,
  );
  let effectiveFilters = baseFilters;
  if (result.total === 0 && accessoryHeadNoun && vehicleScoped) {
    const carlessFilters = {
      categoryName: baseFilters.categoryName,
      carBrandName: null,
      carModelName: null,
      fitmentYear: null,
    };
    const carless = await resolvedSearchFn({
      query,
      isActive: true,
      isStorefrontVisible: true,
      ...carlessFilters,
      ...(primaryRequiredTokens.length > 0 ? { requiredTokens: primaryRequiredTokens } : {}),
      ...(requiredTokenGroups.length > 0 ? { requiredNameAliasTokenGroups: requiredTokenGroups } : {}),
      skip: 0,
      take: input.take ?? 5,
      cacheProfile: "storefront",
    });
    if (carless.total > 0) {
      result = carless;
      effectiveFilters = carlessFilters;
      accessoryVehicleDropped = true;
    }
  }

  // Accessory rescue #2 — the strict head-noun search still found nothing (e.g. the
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
      ...(requiredTokenGroups.length > 0 ? { requiredNameAliasTokenGroups: requiredTokenGroups } : {}),
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
    for (const suggestion of suggestions.slice(0, DID_YOU_MEAN_MAX_RETRIES)) {
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
        ...(requiredTokenGroups.length > 0 ? { requiredNameAliasTokenGroups: requiredTokenGroups } : {}),
        skip: 0,
        take: input.take ?? 5,
        cacheProfile: "storefront",
      });

      if (retry.total > 0) {
        // The retry ran WITHOUT the year hard-filter, so its rows may belong to a
        // different generation than the customer asked for. Re-apply the year here
        // (option C): keep the year-covering rows when there are any — that is a
        // real answer, not a recovery caveat — and only fall back to the other-year
        // rows when nothing covers the year, flagged so the reply says so plainly.
        const { result: yearCheckedResult, yearMismatch } = await applyRecoveryYearCheck({
          result: retry,
          requestedYear: baseFilters.fitmentYear,
          resolveFitmentYearsFn,
        });

        return {
          searched: true,
          reason: `DID_YOU_MEAN:${normalizedSuggestion}${yearMismatch ? ":YEAR_MISMATCH" : ""}`,
          query: normalizedSuggestion,
          result: yearCheckedResult,
          needsMoreInfo: false,
          appliedFilters: yearMismatch ? retryFilters : { ...retryFilters, fitmentYear: baseFilters.fitmentYear },
          droppedImageCodes,
          didYouMean: {
            suggestion: normalizedSuggestion,
            // The retry always strips the year hard-filter (retryFilters.fitmentYear
            // = null); flag it when the customer supplied one AND the rows we ended up
            // showing do not cover it, so the caller re-asks for the year. When the
            // year-covering subset survived, the year IS honoured — no caveat needed.
            droppedYear: yearMismatch !== null,
          },
          yearMismatch,
        };
      }
    }
  }

  return {
    searched: true,
    reason: requiredTokenGroups.length > 0 && result.total === 0
      ? "SEARCHED_PRODUCT_SPEC_NO_MATCH"
      : fitmentPartHeadNoun && result.total === 0
      ? "SEARCHED_FITMENT_PART_NO_MATCH"
      : fitmentPartHeadNoun
        ? "SEARCHED_FITMENT_PART_ANCHORED"
        : accessoryVehicleDropped
          ? "SEARCHED_ACCESSORY_HEAD_ANCHORED_NO_VEHICLE"
          : accessoryHeadNoun && !accessoryHeadFallback
          ? "SEARCHED_ACCESSORY_HEAD_ANCHORED"
          : accessoryHeadFallback
            ? "SEARCHED_ACCESSORY_HEAD_FALLBACK"
            : "SEARCHED_PRODUCT_INQUIRY",
    query,
    result: identityConstraints.length > 0
      ? {
          ...result,
          appliedConstraintKeys: identityConstraints.map((constraint) => constraint.key),
        }
      : result,
    needsMoreInfo: result.total === 0 || result.ids.length === 0,
    // Mirrors the filters the SUCCESSFUL search actually used, so the "view all on
    // web" link lands on the same set the customer saw (the accessory rescue drops
    // the vehicle; re-adding it to the link would zero the storefront results).
    appliedFilters: effectiveFilters,
    droppedImageCodes,
    didYouMean: null,
    // Every path reaching here kept the year hard-filter, so the rows already cover
    // it. The one exception — the accessory rescue — drops the vehicle for UNIVERSAL
    // SKUs that carry no fitment rows at all, which no year can contradict.
    yearMismatch: null,
    accessoryVehicleDropped,
  };
}
