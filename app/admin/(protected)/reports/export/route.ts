export const dynamic = "force-dynamic";

import { requirePermission } from "@/lib/require-auth";
import {
  parseReportQueryFilters,
  querySalesRows,
  queryPurchaseRows,
  queryCreditNoteRows,
  queryDailyReceiptRows,
  queryDailyPaymentRows,
  buildSalesCsv,
  buildPurchasesCsv,
  buildCreditNotesCsv,
  buildDailyReceiptCsv,
  buildDailyPaymentCsv,
} from "@/lib/report-queries";

export async function GET(request: Request) {
  await requirePermission("reports.view");

  const { searchParams } = new URL(request.url);

  const type = searchParams.get("type") ?? "sales";

  const params: Record<string, string | undefined> = {
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    showCancelled: searchParams.get("showCancelled") ?? undefined,
    paymentType: searchParams.get("paymentType") ?? undefined,
    saleType: searchParams.get("saleType") ?? undefined,
    cnType: searchParams.get("cnType") ?? undefined,
    paymentMethod: searchParams.get("paymentMethod") ?? undefined,
    docType: searchParams.get("docType") ?? undefined,
  };

  const filters = parseReportQueryFilters(params);
  const dateRange = `${filters.fromStr}-to-${filters.toStr}`;

  let csv: string;
  let fileName: string;

  switch (type) {
    case "purchases": {
      const rows = await queryPurchaseRows(filters);
      csv = buildPurchasesCsv(rows);
      fileName = `purchase-report-${dateRange}.csv`;
      break;
    }
    case "credit-notes": {
      const rows = await queryCreditNoteRows(filters);
      csv = buildCreditNotesCsv(rows);
      fileName = `credit-note-report-${dateRange}.csv`;
      break;
    }
    case "daily-receipt": {
      const rows = await queryDailyReceiptRows(filters);
      csv = buildDailyReceiptCsv(rows);
      fileName = `daily-receipt-${dateRange}.csv`;
      break;
    }
    case "daily-payment": {
      const rows = await queryDailyPaymentRows(filters);
      csv = buildDailyPaymentCsv(rows);
      fileName = `daily-payment-${dateRange}.csv`;
      break;
    }
    default: {
      // sales
      const rows = await querySalesRows(filters);
      csv = buildSalesCsv(rows);
      fileName = `sale-report-${dateRange}.csv`;
      break;
    }
  }

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
