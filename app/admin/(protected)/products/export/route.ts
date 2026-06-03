export const dynamic = "force-dynamic";

import {
  getAuditActorFromSession,
  getRequestContextFromHeaders,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { AuditAction } from "@/lib/generated/prisma";
import { requirePermission } from "@/lib/require-auth";
import {
  buildProductReportCsv,
  parseProductReportFilters,
  queryProductReportRows,
} from "@/lib/product-report-queries";

export async function GET(request: Request) {
  const session = await requirePermission("products.view");
  const requestContext = getRequestContextFromHeaders(request.headers);
  const { searchParams } = new URL(request.url);

  const params: Record<string, string | undefined> = {
    search: searchParams.get("search") ?? undefined,
    categoryId: searchParams.get("categoryId") ?? undefined,
    brandId: searchParams.get("brandId") ?? undefined,
    carBrandId: searchParams.get("carBrandId") ?? undefined,
    carModelId: searchParams.get("carModelId") ?? undefined,
    priceMin: searchParams.get("priceMin") ?? undefined,
    priceMax: searchParams.get("priceMax") ?? undefined,
    stockStatus: searchParams.get("stockStatus") ?? undefined,
    statusFilter: searchParams.get("statusFilter") ?? undefined,
    trackingFilter: searchParams.get("trackingFilter") ?? undefined,
  };

  const filters = parseProductReportFilters(params);
  const rows = await queryProductReportRows(filters);
  const csv = buildProductReportCsv(rows);
  const fileName = "product-report.csv";

  await safeWriteAuditLog({
    ...getAuditActorFromSession(session),
    ...requestContext,
    action: AuditAction.EXPORT,
    entityType: "ReportExport",
    entityRef: "product-report",
    meta: {
      format: "csv",
      fileName,
      rowCount: rows.length,
      filters: params,
    },
  });

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
