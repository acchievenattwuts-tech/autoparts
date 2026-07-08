export const dynamic = "force-dynamic";

import {
  getAuditActorFromSession,
  getRequestContextFromHeaders,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { buildAdminProductFilterSearchParams, parseAdminProductFilterParams } from "@/lib/admin-product-filter-params";
import { AuditAction } from "@/lib/generated/prisma";
import { requirePermission } from "@/lib/require-auth";
import {
  buildProductReportExcel,
  parseProductReportFilters,
  queryProductReportRows,
} from "@/lib/product-report-queries";

export async function GET(request: Request) {
  const session = await requirePermission("products.view");
  const requestContext = getRequestContextFromHeaders(request.headers);
  const { searchParams } = new URL(request.url);

  const params = parseAdminProductFilterParams({
    search: searchParams.get("search") ?? undefined,
    categoryId: searchParams.get("categoryId") ?? undefined,
    brandId: searchParams.get("brandId") ?? undefined,
    carBrandId: searchParams.get("carBrandId") ?? undefined,
    carModelId: searchParams.get("carModelId") ?? undefined,
    yearMin: searchParams.get("yearMin") ?? undefined,
    yearMax: searchParams.get("yearMax") ?? undefined,
    stockStatus: searchParams.get("stockStatus") ?? undefined,
    statusFilter: searchParams.get("statusFilter") ?? undefined,
    trackingFilter: searchParams.get("trackingFilter") ?? undefined,
  });

  const filters = parseProductReportFilters(params);
  const rows = await queryProductReportRows(filters);
  const buffer = await buildProductReportExcel(rows);
  const fileName = "product-report.xlsx";

  await safeWriteAuditLog({
    ...getAuditActorFromSession(session),
    ...requestContext,
    action: AuditAction.EXPORT,
    entityType: "ReportExport",
    entityRef: "product-report",
    meta: {
      format: "xlsx",
      fileName,
      rowCount: rows.length,
      filters: buildAdminProductFilterSearchParams(params),
    },
  });

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
