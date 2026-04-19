import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { resolveReportUnit, toReportUnitPrice, toReportUnitQty } from "@/lib/report-unit";
import {
  formatDateOnlyForInput,
  formatDateThai,
  getThailandDateKey,
  getThailandMonthStartDateKey,
  isDateOnlyString,
  parseDateOnlyToDate,
  parseDateOnlyToEndOfDay,
} from "@/lib/th-date";

// â”€â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const BOM = "\uFEFF";

function fmtDate(d: Date): string {
  return formatDateThai(d);
}

function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(",");
}

function endOfDay(d: Date): Date {
  return parseDateOnlyToEndOfDay(formatDateOnlyForInput(d));
}

function parseDate(s: string | undefined, fallback: Date): Date {
  if (!s || !isDateOnlyString(s)) return fallback;
  return parseDateOnlyToDate(s);
}

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1e3a5f" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
  size: 10,
};

function styleHeader(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1);
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
  });
  row.height = 22;
}

// â”€â”€â”€ filter parser â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type ARAPStockFilters = {
  from: Date;
  to: Date;
  fromStr: string;
  toStr: string;
  hasFilter: boolean;
  submitted: boolean;
  customerId?: string;
  arMode?: "ALL" | "NORMAL" | "COD";
  supplierId?: string;
  categoryId?: string;
  search?: string;
  showAll?: boolean;
};

export function parseARAPStockFilters(
  params: Record<string, string | undefined>,
): ARAPStockFilters {
  const today = new Date();
  const firstOfMonth = parseDateOnlyToDate(getThailandMonthStartDateKey(today));
  const from = parseDate(params.from, firstOfMonth);
  const to = parseDate(params.to, today);
  return {
    from,
    to: endOfDay(to),
    fromStr: params.from ?? formatDateOnlyForInput(from),
    toStr: params.to ?? getThailandDateKey(today),
    hasFilter: !!(
      params.submitted === "1" ||
      params.from ||
      params.to ||
      params.customerId ||
      params.arMode ||
      params.supplierId ||
      params.categoryId ||
      params.search ||
      params.showAll
    ),
    submitted: params.submitted === "1",
    customerId: params.customerId || undefined,
    arMode:
      params.arMode === "NORMAL" || params.arMode === "COD"
        ? params.arMode
        : "ALL",
    supplierId: params.supplierId || undefined,
    categoryId: params.categoryId || undefined,
    search: params.search || undefined,
    showAll: params.showAll === "1",
  };
}

// â”€â”€â”€ AR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type ARRow = {
  id: string;
  saleNo: string;
  saleDate: Date;
  customerName: string | null;
  customerPhone: string | null;
  customer: { name: string; phone: string | null } | null;
  totalAmount: number;
  amountRemain: number;
  creditTerm: number | null;
};

export async function queryARRows(filters: ARAPStockFilters): Promise<ARRow[]> {
  const arModeWhere =
    filters.arMode === "COD"
      ? {
          paymentType: "CREDIT_SALE" as const,
          fulfillmentType: "DELIVERY" as const,
          shippingStatus: { not: "DELIVERED" as const },
        }
      : filters.arMode === "NORMAL"
        ? {
            paymentType: "CREDIT_SALE" as const,
            NOT: {
              fulfillmentType: "DELIVERY" as const,
              shippingStatus: { not: "DELIVERED" as const },
            },
          }
        : {
            paymentType: "CREDIT_SALE" as const,
          };

  const rows = await db.sale.findMany({
    where: {
      status: "ACTIVE",
      amountRemain: { gt: 0 },
      ...arModeWhere,
      ...(filters.customerId ? { customerId: filters.customerId } : {}),
      saleDate: {
        gte: filters.from,
        lte: filters.to,
      },
    },
    orderBy: { saleDate: "asc" },
    take: 500,
    select: {
      id: true,
      saleNo: true,
      saleDate: true,
      customerName: true,
      customerPhone: true,
      customer: { select: { name: true, phone: true } },
      netAmount: true,
      amountRemain: true,
      creditTerm: true,
    },
  });

  return rows.map((r) => ({
    ...r,
    totalAmount: Number(r.netAmount),
    amountRemain: Number(r.amountRemain),
  }));
}

