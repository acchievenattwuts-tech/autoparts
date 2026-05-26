/**
 * Phase Q1 — Storefront + Admin product autocomplete API.
 *
 * GET /api/search/products/autocomplete?q=...
 *   - Public endpoint (storefront search bar + admin product list search input both use it).
 *   - Returns active products only.
 *   - Min query length 2 chars, max 8 results.
 *   - Uses the same V2 engine as full search (Phase A-E + synonyms).
 */

import { NextResponse } from "next/server";
import { searchProductIds } from "@/lib/product-search";
import { db } from "@/lib/db";
import { getProductPath } from "@/lib/product-slug";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 80;
const TAKE = 8;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;

type AutocompleteItem = {
  id: string;
  code: string;
  name: string;
  imageUrl: string | null;
  salePrice: number;
  inStock: boolean;
  reportUnitName: string;
  brand: string | null;
  category: string;
  /** Storefront product detail path (admin can use it too — admin's edit URL is built client-side). */
  href: string;
  /** Admin-only edit URL (always set; UI decides which to use). */
  adminHref: string;
};

const normalize = (raw: string | null): string => {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (trimmed.length > MAX_QUERY_LENGTH) return trimmed.slice(0, MAX_QUERY_LENGTH);
  return trimmed;
};

const clientIp = (request: Request): string => {
  const fwd = request.headers.get("x-forwarded-for") ?? "";
  return fwd.split(",")[0].trim() || "unknown";
};

export const GET = async (request: Request): Promise<NextResponse> => {
  try {
    const url = new URL(request.url);
    const query = normalize(url.searchParams.get("q"));

    if (query.length < MIN_QUERY_LENGTH) {
      return NextResponse.json({ items: [] });
    }

    const rate = checkRateLimit({
      key: `autocomplete:${clientIp(request)}`,
      limit: RATE_LIMIT_MAX_REQUESTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });
    if (!rate.ok) {
      return NextResponse.json(
        { items: [] },
        { status: 429, headers: { "Retry-After": String(Math.ceil((rate.resetAt - Date.now()) / 1000)) } },
      );
    }

    const result = await searchProductIds({
      query,
      isActive: true,
      take: TAKE,
      order: "createdAtDesc",
    });

    if (result.ids.length === 0) {
      return NextResponse.json(
        { items: [] },
        { headers: { "Cache-Control": "public, max-age=30, s-maxage=60" } },
      );
    }

    const products = await db.product.findMany({
      where: { id: { in: result.ids } },
      select: {
        id: true,
        slug: true,
        code: true,
        name: true,
        imageUrl: true,
        salePrice: true,
        stock: true,
        reportUnitName: true,
        category: { select: { name: true, slug: true } },
        brand: { select: { name: true } },
      },
    });

    // Preserve search ranking order
    const order = new Map(result.ids.map((id, idx) => [id, idx]));
    products.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

    const items: AutocompleteItem[] = products.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      imageUrl: p.imageUrl,
      salePrice: Number(p.salePrice),
      inStock: p.stock > 0,
      reportUnitName: p.reportUnitName,
      brand: p.brand?.name ?? null,
      category: p.category.name,
      href: getProductPath({ category: p.category, product: p }),
      adminHref: `/admin/products/${p.id}/edit`,
    }));

    return NextResponse.json(
      { items, totalCount: result.total },
      { headers: { "Cache-Control": "public, max-age=30, s-maxage=60" } },
    );
  } catch (error) {
    console.error("[product autocomplete] failed", error);
    return NextResponse.json({ items: [], error: "INTERNAL_ERROR" }, { status: 500 });
  }
};
