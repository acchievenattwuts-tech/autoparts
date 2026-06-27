import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { revalidateProductSearchCache } from "@/lib/product-search-cache";
import { revalidateStorefrontCaches } from "@/lib/storefront-revalidation";

const getRouteSecret = (): string => {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) throw new Error("REVALIDATE_SECRET is not configured");
  return secret;
};

const isAuthorized = (providedSecret: string) => {
  let routeSecret: string;
  try {
    routeSecret = getRouteSecret();
  } catch {
    return false;
  }
  if (!providedSecret) {
    return false;
  }

  const provided = Buffer.from(providedSecret);
  const expected = Buffer.from(routeSecret);

  if (provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(provided, expected);
};

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const headerSecret = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const body = (await request.json().catch(() => ({}))) as { secret?: string; categoryId?: string };
  const providedSecret = headerSecret || body.secret || "";

  if (!isAuthorized(providedSecret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // revalidateStorefrontCaches already triggers the keyword-index refresh.
  await revalidateStorefrontCaches(body.categoryId);
  revalidateProductSearchCache();

  return NextResponse.json({
    ok: true,
    revalidatedAt: new Date().toISOString(),
    categoryId: body.categoryId ?? null,
  });
}
