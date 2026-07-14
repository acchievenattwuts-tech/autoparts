import ExcelJS from "exceljs";

import { parseAdminProductFilterParams } from "@/lib/admin-product-filter-params";
import { db } from "@/lib/db";
import { searchProductIds, sortProductsByIds } from "@/lib/product-search";
import { getLatestStockBalances } from "@/lib/stock-card-latest-balance";

const BOM = "\uFEFF";
const MAX_EXPORT_ROWS = 10000;

const numberOrNull = (value?: string): number | null => {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

export type ProductReportFilters = {
  search?: string;
  categoryId?: string;
  brandId?: string;
  carBrandId?: string;
  carModelId?: string;
  yearMin?: string;
  yearMax?: string;
  stockStatus?: string;
  statusFilter?: string;
  trackingFilter?: string;
};

export type ProductReportRow = {
  code: string;
  name: string;
  categoryName: string;
  brandName: string;
  shelfLocation: string;
  stock: number;
  mainUnitName: string;
  purchaseLastPrice: number | null;
  purchaseUnitName: string;
  avgCost: number;
  salePrice: number;
  warranty: string;
  status: string;
};

function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  return text.includes(",") || text.includes('"') || text.includes("\n")
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

function csvRow(cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(",");
}

function getProductReportHeaders(): string[] {
  return [
    "รหัสสินค้า",
    "ชื่อสินค้า",
    "หมวดหมู่",
    "แบรน",
    "ตำแหน่ง shelf",
    "stock",
    "หน่วยนับหลัก",
    "ราคาซื้อล่าสุด",
    "หน่วยนับซื้อ",
    "ราคาต้นทุนเฉลี่ย",
    "ราคาขาย",
    "ประกัน",
    "สถานะ",
  ];
}

export function parseProductReportFilters(
  params: Record<string, string | undefined>,
): ProductReportFilters {
  return parseAdminProductFilterParams(params);
}

export async function queryProductReportRows(filters: ProductReportFilters): Promise<ProductReportRow[]> {
  const searchIsActive =
    filters.statusFilter === "active"
      ? true
      : filters.statusFilter === "inactive"
        ? false
        : undefined;
  const inventoryTracking: "TRACKED" | "NON_TRACKED" | undefined =
    filters.trackingFilter === "tracked"
      ? "TRACKED"
      : filters.trackingFilter === "non_tracked"
        ? "NON_TRACKED"
        : undefined;

  const searchResult = await searchProductIds({
    query: filters.search,
    categoryId: filters.categoryId,
    brandId: filters.brandId,
    carBrandId: filters.carBrandId,
    carModelId: filters.carModelId,
    isActive: searchIsActive,
    yearMin: numberOrNull(filters.yearMin),
    yearMax: numberOrNull(filters.yearMax),
    inventoryTracking,
    skip: 0,
    take: MAX_EXPORT_ROWS,
    order: "codeDesc",
    cacheProfile: "admin",
    disableSemantic: true,
  });

  const rawProducts = sortProductsByIds(
    await db.product.findMany({
      where: {
        id: { in: searchResult.ids.length > 0 ? searchResult.ids : ["__no-results__"] },
      },
      select: {
        id: true,
        code: true,
        name: true,
        shelfLocation: true,
        stock: true,
        minStock: true,
        salePrice: true,
        avgCost: true,
        purchaseLastPrice: true,
        purchaseUnitName: true,
        reportUnitName: true,
        warrantyDays: true,
        isActive: true,
        category: { select: { name: true } },
        brand: { select: { name: true } },
        units: { select: { name: true, scale: true, isBase: true } },
      },
    }),
    searchResult.ids,
  );

  const latestBalanceMap = await getLatestStockBalances(
    rawProducts.map((product) => product.id),
  );

  return rawProducts
    .map((product) => {
      const latestBalance = latestBalanceMap.get(product.id);
      const mainUnitName =
        product.units.find((unit) => unit.isBase)?.name ?? product.reportUnitName;
      const stock = latestBalance?.stock ?? Number(product.stock);
      const avgCost = latestBalance?.avgCost ?? Number(product.avgCost);

      return {
        code: product.code,
        name: product.name,
        categoryName: product.category.name,
        brandName: product.brand?.name ?? "",
        shelfLocation: product.shelfLocation ?? "",
        stock,
        mainUnitName,
        purchaseLastPrice:
          product.purchaseLastPrice == null ? null : Number(product.purchaseLastPrice),
        purchaseUnitName: product.purchaseUnitName,
        avgCost,
        salePrice: Number(product.salePrice),
        warranty: product.warrantyDays > 0 ? `${product.warrantyDays} วัน` : "",
        status: product.isActive ? "ใช้งาน" : "ปิดใช้งาน",
        minStock: product.minStock,
      };
    })
    .filter((row) => {
      if (filters.stockStatus === "in_stock") return row.stock > row.minStock;
      if (filters.stockStatus === "low_stock") return row.stock > 0 && row.stock <= row.minStock;
      if (filters.stockStatus === "out_of_stock") return row.stock <= 0;
      return true;
    })
    .map(({ minStock: _minStock, ...row }) => row);
}

export function buildProductReportCsv(rows: ProductReportRow[]): string {
  const header = csvRow(getProductReportHeaders());
  const body = rows.map((row) =>
    csvRow([
      row.code,
      row.name,
      row.categoryName,
      row.brandName,
      row.shelfLocation,
      row.stock,
      row.mainUnitName,
      row.purchaseLastPrice,
      row.purchaseUnitName,
      row.avgCost,
      row.salePrice,
      row.warranty,
      row.status,
    ]),
  );
  return BOM + [header, ...body].join("\r\n");
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

function styleHeader(sheet: ExcelJS.Worksheet) {
  const row = sheet.getRow(1);
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
    };
  });
  row.height = 22;
}

export async function buildProductReportExcel(rows: ProductReportRow[]): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("รายงานสินค้า");

  ws.columns = [
    { header: "รหัสสินค้า", key: "code", width: 16 },
    { header: "ชื่อสินค้า", key: "name", width: 32 },
    { header: "หมวดหมู่", key: "categoryName", width: 18 },
    { header: "แบรน", key: "brandName", width: 18 },
    { header: "ตำแหน่ง shelf", key: "shelfLocation", width: 16 },
    { header: "stock", key: "stock", width: 12 },
    { header: "หน่วยนับหลัก", key: "mainUnitName", width: 14 },
    { header: "ราคาซื้อล่าสุด", key: "purchaseLastPrice", width: 16 },
    { header: "หน่วยนับซื้อ", key: "purchaseUnitName", width: 14 },
    { header: "ราคาต้นทุนเฉลี่ย", key: "avgCost", width: 18 },
    { header: "ราคาขาย", key: "salePrice", width: 14 },
    { header: "ประกัน", key: "warranty", width: 12 },
    { header: "สถานะ", key: "status", width: 12 },
  ];
  styleHeader(ws);

  for (const row of rows) {
    const excelRow = ws.addRow({
      ...row,
      purchaseLastPrice: row.purchaseLastPrice ?? "",
    });
    excelRow.getCell("stock").numFmt = "#,##0.####";
    excelRow.getCell("purchaseLastPrice").numFmt = "#,##0.00";
    excelRow.getCell("avgCost").numFmt = "#,##0.00";
    excelRow.getCell("salePrice").numFmt = "#,##0.00";
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer]);
}
