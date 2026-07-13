import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  getAllPermissionKeys,
  hasPermissionAccess,
  type PermissionKey,
} from "@/lib/access-control";
import {
  buildQuickSearchGroups,
  queryAdminQuickSearchRows,
  type QuickSearchAccess,
} from "@/lib/admin-quick-search-query";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TAKE_PER_GROUP = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 80;

const normalize = (raw: string | null): string => {
  if (!raw) return "";
  const trimmed = raw.trim();
  return trimmed.length > MAX_QUERY_LENGTH ? trimmed.slice(0, MAX_QUERY_LENGTH) : trimmed;
};

const safeError = (message: string, status = 500) =>
  NextResponse.json({ error: message }, { status });

export const GET = async (request: Request): Promise<NextResponse> => {
  try {
    const session = await auth();
    if (!session?.user || session.user.sessionInvalid) return safeError("UNAUTHORIZED", 401);

    const role = session.user.role;
    const permissions =
      role === "ADMIN"
        ? getAllPermissionKeys()
        : ((session.user.permissions ?? []) as PermissionKey[]);

    const rate = await checkRateLimit({
      key: `quick-search:${session.user.id}`,
      limit: RATE_LIMIT_MAX_REQUESTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });
    if (!rate.ok) {
      return NextResponse.json(
        { error: "RATE_LIMITED" },
        { status: 429, headers: { "Retry-After": String(Math.ceil((rate.resetAt - Date.now()) / 1000)) } },
      );
    }

    const url = new URL(request.url);
    const query = normalize(url.searchParams.get("q"));
    const docOnly = url.searchParams.get("scope") === "docs";
    if (query.length < MIN_QUERY_LENGTH) return NextResponse.json({ groups: [] });

    const can = (key: PermissionKey) => hasPermissionAccess(role, permissions, key);
    const access: QuickSearchAccess = {
      sales: can("sales.view"),
      purchases: can("purchases.view"),
      purchaseReturns: can("purchase_returns.view"),
      creditNotes: can("credit_notes.view"),
      receipts: can("receipts.view"),
      supplierAdvances: can("supplier_advances.view"),
      supplierPayments: can("supplier_payments.view"),
      expenses: can("expenses.view"),
      warrantyClaims: can("warranty_claims.view"),
      products: can("products.view"),
      customers: can("customers.view"),
      suppliers: can("master.view"),
    };

    const rows = await queryAdminQuickSearchRows({ query, docOnly, access, take: TAKE_PER_GROUP });
    return NextResponse.json(
      { groups: buildQuickSearchGroups(rows) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[quick-search] failed", error);
    return safeError("INTERNAL_ERROR", 500);
  }
};
