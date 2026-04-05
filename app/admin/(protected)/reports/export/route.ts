import { buildReportsCsv, getReportsData, parseReportFilters } from "@/lib/reports";
import { requirePermission } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await requirePermission("reports.view");

  const { searchParams } = new URL(request.url);
  const filters = parseReportFilters({
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    customerCodeFrom: searchParams.get("customerCodeFrom") ?? undefined,
    customerCodeTo: searchParams.get("customerCodeTo") ?? undefined,
    supplierCodeFrom: searchParams.get("supplierCodeFrom") ?? undefined,
    supplierCodeTo: searchParams.get("supplierCodeTo") ?? undefined,
    productCodeFrom: searchParams.get("productCodeFrom") ?? undefined,
    productCodeTo: searchParams.get("productCodeTo") ?? undefined,
    expenseCodeFrom: searchParams.get("expenseCodeFrom") ?? undefined,
    expenseCodeTo: searchParams.get("expenseCodeTo") ?? undefined,
  });
  const data = await getReportsData(filters);
  const csv = buildReportsCsv(data);
  const fileName = `reports-${filters.fromInput}-to-${filters.toInput}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
