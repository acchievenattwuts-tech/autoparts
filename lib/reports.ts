import { db } from "@/lib/db";

type ReportRange = {
  from: Date;
  to: Date;
};

type SalesBucket = {
  label: string;
  invoiceCount: number;
  netAmount: number;
  subtotalAmount: number;
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

export type ReportsData = {
  range: {
    from: string;
    to: string;
  };
  salesSummary: {
    totalInvoices: number;
    totalNetAmount: number;
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

function groupSalesBuckets(
  sales: Array<{ saleDate: Date; netAmount: number; subtotalAmount: number; vatAmount: number }>,
  mode: "day" | "week" | "month"
): SalesBucket[] {
  const bucketMap = new Map<
    string,
    {
      label: string;
      invoiceCount: number;
      netAmount: number;
      subtotalAmount: number;
      vatAmount: number;
      sortDate: Date;
    }
  >();

  for (const sale of sales) {
    let key: string;
    let label: string;
    let sortDate: Date;

    if (mode === "day") {
      key = formatDateInput(sale.saleDate);
      label = formatDateShort(sale.saleDate);
      sortDate = startOfDay(sale.saleDate);
    } else if (mode === "week") {
      const weekStart = startOfWeek(sale.saleDate);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      key = formatDateInput(weekStart);
      label = `${formatDateShort(weekStart)} - ${formatDateShort(weekEnd)}`;
      sortDate = weekStart;
    } else {
      key = formatMonthKey(sale.saleDate);
      label = sale.saleDate.toLocaleDateString("th-TH-u-ca-gregory", {
        month: "long",
        year: "numeric",
      });
      sortDate = new Date(sale.saleDate.getFullYear(), sale.saleDate.getMonth(), 1);
    }

    const existing = bucketMap.get(key) ?? {
      label,
      invoiceCount: 0,
      netAmount: 0,
      subtotalAmount: 0,
      vatAmount: 0,
      sortDate,
    };

    existing.invoiceCount += 1;
    existing.netAmount += sale.netAmount;
    existing.subtotalAmount += sale.subtotalAmount;
    existing.vatAmount += sale.vatAmount;

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

export function parseReportRange(params: {
  from?: string;
  to?: string;
}): ReportRange & { fromInput: string; toInput: string } {
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
  };
}

export async function getReportsData(range: ReportRange): Promise<ReportsData> {
  const now = new Date();
  const soonDate = new Date(now.getTime() + 30 * DAY_MS);

  const [sales, creditNotes, purchases, expenses, products, warranties] = await Promise.all([
    db.sale.findMany({
      where: {
        status: "ACTIVE",
        saleDate: { gte: range.from, lte: range.to },
      },
      orderBy: [{ saleDate: "asc" }, { saleNo: "asc" }],
      select: {
        id: true,
        saleDate: true,
        netAmount: true,
        subtotalAmount: true,
        vatAmount: true,
        items: {
          select: {
            quantity: true,
            costPrice: true,
          },
        },
      },
    }),
    db.creditNote.findMany({
      where: {
        status: "ACTIVE",
        cnDate: { gte: range.from, lte: range.to },
      },
      select: {
        type: true,
        totalAmount: true,
        vatAmount: true,
      },
    }),
    db.purchase.findMany({
      where: {
        status: "ACTIVE",
        purchaseDate: { gte: range.from, lte: range.to },
      },
      select: {
        vatAmount: true,
      },
    }),
    db.expense.findMany({
      where: {
        status: "ACTIVE",
        expenseDate: { gte: range.from, lte: range.to },
      },
      select: {
        netAmount: true,
        vatAmount: true,
      },
    }),
    db.product.findMany({
      where: {
        isActive: true,
      },
      orderBy: [{ stock: "asc" }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        stock: true,
        minStock: true,
        avgCost: true,
        category: {
          select: { name: true },
        },
      },
    }),
    db.warranty.findMany({
      where: {
        endDate: { lte: soonDate },
      },
      orderBy: [{ endDate: "asc" }, { sale: { saleNo: "asc" } }],
      select: {
        id: true,
        endDate: true,
        product: {
          select: {
            code: true,
            name: true,
          },
        },
        sale: {
          select: {
            saleNo: true,
            customerName: true,
          },
        },
      },
      take: 100,
    }),
  ]);

  const normalizedSales = sales.map((sale) => ({
    saleDate: sale.saleDate,
    netAmount: toNumber(sale.netAmount),
    subtotalAmount: toNumber(sale.subtotalAmount),
    vatAmount: toNumber(sale.vatAmount),
    cogs: sale.items.reduce(
      (sum, item) => sum + Number(item.quantity) * toNumber(item.costPrice),
      0
    ),
  }));

  const grossSales = normalizedSales.reduce((sum, sale) => sum + sale.netAmount, 0);
  const totalInvoices = normalizedSales.length;
  const costOfGoodsSold = normalizedSales.reduce((sum, sale) => sum + sale.cogs, 0);
  const salesVat = normalizedSales.reduce((sum, sale) => sum + sale.vatAmount, 0);

  const salesReturns = creditNotes.reduce((sum, cn) => sum + toNumber(cn.totalAmount), 0);
  const creditNoteVat = creditNotes.reduce((sum, cn) => sum + toNumber(cn.vatAmount), 0);
  const purchaseVat = purchases.reduce((sum, purchase) => sum + toNumber(purchase.vatAmount), 0);
  const expenseTotal = expenses.reduce((sum, expense) => sum + toNumber(expense.netAmount), 0);
  const expenseVat = expenses.reduce((sum, expense) => sum + toNumber(expense.vatAmount), 0);

  const netRevenue = grossSales - salesReturns;
  const grossProfit = netRevenue - costOfGoodsSold;
  const netProfit = grossProfit - expenseTotal;
  const vatPayable = (salesVat - creditNoteVat) - (purchaseVat + expenseVat);

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
  const highestValueItems = [...stockRows]
    .sort((a, b) => b.stockValue - a.stockValue)
    .slice(0, 20);

  const expiringItems: WarrantyRow[] = warranties.map((warranty) => ({
    id: warranty.id,
    productCode: warranty.product.code,
    productName: warranty.product.name,
    customerName: warranty.sale.customerName ?? "-",
    saleNo: warranty.sale.saleNo,
    endDate: warranty.endDate,
    daysLeft: Math.ceil((startOfDay(warranty.endDate).getTime() - startOfDay(now).getTime()) / DAY_MS),
  }));

  return {
    range: {
      from: formatDateInput(range.from),
      to: formatDateInput(range.to),
    },
    salesSummary: {
      totalInvoices,
      totalNetAmount: grossSales,
      byDay: groupSalesBuckets(normalizedSales, "day"),
      byWeek: groupSalesBuckets(normalizedSales, "week"),
      byMonth: groupSalesBuckets(normalizedSales, "month"),
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
  };
}

export function buildReportsCsv(data: ReportsData): string {
  const lines: string[] = [];
  const pushRow = (values: Array<string | number>) => {
    lines.push(values.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","));
  };

  pushRow(["ช่วงรายงาน", `${data.range.from} ถึง ${data.range.to}`]);
  lines.push("");

  pushRow(["สรุปยอดขายรายวัน"]);
  pushRow(["ช่วงเวลา", "จำนวนบิล", "ยอดสุทธิ", "ก่อน VAT", "VAT"]);
  for (const row of data.salesSummary.byDay) {
    pushRow([row.label, row.invoiceCount, row.netAmount.toFixed(2), row.subtotalAmount.toFixed(2), row.vatAmount.toFixed(2)]);
  }
  lines.push("");

  pushRow(["กำไรขาดทุน", "มูลค่า"]);
  pushRow(["รายการ", "มูลค่า"]);
  pushRow(["ยอดขายรวม", data.profitLoss.grossSales.toFixed(2)]);
  pushRow(["หัก Credit Note", data.profitLoss.salesReturns.toFixed(2)]);
  pushRow(["รายได้สุทธิ", data.profitLoss.netRevenue.toFixed(2)]);
  pushRow(["ต้นทุนขาย", data.profitLoss.costOfGoodsSold.toFixed(2)]);
  pushRow(["กำไรขั้นต้น", data.profitLoss.grossProfit.toFixed(2)]);
  pushRow(["ค่าใช้จ่าย", data.profitLoss.expenseTotal.toFixed(2)]);
  pushRow(["กำไรสุทธิ", data.profitLoss.netProfit.toFixed(2)]);
  pushRow(["VAT ขาย", data.profitLoss.salesVat.toFixed(2)]);
  pushRow(["VAT Credit Note", data.profitLoss.creditNoteVat.toFixed(2)]);
  pushRow(["VAT ซื้อ", data.profitLoss.purchaseVat.toFixed(2)]);
  pushRow(["VAT ค่าใช้จ่าย", data.profitLoss.expenseVat.toFixed(2)]);
  pushRow(["VAT คงชำระ", data.profitLoss.vatPayable.toFixed(2)]);
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
    pushRow([
      row.saleNo,
      row.customerName,
      row.productCode,
      row.productName,
      formatDateInput(row.endDate),
      row.daysLeft,
    ]);
  }

  return `\uFEFF${lines.join("\n")}`;
}
