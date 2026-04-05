import { db } from "@/lib/db";
import { PaymentMethod, SalePaymentType } from "@/lib/generated/prisma";

type ReportRange = { from: Date; to: Date };

export type ParsedReportFilters = ReportRange & {
  fromInput: string;
  toInput: string;
  customerCodeFrom: string;
  customerCodeTo: string;
  supplierCodeFrom: string;
  supplierCodeTo: string;
  productCodeFrom: string;
  productCodeTo: string;
  expenseCodeFrom: string;
  expenseCodeTo: string;
};

type SalesBucket = {
  label: string;
  documentCount: number;
  grossSalesAmount: number;
  returnAmount: number;
  netSaleAmount: number;
  vatAmount: number;
};

type StockRow = {
  id: string;
  code: string;
  name: string;
  categoryName: string;
  stock: number;
  minStock: number;
  avgCost: number;
  stockValue: number;
};

type WarrantyRow = {
  id: string;
  productCode: string;
  productName: string;
  customerName: string;
  saleNo: string;
  endDate: Date;
  daysLeft: number;
};

type ReceivableRow = {
  id: string;
  saleNo: string;
  saleDate: Date;
  customerCode: string;
  customerName: string;
  amountRemain: number;
  ageDays: number;
  bucketLabel: string;
  isCodPending: boolean;
};

type SupplierSummaryRow = {
  supplierKey: string;
  supplierCode: string;
  supplierName: string;
  purchaseCount: number;
  purchaseAmount: number;
  returnAmount: number;
  netPurchaseAmount: number;
};

type CustomerSummaryRow = {
  customerKey: string;
  customerCode: string;
  customerName: string;
  invoiceCount: number;
  grossSalesAmount: number;
  returnAmount: number;
  netSalesAmount: number;
  outstandingAmount: number;
};

type ExpenseSummaryRow = {
  expenseCode: string;
  expenseName: string;
  documentCount: number;
  totalAmount: number;
  vatAmount: number;
  netAmount: number;
};

type ExpenseDocumentRow = {
  id: string;
  expenseNo: string;
  expenseDate: Date;
  expenseCode: string;
  expenseName: string;
  description: string;
  amount: number;
  note: string;
};

type DailyReceiptRow = {
  source: "SALE" | "RECEIPT";
  docNo: string;
  docDate: Date;
  customerCode: string;
  customerName: string;
  paymentMethod: string;
  amount: number;
  note: string;
};

type DailyPaymentRow = {
  source: "PURCHASE" | "EXPENSE";
  docNo: string;
  docDate: Date;
  counterpartCode: string;
  counterpartName: string;
  paymentMethod: string;
  amount: number;
  note: string;
};

export type ReportsData = {
  range: { from: string; to: string };
  filters: {
    customerCodeFrom: string;
    customerCodeTo: string;
    supplierCodeFrom: string;
    supplierCodeTo: string;
    productCodeFrom: string;
    productCodeTo: string;
    expenseCodeFrom: string;
    expenseCodeTo: string;
  };
  salesSummary: {
    totalInvoices: number;
    grossSalesAmount: number;
    returnAmount: number;
    netSaleAmount: number;
    byDay: SalesBucket[];
    byWeek: SalesBucket[];
    byMonth: SalesBucket[];
  };
  profitLoss: {
    grossSales: number;
    salesReturns: number;
    netRevenue: number;
    costOfGoodsSold: number;
    grossProfit: number;
    expenseTotal: number;
    netProfit: number;
    salesVat: number;
    creditNoteVat: number;
    purchaseVat: number;
    expenseVat: number;
    vatPayable: number;
  };
  stock: {
    activeProductCount: number;
    totalUnitsOnHand: number;
    totalStockValue: number;
    lowStockCount: number;
    lowStockItems: StockRow[];
    highestValueItems: StockRow[];
  };
  warranties: {
    expiringSoonCount: number;
    expiredCount: number;
    expiringItems: WarrantyRow[];
  };
  receivables: {
    totalOutstanding: number;
    regularOutstanding: number;
    codPendingOutstanding: number;
    buckets: Array<{ label: string; amount: number }>;
    items: ReceivableRow[];
  };
  suppliers: {
    totalPurchaseAmount: number;
    totalReturnAmount: number;
    netPurchaseAmount: number;
    items: SupplierSummaryRow[];
  };
  customers: {
    totalNetSalesAmount: number;
    totalOutstandingAmount: number;
    items: CustomerSummaryRow[];
  };
  expenses: {
    totalAmount: number;
    totalVatAmount: number;
    totalNetAmount: number;
    items: ExpenseSummaryRow[];
    documents: ExpenseDocumentRow[];
  };
  dailyReceipts: {
    totalAmount: number;
    cashSaleAmount: number;
    receiptAmount: number;
    items: DailyReceiptRow[];
  };
  dailyPayments: {
    totalAmount: number;
    purchaseAmount: number;
    expenseAmount: number;
    items: DailyPaymentRow[];
  };
};

const DAY_MS = 24 * 60 * 60 * 1000;