export function buildARCsv(rows: ARRow[]): string {
  const header = csvRow(["à¹€à¸¥à¸‚à¸—à¸µà¹ˆ", "à¸§à¸±à¸™à¸—à¸µà¹ˆà¸‚à¸²à¸¢", "à¸¥à¸¹à¸à¸„à¹‰à¸²", "à¸¢à¸­à¸”à¸‚à¸²à¸¢", "à¸„à¹‰à¸²à¸‡à¸Šà¸³à¸£à¸°", "à¹€à¸„à¸£à¸”à¸´à¸• (à¸§à¸±à¸™)"]);
  const body = rows.map((r) =>
    csvRow([
      r.saleNo,
      fmtDate(r.saleDate),
      r.customer?.name ?? r.customerName ?? "",
      r.totalAmount,
      r.amountRemain,
      r.creditTerm ?? "",
    ]),
  );
  return BOM + [header, ...body].join("\r\n");
}

export async function buildARExcel(rows: ARRow[], title: string): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(title);

  ws.columns = [
    { header: "à¹€à¸¥à¸‚à¸—à¸µà¹ˆ", key: "saleNo", width: 16 },
    { header: "à¸§à¸±à¸™à¸—à¸µà¹ˆà¸‚à¸²à¸¢", key: "saleDate", width: 12 },
    { header: "à¸¥à¸¹à¸à¸„à¹‰à¸²", key: "customerName", width: 28 },
    { header: "à¸¢à¸­à¸”à¸‚à¸²à¸¢", key: "totalAmount", width: 14 },
    { header: "à¸„à¹‰à¸²à¸‡à¸Šà¸³à¸£à¸°", key: "amountRemain", width: 14 },
    { header: "à¹€à¸„à¸£à¸”à¸´à¸• (à¸§à¸±à¸™)", key: "creditTerm", width: 12 },
  ];
  styleHeader(ws);

  for (const r of rows) {
    const row = ws.addRow({
      saleNo: r.saleNo,
      saleDate: fmtDate(r.saleDate),
      customerName: r.customer?.name ?? r.customerName ?? "",
      totalAmount: r.totalAmount,
      amountRemain: r.amountRemain,
      creditTerm: r.creditTerm ?? "",
    });
    row.getCell("totalAmount").numFmt = "#,##0.00";
    row.getCell("amountRemain").numFmt = "#,##0.00";
    row.getCell("amountRemain").font = { color: { argb: "FFE02020" } };
  }

  const totalRow = ws.addRow({});
  totalRow.getCell(3).value = "à¸£à¸§à¸¡";
  totalRow.getCell(3).font = { bold: true };
  totalRow.getCell(3).alignment = { horizontal: "right" };
  totalRow.getCell(4).value = rows.reduce((s, r) => s + r.totalAmount, 0);
  totalRow.getCell(4).numFmt = "#,##0.00";
  totalRow.getCell(4).font = { bold: true };
  totalRow.getCell(5).value = rows.reduce((s, r) => s + r.amountRemain, 0);
  totalRow.getCell(5).numFmt = "#,##0.00";
  totalRow.getCell(5).font = { bold: true, color: { argb: "FFE02020" } };
  totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf]);
}

// â”€â”€â”€ AP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type APData = {
  purchases: { id: string; purchaseNo: string; purchaseDate: Date; supplierName: string; totalAmount: number; amountRemain: number }[];
  advances: { id: string; advanceNo: string; advanceDate: Date; supplierName: string; totalAmount: number; amountRemain: number }[];
  cnCredits: { id: string; returnNo: string; returnDate: Date; supplierName: string; totalAmount: number; amountRemain: number }[];
};

export async function queryAPData(filters: ARAPStockFilters): Promise<APData> {
  const dateWhere = (field: string) => ({
    [field]: { gte: filters.from, lte: filters.to },
  });
  const supplierWhere = filters.supplierId ? { supplierId: filters.supplierId } : {};

  const [purchases, advances, cnCredits] = await Promise.all([
    db.purchase.findMany({
      where: {
        purchaseType: "CREDIT_PURCHASE",
        status: "ACTIVE",
        amountRemain: { gt: 0 },
        ...supplierWhere,
        ...dateWhere("purchaseDate"),
      },
      orderBy: { purchaseDate: "asc" },
      take: 500,
      select: {
        id: true,
        purchaseNo: true,
        purchaseDate: true,
        supplier: { select: { name: true } },
        totalAmount: true,
        amountRemain: true,
      },
    }),
    db.supplierAdvance.findMany({
      where: {
        status: "ACTIVE",
        amountRemain: { gt: 0 },
        ...supplierWhere,
        ...dateWhere("advanceDate"),
      },
      orderBy: { advanceDate: "asc" },
      take: 500,
      select: {
        id: true,
        advanceNo: true,
        advanceDate: true,
        supplier: { select: { name: true } },
        totalAmount: true,
        amountRemain: true,
      },
    }),
    db.purchaseReturn.findMany({
      where: {
        settlementType: "SUPPLIER_CREDIT",
        status: "ACTIVE",
        amountRemain: { gt: 0 },
        ...supplierWhere,
        ...dateWhere("returnDate"),
      },
      orderBy: { returnDate: "asc" },
      take: 500,
      select: {
        id: true,
        returnNo: true,
        returnDate: true,
        supplier: { select: { name: true } },
        totalAmount: true,
        amountRemain: true,
      },
    }),
  ]);

  return {
    purchases: purchases.map((r) => ({
      ...r,
      supplierName: r.supplier?.name ?? "",
      totalAmount: Number(r.totalAmount),
      amountRemain: Number(r.amountRemain),
    })),
    advances: advances.map((r) => ({
      ...r,
      supplierName: r.supplier?.name ?? "",
      totalAmount: Number(r.totalAmount),
      amountRemain: Number(r.amountRemain),
    })),
    cnCredits: cnCredits.map((r) => ({
      ...r,
      supplierName: r.supplier?.name ?? "",
      totalAmount: Number(r.totalAmount),
      amountRemain: Number(r.amountRemain),
    })),
  };
}

