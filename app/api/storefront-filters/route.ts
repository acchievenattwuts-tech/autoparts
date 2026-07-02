import { NextResponse } from "next/server";
import { getStorefrontProductFilters } from "@/lib/storefront-catalog";

export const dynamic = "force-static";

export async function GET() {
  const filterData = await getStorefrontProductFilters();
  return NextResponse.json(filterData);
}