function toNumber(value: unknown): number {
  return Number(value ?? 0);
}

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function startOfWeek(date: Date): Date {
  const next = startOfDay(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  return next;
}

function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateShort(date: Date): string {
  return date.toLocaleDateString("th-TH-u-ca-gregory", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function parseDateInput(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function normalizeCode(value: string | undefined): string {
  return value?.trim() ?? "";
}

function buildStringRange(from: string, to: string): { gte?: string; lte?: string } | undefined {
  if (!from && !to) return undefined;
  return { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
}

function getPaymentMethodLabel(method: PaymentMethod | null | undefined): string {
  switch (method) {
    case PaymentMethod.CASH:
      return "เงินสด";
    case PaymentMethod.TRANSFER:
      return "โอนเงิน";
    case PaymentMethod.CREDIT:
      return "เครดิต";
    default:
      return "-";
  }
}

function buildSalesBuckets(
  transactions: Array<{
    docDate: Date;
    grossSalesAmount: number;
    returnAmount: number;
    netSaleAmount: number;
    vatAmount: number;
  }>,
  mode: "day" | "week" | "month"
): SalesBucket[] {
  const bucketMap = new Map<string, SalesBucket & { sortDate: Date }>();

  for (const transaction of transactions) {
    let key: string;
    let label: string;
    let sortDate: Date;

    if (mode === "day") {
      key = formatDateInput(transaction.docDate);
      label = formatDateShort(transaction.docDate);
      sortDate = startOfDay(transaction.docDate);
    } else if (mode === "week") {
      const weekStart = startOfWeek(transaction.docDate);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      key = formatDateInput(weekStart);
      label = `${formatDateShort(weekStart)} - ${formatDateShort(weekEnd)}`;
      sortDate = weekStart;
    } else {
      key = formatMonthKey(transaction.docDate);
      label = transaction.docDate.toLocaleDateString("th-TH-u-ca-gregory", {
        month: "long",
        year: "numeric",
      });
      sortDate = new Date(transaction.docDate.getFullYear(), transaction.docDate.getMonth(), 1);
    }

    const existing = bucketMap.get(key) ?? {
      label,
      documentCount: 0,
      grossSalesAmount: 0,
      returnAmount: 0,
      netSaleAmount: 0,
      vatAmount: 0,
      sortDate,
    };

    existing.documentCount += 1;
    existing.grossSalesAmount += transaction.grossSalesAmount;
    existing.returnAmount += transaction.returnAmount;
    existing.netSaleAmount += transaction.netSaleAmount;
    existing.vatAmount += transaction.vatAmount;
    bucketMap.set(key, existing);
  }

  return [...bucketMap.values()]
    .sort((a, b) => a.sortDate.getTime() - b.sortDate.getTime())
    .map(({ sortDate: _sortDate, ...bucket }) => bucket);
}

export function getDefaultReportRange(): { from: string; to: string } {
  const now = new Date();
  return {
    from: formatDateInput(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: formatDateInput(now),
  };
}

export function parseReportFilters(params: {
  from?: string;
  to?: string;
  customerCodeFrom?: string;
  customerCodeTo?: string;
  supplierCodeFrom?: string;
  supplierCodeTo?: string;
  productCodeFrom?: string;
  productCodeTo?: string;
  expenseCodeFrom?: string;
  expenseCodeTo?: string;
}): ParsedReportFilters {
  const defaults = getDefaultReportRange();
  const from = parseDateInput(params.from, new Date(`${defaults.from}T00:00:00`));
  const to = parseDateInput(params.to, new Date(`${defaults.to}T00:00:00`));
  const normalizedFrom = startOfDay(from);
  const normalizedTo = endOfDay(to < from ? from : to);

  return {
    from: normalizedFrom,
    to: normalizedTo,
    fromInput: formatDateInput(normalizedFrom),
    toInput: formatDateInput(normalizedTo),
    customerCodeFrom: normalizeCode(params.customerCodeFrom),
    customerCodeTo: normalizeCode(params.customerCodeTo),
    supplierCodeFrom: normalizeCode(params.supplierCodeFrom),
    supplierCodeTo: normalizeCode(params.supplierCodeTo),
    productCodeFrom: normalizeCode(params.productCodeFrom),
    productCodeTo: normalizeCode(params.productCodeTo),
    expenseCodeFrom: normalizeCode(params.expenseCodeFrom),
    expenseCodeTo: normalizeCode(params.expenseCodeTo),
  };
}

export function buildReportQuery(filters: ParsedReportFilters): string {
  const params = new URLSearchParams();
  const entries: Array<[string, string]> = [
    ["from", filters.fromInput],
    ["to", filters.toInput],
    ["customerCodeFrom", filters.customerCodeFrom],
    ["customerCodeTo", filters.customerCodeTo],
    ["supplierCodeFrom", filters.supplierCodeFrom],
    ["supplierCodeTo", filters.supplierCodeTo],
    ["productCodeFrom", filters.productCodeFrom],
    ["productCodeTo", filters.productCodeTo],
    ["expenseCodeFrom", filters.expenseCodeFrom],
    ["expenseCodeTo", filters.expenseCodeTo],
  ];

  for (const [key, value] of entries) {
    if (value) params.set(key, value);
  }
  return params.toString();
}

export async function getReportsData(filters: ParsedReportFilters): Promise<ReportsData> {
  const now = new Date();
  const soonDate = new Date(now.getTime() + 30 * DAY_MS);
  const customerCodeRange = buildStringRange(filters.customerCodeFrom, filters.customerCodeTo);
  const supplierCodeRange = buildStringRange(filters.supplierCodeFrom, filters.supplierCodeTo);
  const productCodeRange = buildStringRange(filters.productCodeFrom, filters.productCodeTo);
  const expenseCodeRange = buildStringRange(filters.expenseCodeFrom, filters.expenseCodeTo);

  const saleWhere = {
    status: "ACTIVE" as const,
    saleDate: { gte: filters.from, lte: filters.to },
    ...(customerCodeRange ? { customer: { code: customerCodeRange } } : {}),
    ...(productCodeRange ? { items: { some: { product: { code: productCodeRange } } } } : {}),
  };
  const creditNoteWhere = {
    status: "ACTIVE" as const,
    type: "RETURN" as const,
    cnDate: { gte: filters.from, lte: filters.to },
    ...(customerCodeRange ? { customer: { code: customerCodeRange } } : {}),
    ...(productCodeRange ? { items: { some: { product: { code: productCodeRange } } } } : {}),
  };
  const purchaseWhere = {
    status: "ACTIVE" as const,
    purchaseDate: { gte: filters.from, lte: filters.to },
    ...(supplierCodeRange ? { supplier: { code: supplierCodeRange } } : {}),
    ...(productCodeRange ? { items: { some: { product: { code: productCodeRange } } } } : {}),
  };
  const purchaseReturnWhere = {
    status: "ACTIVE" as const,
    returnDate: { gte: filters.from, lte: filters.to },
    ...(supplierCodeRange ? { supplier: { code: supplierCodeRange } } : {}),
    ...(productCodeRange ? { items: { some: { product: { code: productCodeRange } } } } : {}),
  };
  const expenseWhere = {
    status: "ACTIVE" as const,
    expenseDate: { gte: filters.from, lte: filters.to },
    ...(expenseCodeRange ? { items: { some: { expenseCode: { code: expenseCodeRange } } } } : {}),
  };
  const receiptWhere = {
    status: "ACTIVE" as const,
    receiptDate: { gte: filters.from, lte: filters.to },
    ...(customerCodeRange ? { customer: { code: customerCodeRange } } : {}),
    ...(productCodeRange
      ? { items: { some: { sale: { items: { some: { product: { code: productCodeRange } } } } } } }
      : {}),
  };
  const outstandingSaleWhere = {
    status: "ACTIVE" as const,
    amountRemain: { gt: 0 },
    saleDate: { gte: filters.from, lte: filters.to },
    ...(customerCodeRange ? { customer: { code: customerCodeRange } } : {}),
    ...(productCodeRange ? { items: { some: { product: { code: productCodeRange } } } } : {}),
  };

  const [sales, creditNotes, purchases, purchaseReturns, expenses, products, warranties, outstandingSales, receipts] =
    await Promise.all([
      db.sale.findMany({
        where: saleWhere,
        orderBy: [{ saleDate: "asc" }, { saleNo: "asc" }],
        select: {
          id: true,
          saleNo: true,
          saleDate: true,
          customerName: true,
          netAmount: true,
          vatAmount: true,
          amountRemain: true,
          paymentType: true,
          paymentMethod: true,
          note: true,
          customer: { select: { code: true, name: true } },
          items: { select: { quantity: true, costPrice: true } },
        },
      }),
      db.creditNote.findMany({
        where: creditNoteWhere,
        orderBy: [{ cnDate: "asc" }, { cnNo: "asc" }],
        select: {
          id: true,
          cnNo: true,
          cnDate: true,
          customerName: true,
          totalAmount: true,
          vatAmount: true,
          note: true,
          customer: { select: { code: true, name: true } },
        },
      }),
      db.purchase.findMany({
        where: purchaseWhere,
        orderBy: [{ purchaseDate: "asc" }, { purchaseNo: "asc" }],
        select: {
          id: true,
          purchaseNo: true,
          purchaseDate: true,
          paymentMethod: true,
          referenceNo: true,
          note: true,
          supplierId: true,
          supplier: { select: { code: true, name: true } },
          netAmount: true,
          vatAmount: true,
        },
      }),
      db.purchaseReturn.findMany({
        where: purchaseReturnWhere,
        orderBy: [{ returnDate: "asc" }, { returnNo: "asc" }],
        select: {
          id: true,
          returnNo: true,
          supplierId: true,
          supplier: { select: { code: true, name: true } },
          totalAmount: true,
        },
      }),
      db.expense.findMany({
        where: expenseWhere,
        orderBy: [{ expenseDate: "asc" }, { expenseNo: "asc" }],
        select: {
          id: true,
          expenseNo: true,
          expenseDate: true,
          note: true,
          totalAmount: true,
          vatAmount: true,
          netAmount: true,
          items: {
            select: {
              amount: true,
              description: true,
              expenseCode: { select: { code: true, name: true } },
            },
          },
        },
      }),
      db.product.findMany({
        where: { isActive: true, ...(productCodeRange ? { code: productCodeRange } : {}) },
        orderBy: [{ stock: "asc" }, { code: "asc" }],
        select: {
          id: true,
          code: true,
          name: true,
          stock: true,
          minStock: true,
          avgCost: true,
          category: { select: { name: true } },
        },
      }),
      db.warranty.findMany({
        where: {
          endDate: { lte: soonDate },
          ...(productCodeRange ? { product: { code: productCodeRange } } : {}),
          ...(customerCodeRange ? { sale: { customer: { code: customerCodeRange } } } : {}),
        },
        orderBy: [{ endDate: "asc" }, { sale: { saleNo: "asc" } }],
        select: {
          id: true,
          endDate: true,
          product: { select: { code: true, name: true } },
          sale: { select: { saleNo: true, customerName: true } },
        },
        take: 100,
      }),
      db.sale.findMany({
        where: outstandingSaleWhere,
        orderBy: [{ saleDate: "asc" }, { saleNo: "asc" }],
        select: {
          id: true,
          saleNo: true,
          saleDate: true,
          customerName: true,
          amountRemain: true,
          paymentType: true,
          fulfillmentType: true,
          shippingStatus: true,
          customer: { select: { code: true, name: true } },
        },
      }),
      db.receipt.findMany({
        where: receiptWhere,
        orderBy: [{ receiptDate: "asc" }, { receiptNo: "asc" }],
        select: {
          id: true,
          receiptNo: true,
          receiptDate: true,
          customerName: true,
          paymentMethod: true,
          totalAmount: true,
          note: true,
          customer: { select: { code: true, name: true } },
        },
      }),
    ]);

  const normalizedSales = sales.map((sale) => ({
    id: sale.id,
    saleNo: sale.saleNo,
    saleDate: sale.saleDate,
    customerCode: sale.customer?.code ?? "",
    customerName: sale.customer?.name ?? (sale.customerName?.trim() || "ลูกค้าทั่วไป"),
    grossSalesAmount: toNumber(sale.netAmount),
    vatAmount: toNumber(sale.vatAmount),
    amountRemain: toNumber(sale.amountRemain),
    paymentType: sale.paymentType,
    paymentMethod: sale.paymentMethod,
    note: sale.note ?? "",
    cogs: sale.items.reduce((sum, item) => sum + Number(item.quantity) * toNumber(item.costPrice), 0),
  }));
  const normalizedCreditNotes = creditNotes.map((creditNote) => ({
    id: creditNote.id,
    cnNo: creditNote.cnNo,
    cnDate: creditNote.cnDate,
    customerCode: creditNote.customer?.code ?? "",
    customerName: creditNote.customer?.name ?? (creditNote.customerName?.trim() || "ลูกค้าทั่วไป"),
    returnAmount: toNumber(creditNote.totalAmount),
    vatAmount: toNumber(creditNote.vatAmount),
    note: creditNote.note ?? "",
  }));
  const salesTransactions = [
    ...normalizedSales.map((sale) => ({
      docDate: sale.saleDate,
      grossSalesAmount: sale.grossSalesAmount,
      returnAmount: 0,
      netSaleAmount: sale.grossSalesAmount,
      vatAmount: sale.vatAmount,
    })),
    ...normalizedCreditNotes.map((creditNote) => ({
      docDate: creditNote.cnDate,
      grossSalesAmount: 0,
      returnAmount: creditNote.returnAmount,
      netSaleAmount: -creditNote.returnAmount,
      vatAmount: -creditNote.vatAmount,
    })),
  ];

  const grossSales = normalizedSales.reduce((sum, sale) => sum + sale.grossSalesAmount, 0);
  const totalInvoices = normalizedSales.length;
  const costOfGoodsSold = normalizedSales.reduce((sum, sale) => sum + sale.cogs, 0);
  const salesVat = normalizedSales.reduce((sum, sale) => sum + sale.vatAmount, 0);
  const salesReturns = normalizedCreditNotes.reduce((sum, creditNote) => sum + creditNote.returnAmount, 0);
  const creditNoteVat = normalizedCreditNotes.reduce((sum, creditNote) => sum + creditNote.vatAmount, 0);
  const purchaseVat = purchases.reduce((sum, purchase) => sum + toNumber(purchase.vatAmount), 0);
  const expenseTotal = expenses.reduce((sum, expense) => sum + toNumber(expense.netAmount), 0);
  const expenseVat = expenses.reduce((sum, expense) => sum + toNumber(expense.vatAmount), 0);
  const totalPurchaseAmount = purchases.reduce((sum, purchase) => sum + toNumber(purchase.netAmount), 0);
  const totalReturnAmount = purchaseReturns.reduce((sum, doc) => sum + toNumber(doc.totalAmount), 0);
  const netRevenue = grossSales - salesReturns;
  const grossProfit = netRevenue - costOfGoodsSold;
  const netProfit = grossProfit - expenseTotal;
  const vatPayable = salesVat - creditNoteVat - purchaseVat - expenseVat;

  const stockRows: StockRow[] = products.map((product) => {
    const stock = toNumber(product.stock);
    const avgCost = toNumber(product.avgCost);
    return {
      id: product.id,
      code: product.code,
      name: product.name,
      categoryName: product.category.name,
      stock,
      minStock: toNumber(product.minStock),
      avgCost,
      stockValue: stock * avgCost,
    };
  });
  const lowStockItems = stockRows.filter((row) => row.stock <= row.minStock);
  const highestValueItems = [...stockRows].sort((a, b) => b.stockValue - a.stockValue).slice(0, 20);

  const expiringItems: WarrantyRow[] = warranties.map((warranty) => ({
    id: warranty.id,
    productCode: warranty.product.code,
    productName: warranty.product.name,
    customerName: warranty.sale.customerName ?? "-",
    saleNo: warranty.sale.saleNo,
    endDate: warranty.endDate,
    daysLeft: Math.ceil((startOfDay(warranty.endDate).getTime() - startOfDay(now).getTime()) / DAY_MS),
  }));

  const receivableBuckets = new Map<string, number>([
    ["0-30 วัน", 0],
    ["31-60 วัน", 0],
    ["61-90 วัน", 0],
    ["มากกว่า 90 วัน", 0],
  ]);
  const receivableItems: ReceivableRow[] = outstandingSales.map((sale) => {
    const ageDays = Math.max(0, Math.floor((startOfDay(now).getTime() - startOfDay(sale.saleDate).getTime()) / DAY_MS));
    const bucketLabel =
      ageDays <= 30 ? "0-30 วัน" : ageDays <= 60 ? "31-60 วัน" : ageDays <= 90 ? "61-90 วัน" : "มากกว่า 90 วัน";
    const amountRemain = toNumber(sale.amountRemain);
    receivableBuckets.set(bucketLabel, (receivableBuckets.get(bucketLabel) ?? 0) + amountRemain);
    return {
      id: sale.id,
      saleNo: sale.saleNo,
      saleDate: sale.saleDate,
      customerCode: sale.customer?.code ?? "",
      customerName: sale.customer?.name ?? sale.customerName ?? "-",
      amountRemain,
      ageDays,
      bucketLabel,
      isCodPending:
        sale.paymentType === SalePaymentType.CREDIT_SALE &&
        sale.fulfillmentType === "DELIVERY" &&
        sale.shippingStatus !== "DELIVERED",
    };
  });

  const supplierMap = new Map<string, SupplierSummaryRow>();
  for (const purchase of purchases) {
    const supplierKey = purchase.supplierId ?? purchase.supplier?.code ?? "unknown";
    const existing = supplierMap.get(supplierKey) ?? {
      supplierKey,
      supplierCode: purchase.supplier?.code ?? "",
      supplierName: purchase.supplier?.name ?? "ไม่ระบุซัพพลายเออร์",
      purchaseCount: 0,
      purchaseAmount: 0,
      returnAmount: 0,
      netPurchaseAmount: 0,
    };
    existing.purchaseCount += 1;
    existing.purchaseAmount += toNumber(purchase.netAmount);
    existing.netPurchaseAmount = existing.purchaseAmount - existing.returnAmount;
    supplierMap.set(supplierKey, existing);
  }
  for (const doc of purchaseReturns) {
    const supplierKey = doc.supplierId ?? doc.supplier?.code ?? "unknown";
    const existing = supplierMap.get(supplierKey) ?? {
      supplierKey,
      supplierCode: doc.supplier?.code ?? "",
      supplierName: doc.supplier?.name ?? "ไม่ระบุซัพพลายเออร์",
      purchaseCount: 0,
      purchaseAmount: 0,
      returnAmount: 0,
      netPurchaseAmount: 0,
    };
    existing.returnAmount += toNumber(doc.totalAmount);
    existing.netPurchaseAmount = existing.purchaseAmount - existing.returnAmount;
    supplierMap.set(supplierKey, existing);
  }

  const customerMap = new Map<string, CustomerSummaryRow>();
  for (const sale of normalizedSales) {
    const customerKey = sale.customerCode || sale.customerName;
    const existing = customerMap.get(customerKey) ?? {
      customerKey,
      customerCode: sale.customerCode,
      customerName: sale.customerName,
      invoiceCount: 0,
      grossSalesAmount: 0,
      returnAmount: 0,
      netSalesAmount: 0,
      outstandingAmount: 0,
    };
    existing.invoiceCount += 1;
    existing.grossSalesAmount += sale.grossSalesAmount;
    existing.outstandingAmount += sale.amountRemain;
    existing.netSalesAmount = existing.grossSalesAmount - existing.returnAmount;
    customerMap.set(customerKey, existing);
  }
  for (const creditNote of normalizedCreditNotes) {
    const customerKey = creditNote.customerCode || creditNote.customerName;
    const existing = customerMap.get(customerKey) ?? {
      customerKey,
      customerCode: creditNote.customerCode,
      customerName: creditNote.customerName,
      invoiceCount: 0,
      grossSalesAmount: 0,
      returnAmount: 0,
      netSalesAmount: 0,
      outstandingAmount: 0,
    };
    existing.returnAmount += creditNote.returnAmount;
    existing.netSalesAmount = existing.grossSalesAmount - existing.returnAmount;
    customerMap.set(customerKey, existing);
  }

  const expenseSummaryMap = new Map<string, ExpenseSummaryRow>();
  const expenseDocumentRows: ExpenseDocumentRow[] = [];
  for (const expense of expenses) {
    const itemCount = Math.max(expense.items.length, 1);
    const vatShare = toNumber(expense.vatAmount) / itemCount;
    for (const item of expense.items) {
      const key = item.expenseCode.code;
      const existing = expenseSummaryMap.get(key) ?? {
        expenseCode: item.expenseCode.code,
        expenseName: item.expenseCode.name,
        documentCount: 0,
        totalAmount: 0,
        vatAmount: 0,
        netAmount: 0,
      };
      existing.documentCount += 1;
      existing.totalAmount += toNumber(item.amount);
      existing.vatAmount += vatShare;
      existing.netAmount += toNumber(item.amount);
      expenseSummaryMap.set(key, existing);

      expenseDocumentRows.push({
        id: `${expense.id}:${item.expenseCode.code}:${expenseDocumentRows.length}`,
        expenseNo: expense.expenseNo,
        expenseDate: expense.expenseDate,
        expenseCode: item.expenseCode.code,
        expenseName: item.expenseCode.name,
        description: item.description ?? item.expenseCode.name,
        amount: toNumber(item.amount),
        note: expense.note ?? "",
      });
    }
  }

  const dailyReceiptRows: DailyReceiptRow[] = [
    ...normalizedSales
      .filter((sale) => sale.paymentType === SalePaymentType.CASH_SALE)
      .map((sale) => ({
        source: "SALE" as const,
        docNo: sale.saleNo,
        docDate: sale.saleDate,
        customerCode: sale.customerCode,
        customerName: sale.customerName,
        paymentMethod: getPaymentMethodLabel(sale.paymentMethod),
        amount: sale.grossSalesAmount,
        note: sale.note,
      })),
    ...receipts.map((receipt) => ({
      source: "RECEIPT" as const,
      docNo: receipt.receiptNo,
      docDate: receipt.receiptDate,
      customerCode: receipt.customer?.code ?? "",
      customerName: receipt.customer?.name ?? receipt.customerName ?? "ลูกค้าทั่วไป",
      paymentMethod: getPaymentMethodLabel(receipt.paymentMethod),
      amount: toNumber(receipt.totalAmount),
      note: receipt.note ?? "",
    })),
  ].sort((a, b) => a.docDate.getTime() - b.docDate.getTime() || a.docNo.localeCompare(b.docNo));

  const dailyPaymentRows: DailyPaymentRow[] = [
    ...purchases.map((purchase) => ({
      source: "PURCHASE" as const,
      docNo: purchase.purchaseNo,
      docDate: purchase.purchaseDate,
      counterpartCode: purchase.supplier?.code ?? "",
      counterpartName: purchase.supplier?.name ?? "ไม่ระบุซัพพลายเออร์",
      paymentMethod: getPaymentMethodLabel(purchase.paymentMethod),
      amount: toNumber(purchase.netAmount),
      note: purchase.referenceNo ?? purchase.note ?? "",
    })),
    ...expenses.map((expense) => ({
      source: "EXPENSE" as const,
      docNo: expense.expenseNo,
      docDate: expense.expenseDate,
      counterpartCode: "",
      counterpartName: expense.items.map((item) => item.expenseCode.code).join(", "),
      paymentMethod: "-",
      amount: toNumber(expense.netAmount),
      note: expense.note ?? expense.items.map((item) => item.expenseCode.name).join(", "),
    })),
  ].sort((a, b) => a.docDate.getTime() - b.docDate.getTime() || a.docNo.localeCompare(b.docNo));

  return {
    range: { from: filters.fromInput, to: filters.toInput },
    filters: {
      customerCodeFrom: filters.customerCodeFrom,
      customerCodeTo: filters.customerCodeTo,
      supplierCodeFrom: filters.supplierCodeFrom,
      supplierCodeTo: filters.supplierCodeTo,
      productCodeFrom: filters.productCodeFrom,
      productCodeTo: filters.productCodeTo,
      expenseCodeFrom: filters.expenseCodeFrom,
      expenseCodeTo: filters.expenseCodeTo,
    },
    salesSummary: {
      totalInvoices,
      grossSalesAmount: grossSales,
      returnAmount: salesReturns,
      netSaleAmount: grossSales - salesReturns,
      byDay: buildSalesBuckets(salesTransactions, "day"),
      byWeek: buildSalesBuckets(salesTransactions, "week"),
      byMonth: buildSalesBuckets(salesTransactions, "month"),
    },
    profitLoss: {
      grossSales,
      salesReturns,
      netRevenue,
      costOfGoodsSold,
      grossProfit,
      expenseTotal,
      netProfit,
      salesVat,
      creditNoteVat,
      purchaseVat,
      expenseVat,
      vatPayable,
    },
    stock: {
      activeProductCount: stockRows.length,
      totalUnitsOnHand: stockRows.reduce((sum, row) => sum + row.stock, 0),
      totalStockValue: stockRows.reduce((sum, row) => sum + row.stockValue, 0),
      lowStockCount: lowStockItems.length,
      lowStockItems: lowStockItems.slice(0, 100),
      highestValueItems,
    },
    warranties: {
      expiringSoonCount: expiringItems.filter((item) => item.daysLeft >= 0).length,
      expiredCount: expiringItems.filter((item) => item.daysLeft < 0).length,
      expiringItems,
    },
    receivables: {
      totalOutstanding: receivableItems.reduce((sum, item) => sum + item.amountRemain, 0),
      regularOutstanding: receivableItems.filter((item) => !item.isCodPending).reduce((sum, item) => sum + item.amountRemain, 0),
      codPendingOutstanding: receivableItems.filter((item) => item.isCodPending).reduce((sum, item) => sum + item.amountRemain, 0),
      buckets: [...receivableBuckets.entries()].map(([label, amount]) => ({ label, amount })),
      items: receivableItems.sort((a, b) => b.amountRemain - a.amountRemain).slice(0, 100),
    },
    suppliers: {
      totalPurchaseAmount,
      totalReturnAmount,
      netPurchaseAmount: totalPurchaseAmount - totalReturnAmount,
      items: [...supplierMap.values()].sort((a, b) => b.netPurchaseAmount - a.netPurchaseAmount).slice(0, 50),
    },
    customers: {
      totalNetSalesAmount: [...customerMap.values()].reduce((sum, item) => sum + item.netSalesAmount, 0),
      totalOutstandingAmount: [...customerMap.values()].reduce((sum, item) => sum + item.outstandingAmount, 0),
      items: [...customerMap.values()].sort((a, b) => b.netSalesAmount - a.netSalesAmount).slice(0, 50),
    },
    expenses: {
      totalAmount: expenses.reduce((sum, expense) => sum + toNumber(expense.totalAmount), 0),
      totalVatAmount: expenses.reduce((sum, expense) => sum + toNumber(expense.vatAmount), 0),
      totalNetAmount: expenses.reduce((sum, expense) => sum + toNumber(expense.netAmount), 0),
      items: [...expenseSummaryMap.values()].sort((a, b) => b.netAmount - a.netAmount).slice(0, 50),
      documents: expenseDocumentRows
        .sort((a, b) => a.expenseDate.getTime() - b.expenseDate.getTime() || a.expenseNo.localeCompare(b.expenseNo))
        .slice(0, 100),
    },
    dailyReceipts: {
      totalAmount: dailyReceiptRows.reduce((sum, item) => sum + item.amount, 0),
      cashSaleAmount: dailyReceiptRows.filter((item) => item.source === "SALE").reduce((sum, item) => sum + item.amount, 0),
      receiptAmount: dailyReceiptRows.filter((item) => item.source === "RECEIPT").reduce((sum, item) => sum + item.amount, 0),
      items: dailyReceiptRows.slice(0, 100),
    },
    dailyPayments: {
      totalAmount: dailyPaymentRows.reduce((sum, item) => sum + item.amount, 0),
      purchaseAmount: dailyPaymentRows.filter((item) => item.source === "PURCHASE").reduce((sum, item) => sum + item.amount, 0),
      expenseAmount: dailyPaymentRows.filter((item) => item.source === "EXPENSE").reduce((sum, item) => sum + item.amount, 0),
      items: dailyPaymentRows.slice(0, 100),
    },
  };
}

export function buildReportsCsv(data: ReportsData): string {
  const lines: string[] = [];
  const pushRow = (values: Array<string | number>) => {
    lines.push(values.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","));
  };
  pushRow(["ช่วงรายงาน", `${data.range.from} ถึง ${data.range.to}`]);
  pushRow(["ลูกค้า From", data.filters.customerCodeFrom || "-"]);
  pushRow(["ลูกค้า To", data.filters.customerCodeTo || "-"]);
  pushRow(["ซัพพลายเออร์ From", data.filters.supplierCodeFrom || "-"]);
  pushRow(["ซัพพลายเออร์ To", data.filters.supplierCodeTo || "-"]);
  pushRow(["รหัสสินค้า From", data.filters.productCodeFrom || "-"]);
  pushRow(["รหัสสินค้า To", data.filters.productCodeTo || "-"]);
  pushRow(["รหัสค่าใช้จ่าย From", data.filters.expenseCodeFrom || "-"]);
  pushRow(["รหัสค่าใช้จ่าย To", data.filters.expenseCodeTo || "-"]);
  lines.push("");

  pushRow(["สรุปรายงานขาย"]);
  pushRow(["ช่วงเวลา", "จำนวนเอกสาร", "ยอดขาย", "ยอดคืน", "Net Sale", "VAT สุทธิ"]);
  for (const row of data.salesSummary.byDay) {
    pushRow([row.label, row.documentCount, row.grossSalesAmount.toFixed(2), row.returnAmount.toFixed(2), row.netSaleAmount.toFixed(2), row.vatAmount.toFixed(2)]);
  }
  lines.push("");

  pushRow(["กำไรขาดทุน", "มูลค่า"]);
  pushRow(["ยอดขายรวม", data.profitLoss.grossSales.toFixed(2)]);
  pushRow(["ยอดคืนขาย", data.profitLoss.salesReturns.toFixed(2)]);
  pushRow(["รายได้สุทธิ", data.profitLoss.netRevenue.toFixed(2)]);
  pushRow(["ต้นทุนขาย", data.profitLoss.costOfGoodsSold.toFixed(2)]);
  pushRow(["กำไรขั้นต้น", data.profitLoss.grossProfit.toFixed(2)]);
  pushRow(["ค่าใช้จ่าย", data.profitLoss.expenseTotal.toFixed(2)]);
  pushRow(["กำไรสุทธิ", data.profitLoss.netProfit.toFixed(2)]);
  pushRow(["VAT ขาย", data.profitLoss.salesVat.toFixed(2)]);
  pushRow(["VAT คืนขาย", data.profitLoss.creditNoteVat.toFixed(2)]);
  pushRow(["VAT ซื้อ", data.profitLoss.purchaseVat.toFixed(2)]);
  pushRow(["VAT ค่าใช้จ่าย", data.profitLoss.expenseVat.toFixed(2)]);
  pushRow(["VAT คงชำระ", data.profitLoss.vatPayable.toFixed(2)]);
  lines.push("");

  pushRow(["รายงานรับเงินประจำวัน"]);
  pushRow(["ที่มา", "เลขที่เอกสาร", "วันที่", "รหัสลูกค้า", "ลูกค้า", "ช่องทางชำระ", "จำนวนเงิน", "หมายเหตุ"]);
  for (const row of data.dailyReceipts.items) {
    pushRow([row.source === "SALE" ? "ขายสด" : "ใบเสร็จรับเงิน", row.docNo, formatDateInput(row.docDate), row.customerCode || "-", row.customerName, row.paymentMethod, row.amount.toFixed(2), row.note || "-"]);
  }
  lines.push("");

  pushRow(["รายงานจ่ายเงินประจำวัน"]);
  pushRow(["ที่มา", "เลขที่เอกสาร", "วันที่", "รหัสคู่ค้า/อ้างอิง", "คู่ค้า/รายละเอียด", "ช่องทางชำระ", "จำนวนเงิน", "หมายเหตุ"]);
  for (const row of data.dailyPayments.items) {
    pushRow([row.source === "PURCHASE" ? "ซื้อสินค้า" : "ค่าใช้จ่าย", row.docNo, formatDateInput(row.docDate), row.counterpartCode || "-", row.counterpartName, row.paymentMethod, row.amount.toFixed(2), row.note || "-"]);
  }
  lines.push("");

  pushRow(["รายงานค่าใช้จ่าย"]);
  pushRow(["รหัสค่าใช้จ่าย", "ชื่อ", "จำนวนรายการ", "ยอดรวม", "VAT", "ยอดสุทธิ"]);
  for (const row of data.expenses.items) {
    pushRow([row.expenseCode, row.expenseName, row.documentCount, row.totalAmount.toFixed(2), row.vatAmount.toFixed(2), row.netAmount.toFixed(2)]);
  }
  lines.push("");

  pushRow(["ลูกหนี้ค้างชำระ"]);
  pushRow(["เลขที่ขาย", "วันที่ขาย", "รหัสลูกค้า", "ลูกค้า", "ยอดค้าง", "อายุหนี้(วัน)", "ช่วงอายุหนี้", "ประเภท"]);
  for (const row of data.receivables.items) {
    pushRow([row.saleNo, formatDateInput(row.saleDate), row.customerCode || "-", row.customerName, row.amountRemain.toFixed(2), row.ageDays, row.bucketLabel, row.isCodPending ? "COD ค้างรับ" : "ลูกหนี้ทั่วไป"]);
  }
  lines.push("");

  pushRow(["สรุปซื้อแยกซัพพลายเออร์"]);
  pushRow(["รหัสซัพพลายเออร์", "ซัพพลายเออร์", "จำนวนเอกสารซื้อ", "ยอดซื้อ", "ยอดคืน", "สุทธิ"]);
  for (const row of data.suppliers.items) {
    pushRow([row.supplierCode || "-", row.supplierName, row.purchaseCount, row.purchaseAmount.toFixed(2), row.returnAmount.toFixed(2), row.netPurchaseAmount.toFixed(2)]);
  }
  lines.push("");

  pushRow(["สรุปขายแยกลูกค้า"]);
  pushRow(["รหัสลูกค้า", "ลูกค้า", "จำนวนบิล", "ยอดขาย", "ยอดคืน", "Net Sale", "ยอดค้างชำระ"]);
  for (const row of data.customers.items) {
    pushRow([row.customerCode || "-", row.customerName, row.invoiceCount, row.grossSalesAmount.toFixed(2), row.returnAmount.toFixed(2), row.netSalesAmount.toFixed(2), row.outstandingAmount.toFixed(2)]);
  }
  lines.push("");

  pushRow(["สินค้าใกล้ minStock"]);
  pushRow(["รหัส", "สินค้า", "หมวดหมู่", "คงเหลือ", "ขั้นต่ำ", "มูลค่า"]);
  for (const row of data.stock.lowStockItems) {
    pushRow([row.code, row.name, row.categoryName, row.stock, row.minStock, row.stockValue.toFixed(2)]);
  }
  lines.push("");

  pushRow(["ประกันใกล้หมด"]);
  pushRow(["เลขที่ขาย", "ลูกค้า", "รหัสสินค้า", "สินค้า", "วันหมดประกัน", "วันคงเหลือ"]);
  for (const row of data.warranties.expiringItems) {
    pushRow([row.saleNo, row.customerName, row.productCode, row.productName, formatDateInput(row.endDate), row.daysLeft]);
  }

  return `\uFEFF${lines.join("\n")}`;
}