export function buildAPCsv(data: APData): string {
  const sections: string[] = [];

  sections.push(csvRow(["=== à¸„à¹‰à¸²à¸‡à¸ˆà¹ˆà¸²à¸¢à¸‹à¸±à¸žà¸žà¸¥à¸²à¸¢à¹€à¸­à¸­à¸£à¹Œ (à¸‹à¸·à¹‰à¸­à¹€à¸Šà¸·à¹ˆà¸­) ==="]));
  sections.push(csvRow(["à¹€à¸¥à¸‚à¸—à¸µà¹ˆ", "à¸§à¸±à¸™à¸—à¸µà¹ˆà¸‹à¸·à¹‰à¸­", "à¸‹à¸±à¸žà¸žà¸¥à¸²à¸¢à¹€à¸­à¸­à¸£à¹Œ", "à¸¢à¸­à¸”à¸‹à¸·à¹‰à¸­", "à¸„à¹‰à¸²à¸‡à¸ˆà¹ˆà¸²à¸¢"]));
  for (const r of data.purchases) {
    sections.push(csvRow([r.purchaseNo, fmtDate(r.purchaseDate), r.supplierName, r.totalAmount, r.amountRemain]));
  }

  sections.push(csvRow([]));
  sections.push(csvRow(["=== à¹€à¸‡à¸´à¸™à¸¡à¸±à¸”à¸ˆà¸³à¸‹à¸±à¸žà¸žà¸¥à¸²à¸¢à¹€à¸­à¸­à¸£à¹Œà¸„à¸‡à¹€à¸«à¸¥à¸·à¸­ ==="]));
  sections.push(csvRow(["à¹€à¸¥à¸‚à¸—à¸µà¹ˆ", "à¸§à¸±à¸™à¸—à¸µà¹ˆ", "à¸‹à¸±à¸žà¸žà¸¥à¸²à¸¢à¹€à¸­à¸­à¸£à¹Œ", "à¸¢à¸­à¸”à¸¡à¸±à¸”à¸ˆà¸³", "à¸„à¸‡à¹€à¸«à¸¥à¸·à¸­"]));
  for (const r of data.advances) {
    sections.push(csvRow([r.advanceNo, fmtDate(r.advanceDate), r.supplierName, r.totalAmount, r.amountRemain]));
  }

  sections.push(csvRow([]));
  sections.push(csvRow(["=== à¹€à¸„à¸£à¸”à¸´à¸• CN à¸„à¸·à¸™à¸ªà¸´à¸™à¸„à¹‰à¸² à¸„à¸‡à¹€à¸«à¸¥à¸·à¸­ ==="]));
  sections.push(csvRow(["à¹€à¸¥à¸‚à¸—à¸µà¹ˆ", "à¸§à¸±à¸™à¸—à¸µà¹ˆà¸„à¸·à¸™", "à¸‹à¸±à¸žà¸žà¸¥à¸²à¸¢à¹€à¸­à¸­à¸£à¹Œ", "à¸¢à¸­à¸”à¸„à¸·à¸™", "à¸„à¸‡à¹€à¸«à¸¥à¸·à¸­"]));
  for (const r of data.cnCredits) {
    sections.push(csvRow([r.returnNo, fmtDate(r.returnDate), r.supplierName, r.totalAmount, r.amountRemain]));
  }

  return BOM + sections.join("\r\n");
}

