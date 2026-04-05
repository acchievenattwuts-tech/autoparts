import { buildReportsCsv, getReportsData, parseReportRange } from "@/lib/reports";
import { requirePermission } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await requirePermission("reports.view");

  const { searchParams } = new URL(request.url);
  const range = parseReportRange({
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
  });
  const data = await getReportsData(range);
  const csv = buildReportsCsv(data);
  const fileName = `reports-${range.fromInput}-to-${range.toInput}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
