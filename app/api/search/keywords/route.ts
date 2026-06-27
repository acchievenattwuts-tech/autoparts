/**
 * Keyword-first autocomplete API (Shopee-style).
 *
 * GET /api/search/keywords?q=...
 *   - Public, ultra-light: ONE indexed prefix lookup on the pre-computed
 *     SearchKeyword table. No product scan, no transaction, no embedding — so the
 *     as-you-type dropdown stays in the single-digit-millisecond range regardless
 *     of catalog size.
 *   - The heavy V2 product search only runs once, on submit (storefront results
 *     page → searchProductsAction).
 */

import { NextResponse } from "next/server";
import { querySearchKeywords } from "@/lib/search-keyword-index";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 80;

const normalize = (raw: string | null): string => {
  if (!raw) return "";
  const trimmed = raw.trim();
  return trimmed.length > MAX_QUERY_LENGTH ? trimmed.slice(0, MAX_QUERY_LENGTH) : trimmed;
};

export const GET = async (request: Request): Promise<NextResponse> => {
  try {
    const url = new URL(request.url);
    const query = normalize(url.searchParams.get("q"));

    if (query.length < MIN_QUERY_LENGTH) {
      return NextResponse.json({ items: [] });
    }

    const items = await querySearchKeywords(query);
    return NextResponse.json(
      { items },
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=120" } },
    );
  } catch (error) {
    console.error("[search keywords] failed", error);
    return NextResponse.json({ items: [], error: "INTERNAL_ERROR" }, { status: 500 });
  }
};
