import { NextResponse } from "next/server";

import { getTransactionProductCatalogResponse } from "@/lib/transaction-product-search";
import { requireAnyPermission } from "@/lib/require-auth";

const CATALOG_PERMISSIONS = [
  "sales.create",
  "sales.update",
  "purchases.create",
  "purchases.update",
  "credit_notes.create",
  "credit_notes.update",
  "purchase_returns.create",
  "purchase_returns.update",
] as const;

const CACHE_HEADERS = {
  "Cache-Control": "private, no-cache",
  Vary: "Cookie",
} as const;

export async function GET(request: Request) {
  try {
    await requireAnyPermission([...CATALOG_PERMISSIONS]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : 403;
    return NextResponse.json(
      { error: status === 401 ? "Unauthorized" : "Forbidden" },
      { status, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const catalog = await getTransactionProductCatalogResponse();
  if (request.headers.get("if-none-match") === catalog.etag) {
    return new Response(null, {
      status: 304,
      headers: { ...CACHE_HEADERS, ETag: catalog.etag },
    });
  }

  return NextResponse.json(
    { products: catalog.products },
    { headers: { ...CACHE_HEADERS, ETag: catalog.etag } },
  );
}
