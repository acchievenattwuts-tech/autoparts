export const dynamic = "force-dynamic";

import {
  getAuditActorFromSession,
  getRequestContextFromHeaders,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { AuditAction } from "@/lib/generated/prisma";
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
import {
  buildCashBankAdjustmentHistoryCsv,
  buildCashBankLedgerCsv,
  buildCashBankTransferHistoryCsv,
  parseCashBankReportFilters,
  queryCashBankAdjustmentHistoryRows,
  queryCashBankLedgerData,
  queryCashBankTransferHistoryRows,
} from "@/lib/cash-bank-report-queries";
import {
  parseARAPStockFilters,
  queryARRows,
  queryAPData,
  queryStockRows,
  buildARCsv,
  buildAPCsv,
  buildStockCsv,
} from "@/lib/ar-ap-stock-report-queries";
import {
  queryARRegisterRows,
  queryAPRegisterRows,
  buildARRegisterCsv,
  buildAPRegisterCsv,
} from "@/lib/ar-ap-register-queries";

export async function GET(request: Request) {
  const session = await requirePermission("reports.view");

  const { searchParams } = new URL(request.url);
  const requestContext = getRequestContextFromHeaders(request.headers);

  const type = searchParams.get("type") ?? "sales";

  const params: Record<string, string | undefined> = {
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    showCancelled: searchParams.get("showCancelled") ?? undefined,
    accountId: searchParams.get("accountId") ?? undefined,
    paymentType: searchParams.get("paymentType") ?? undefined,
    saleType: searchParams.get("saleType") ?? undefined,
    cnType: searchParams.get("cnType") ?? undefined,
    paymentMethod: searchParams.get("paymentMethod") ?? undefined,
    docType: searchParams.get("docType") ?? undefined,
    customerId: searchParams.get("customerId") ?? undefined,
    arMode: searchParams.get("arMode") ?? undefined,
    view: searchParams.get("view") ?? undefined,
    supplierId: searchParams.get("supplierId") ?? undefined,
    categoryId: searchParams.get("categoryId") ?? undefined,
    search: searchParams.get("search") ?? undefined,
    showAll: searchParams.get("showAll") ?? undefined,
  };

  const filters = parseReportQueryFilters(params);
  const dateRange = `${filters.fromStr}-to-${filters.toStr}`;

  let csv: string;
  let fileName: string;

  switch (type) {
    case "ar": {
      const arFilters = parseARAPStockFilters(params);
      if (params.view === "register") {
        const rows = await queryARRegisterRows(arFilters);
        csv = buildARRegisterCsv(rows);
        fileName = `ar-register-${dateRange}.csv`;
      } else {
        const rows = await queryARRows(arFilters);
        csv = buildARCsv(rows);
        fileName = `ar-report-${dateRange}.csv`;
      }
      break;
    }
    case "ap": {
      const apFilters = parseARAPStockFilters(params);
      if (params.view === "register") {
        const rows = await queryAPRegisterRows(apFilters);
        csv = buildAPRegisterCsv(rows);
        fileName = `ap-register-${dateRange}.csv`;
      } else {
        const data = await queryAPData(apFilters);
        csv = buildAPCsv(data);
        fileName = `ap-report-${dateRange}.csv`;
      }
      break;
    }
    case "stock": {
      const stockFilters = parseARAPStockFilters(params);
      const rows = await queryStockRows(stockFilters);
      csv = buildStockCsv(rows);
      fileName = `stock-report.csv`;
      break;
    }
    case "cash-bank-ledger": {
      const cashBankFilters = parseCashBankReportFilters(params);
      const data = await queryCashBankLedgerData(cashBankFilters);
      csv = buildCashBankLedgerCsv(data);
      fileName = `cash-bank-ledger-${dateRange}.csv`;
      break;
    }
    case "cash-bank-transfers": {
      const cashBankFilters = parseCashBankReportFilters(params);
      const rows = await queryCashBankTransferHistoryRows(cashBankFilters);
      csv = buildCashBankTransferHistoryCsv(rows);
      fileName = `cash-bank-transfers-${dateRange}.csv`;
      break;
    }
    case "cash-bank-adjustments": {
      const cashBankFilters = parseCashBankReportFilters(params);
      const rows = await queryCashBankAdjustmentHistoryRows(cashBankFilters);
      csv = buildCashBankAdjustmentHistoryCsv(rows);
      fileName = `cash-bank-adjustments-${dateRange}.csv`;
      break;
    }
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

  await safeWriteAuditLog({
    ...getAuditActorFromSession(session),
    ...requestContext,
    action: AuditAction.EXPORT,
    entityType: "ReportExport",
    entityRef: type,
    meta: {
      format: "csv",
      fileName,
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