export async function buildAPExcel(data: APData, title: string): Promise<Blob> {
  const wb = new ExcelJS.Workbook();

  const makeSheet = (
    name: string,
    headers: { header: string; key: string; width: number }[],
    rows: Record<string, string | number>[],
    amountKeys: string[],
  ) => {
    const ws = wb.addWorksheet(name);
    ws.columns = headers;
    styleHeader(ws);
    for (const r of rows) {
      const row = ws.addRow(r);
      amountKeys.forEach((k) => {
        row.getCell(k).numFmt = "#,##0.00";
      });
    }
    if (rows.length > 0) {
      const totalRow = ws.addRow({});
      const lastLabelCol = headers.length - amountKeys.length;
      totalRow.getCell(lastLabelCol).value = "à¸£à¸§à¸¡";
      totalRow.getCell(lastLabelCol).font = { bold: true };
      totalRow.getCell(lastLabelCol).alignment = { horizontal: "right" };
      amountKeys.forEach((k, i) => {
        const col = headers.length - amountKeys.length + 1 + i;
        const key = k as keyof (typeof rows)[0];
        totalRow.getCell(col).value = rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);
        totalRow.getCell(col).numFmt = "#,##0.00";
        totalRow.getCell(col).font = { bold: true };
      });
      totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    }
  };

  makeSheet(
    "à¸„à¹‰à¸²à¸‡à¸ˆà¹ˆà¸²à¸¢à¸‹à¸±à¸žà¸žà¸¥à¸²à¸¢à¹€à¸­à¸­à¸£à¹Œ",
    [
      { header: "à¹€à¸¥à¸‚à¸—à¸µà¹ˆ", key: "purchaseNo", width: 16 },
      { header: "à¸§à¸±à¸™à¸—à¸µà¹ˆà¸‹à¸·à¹‰à¸­", key: "purchaseDate", width: 12 },
      { header: "à¸‹à¸±à¸žà¸žà¸¥à¸²à¸¢à¹€à¸­à¸­à¸£à¹Œ", key: "supplierName", width: 28 },
      { header: "à¸¢à¸­à¸”à¸‹à¸·à¹‰à¸­", key: "totalAmount", width: 14 },
      { header: "à¸„à¹‰à¸²à¸‡à¸ˆà¹ˆà¸²à¸¢", key: "amountRemain", width: 14 },
    ],
    data.purchases.map((r) => ({ ...r, purchaseDate: fmtDate(r.purchaseDate) })),
    ["totalAmount", "amountRemain"],
  );

  makeSheet(
    "à¹€à¸‡à¸´à¸™à¸¡à¸±à¸”à¸ˆà¸³à¸„à¸‡à¹€à¸«à¸¥à¸·à¸­",
    [
      { header: "à¹€à¸¥à¸‚à¸—à¸µà¹ˆ", key: "advanceNo", width: 16 },
      { header: "à¸§à¸±à¸™à¸—à¸µà¹ˆ", key: "advanceDate", width: 12 },
      { header: "à¸‹à¸±à¸žà¸žà¸¥à¸²à¸¢à¹€à¸­à¸­à¸£à¹Œ", key: "supplierName", width: 28 },
      { header: "à¸¢à¸­à¸”à¸¡à¸±à¸”à¸ˆà¸³", key: "totalAmount", width: 14 },
      { header: "à¸„à¸‡à¹€à¸«à¸¥à¸·à¸­", key: "amountRemain", width: 14 },
    ],
    data.advances.map((r) => ({ ...r, advanceDate: fmtDate(r.advanceDate) })),
    ["totalAmount", "amountRemain"],
  );

  makeSheet(
    "CN à¹€à¸„à¸£à¸”à¸´à¸•à¸„à¸‡à¹€à¸«à¸¥à¸·à¸­",
    [
      { header: "à¹€à¸¥à¸‚à¸—à¸µà¹ˆ", key: "returnNo", width: 16 },
      { header: "à¸§à¸±à¸™à¸—à¸µà¹ˆà¸„à¸·à¸™", key: "returnDate", width: 12 },
      { header: "à¸‹à¸±à¸žà¸žà¸¥à¸²à¸¢à¹€à¸­à¸­à¸£à¹Œ", key: "supplierName", width: 28 },
      { header: "à¸¢à¸­à¸”à¸„à¸·à¸™", key: "totalAmount", width: 14 },
      { header: "à¸„à¸‡à¹€à¸«à¸¥à¸·à¸­", key: "amountRemain", width: 14 },
    ],
    data.cnCredits.map((r) => ({ ...r, returnDate: fmtDate(r.returnDate) })),
    ["totalAmount", "amountRemain"],
  );

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf]);
}

