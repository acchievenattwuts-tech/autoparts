import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { revalidateStorefrontCaches } from "@/lib/storefront-revalidation";

const getRouteSecret = () => process.env.REVALIDATE_SECRET ?? process.env.NEXTAUTH_SECRET ?? "";

const isAuthorized = (providedSecret: string) => {
  const routeSecret = getRouteSecret();
  if (!routeSecret || !providedSecret) {
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

  await revalidateStorefrontCaches(body.categoryId);

  return NextResponse.json({
    ok: true,
    revalidatedAt: new Date().toISOString(),
    categoryId: body.categoryId ?? null,
  });
}
