import { NextResponse } from "next/server";
import { getHomeNewArrivals } from "@/lib/storefront-home";
import { parseHomeNewArrivalsPage } from "@/lib/storefront-home-pagination";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = async (request: Request): Promise<NextResponse> => {
  const page = parseHomeNewArrivalsPage(new URL(request.url).searchParams.get("page"));

  if (page === null) {
    return NextResponse.json(
      { error: "INVALID_PAGE" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await getHomeNewArrivals(page);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[storefront new arrivals] failed", error);
    return NextResponse.json(
      { error: "INTERNAL_ERROR" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
};