// â”€â”€â”€ Stock â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type StockRow = {
  id: string;
  code: string;
  name: string;
  categoryName: string;
  stock: number;
  avgCost: number;
  stockValue: number;
  minStock: number | null;
  unitName: string;
};

export async function queryStockRows(filters: ARAPStockFilters): Promise<StockRow[]> {
  const rows = await db.product.findMany({
    where: {
      isActive: true,
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.search
        ? {
            OR: [
              { name: { contains: filters.search, mode: "insensitive" } },
              { code: { contains: filters.search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ category: { name: "asc" } }, { code: "asc" }],
    take: 1000,
    select: {
      id: true,
      code: true,
      name: true,
      stock: true,
      avgCost: true,
      reportUnitName: true,
      minStock: true,
      units: { select: { name: true, scale: true, isBase: true } },
      category: { select: { name: true } },
    },
  });

  const latestBalances = rows.length
    ? await db.stockCard.findMany({
        where: { productId: { in: rows.map((row) => row.id) } },
        orderBy: [{ productId: "asc" }, { docDate: "desc" }, { sorder: "desc" }],
        distinct: ["productId"],
        select: {
          productId: true,
          qtyBalance: true,
          priceBalance: true,
        },
      })
    : [];

  const latestBalanceMap = new Map(
    latestBalances.map((row) => [
      row.productId,
      {
        stock: Number(row.qtyBalance),
        avgCost: Number(row.priceBalance),
      },
    ]),
  );

  return rows
    .map((r) => {
      const latestBalance = latestBalanceMap.get(r.id);
      const { unitName, scale } = resolveReportUnit({
        reportUnitName: r.reportUnitName,
        units: r.units,
      });
      const stock = toReportUnitQty(latestBalance?.stock ?? Number(r.stock), scale);
      const avgCost = toReportUnitPrice(latestBalance?.avgCost ?? Number(r.avgCost), scale);
      return {
        id: r.id,
        code: r.code,
        name: r.name,
        categoryName: r.category.name,
        stock,
        avgCost,
        stockValue: stock * avgCost,
        minStock: r.minStock,
        unitName,
      };
    })
    .filter((row) => filters.showAll || row.stock > 0);
}

export function buildStockCsv(rows: StockRow[]): string {
  const header = csvRow([
    "รหัส",
    "ชื่อสินค้า",
    "หมวดหมู่",
    "หน่วยนับ",
    "Stock คงเหลือ",
    "ต้นทุนเฉลี่ย",
    "มูลค่า",
    "ขั้นต่ำ",
  ]);
  const body = rows.map((r) =>
    csvRow([
      r.code,
      r.name,
      r.categoryName,
      r.unitName,
      r.stock,
      r.avgCost,
      r.stockValue,
      r.minStock ?? "",
    ]),
  );
  return BOM + [header, ...body].join("\r\n");
}

export async function buildStockExcel(rows: StockRow[], title: string): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(title);

  ws.columns = [
    { header: "รหัส", key: "code", width: 14 },
    { header: "ชื่อสินค้า", key: "name", width: 32 },
    { header: "หมวดหมู่", key: "categoryName", width: 18 },
    { header: "หน่วยนับ", key: "unitName", width: 12 },
    { header: "Stock คงเหลือ", key: "stock", width: 14 },
    { header: "ต้นทุนเฉลี่ย", key: "avgCost", width: 14 },
    { header: "มูลค่า", key: "stockValue", width: 14 },
    { header: "ขั้นต่ำ", key: "minStock", width: 10 },
  ];
  styleHeader(ws);

  for (const r of rows) {
    const row = ws.addRow({
      code: r.code,
      name: r.name,
      categoryName: r.categoryName,
      unitName: r.unitName,
      stock: r.stock,
      avgCost: r.avgCost,
      stockValue: r.stockValue,
      minStock: r.minStock ?? "",
    });
    row.getCell("stock").numFmt = "#,##0.####";
    row.getCell("avgCost").numFmt = "#,##0.00";
    row.getCell("stockValue").numFmt = "#,##0.00";
    if (r.minStock != null && r.stock <= r.minStock) {
      row.font = { color: { argb: "FFB91C1C" } };
    }
  }

  const totalRow = ws.addRow({});
  totalRow.getCell(2).value = "รวม";
  totalRow.getCell(2).font = { bold: true };
  totalRow.getCell(2).alignment = { horizontal: "right" };
  totalRow.getCell(7).value = rows.reduce((s, r) => s + r.stockValue, 0);
  totalRow.getCell(7).numFmt = "#,##0.00";
  totalRow.getCell(7).font = { bold: true };
  totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf]);
}

