import ExcelJS from "exceljs";
import { z } from "zod";

import type { ShelfLocationBadgeItem } from "@/components/shared/ShelfLocationBadges";
import {
  applyShelfLocationChange,
  describeShelfLocations,
  diffShelfLocations,
  formatShelfLocationCode,
  isEmptyShelfLocationDiff,
  isVerifyOnlyShelfDiff,
  MAX_SECONDARY_SHELF_LOCATIONS,
  normalizeShelfRackCode,
  parseShelfLocationCode,
  SHELF_LOCATION_NOTE_MAX_LENGTH,
  SHELF_RULE_ERROR_MESSAGES,
  sortShelfLocations,
  type ShelfLocationChange,
  type ShelfLocationDiff,
  type ShelfLocationDraft,
  type ShelfLocationTarget,
  type ShelfRackRule,
} from "@/lib/shelf-location-rules";
import { formatDateTimeThai } from "@/lib/th-date";

/**
 * Excel survey / recheck sheets for the shelf map (ผังชั้นวาง): building the printable
 * workbook, reading a filled one back and planning the import. Database-free (exceljs and
 * the shared rules only) so the whole round trip is unit-testable; the export route and
 * the import actions load the data and apply the plan.
 */

// ─── Layout ─────────────────────────────────────────────────────────────────

export const SHELF_EXPORT_MODES = ["survey", "recheck"] as const;
export type ShelfExportMode = (typeof SHELF_EXPORT_MODES)[number];

export const SHELF_EXPORT_MODE_TITLES: Record<ShelfExportMode, string> = {
  survey: "ใบสำรวจตำแหน่งสินค้า (ครั้งแรก)",
  recheck: "ใบตรวจตำแหน่งสินค้าซ้ำ",
};

export const SHELF_DATA_SHEET_NAME = "ตำแหน่งสินค้า";
export const SHELF_GUIDE_SHEET_NAME = "วิธีกรอก";
export const SHELF_RACK_SHEET_NAME = "ชั้นวาง";
export const SHELF_UNLOCATED_HEADING = "ยังไม่มีตำแหน่ง";
const SHELF_EXTRA_ROWS_HEADING = "แถวเพิ่ม: พบสินค้าที่ตำแหน่งอื่น ให้กรอกรหัสสินค้า ชั้นวาง และชั้น";
/** ASCII name so data-validation formulas need no quoting. */
const SHELF_LIST_SHEET_NAME = "lists";

export const SHELF_IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const SHELF_IMPORT_MAX_ROWS = 10_000;
/** Blank rows at the end of the sheet for a product found at one more place. */
export const SHELF_EXPORT_EXTRA_ROWS = 30;
export const SHELF_IMPORT_PREVIEW_MAX_CHANGES = 300;

const SHELF_IMPORT_READ_MAX_SHEET_ROWS = SHELF_IMPORT_MAX_ROWS + 2_000;
const SHELF_IMPORT_READ_MAX_COLUMNS = 100;
const SHELF_IMPORT_TEXT_MAX_LENGTH = 300;
const FITMENT_TEXT_MAX_LENGTH = 40;
const HEADER_FILTER_TEXT_MAX_LENGTH = 90;
const DATA_ROW_HEIGHT_PT = 26;
const HEADER_ROW_HEIGHT_PT = 32;
const HEADING_ROW_HEIGHT_PT = 22;
const A4_PAPER_SIZE = 9;
const PRINT_MARGINS = { left: 0.3, right: 0.3, top: 0.7, bottom: 0.7, header: 0.3, footer: 0.3 };

const PRIMARY_LABEL = "ประจำ";
const SECONDARY_LABEL = "เพิ่ม";

const BRAND_ARGB = "FF1E3A5F";
const WHITE_ARGB = "FFFFFFFF";
const INPUT_FILL_ARGB = "FFFFF7D6";
const INPUT_HEADER_ARGB = "FFFDE68A";
const HEADING_FILL_ARGB = "FFE2E8F0";

type ColumnKey =
  | "code"
  | "name"
  | "category"
  | "brand"
  | "fitment"
  | "stock"
  | "currentLocation"
  | "currentType"
  | "rack"
  | "level"
  | "type"
  | "confirm"
  | "notFound"
  | "note"
  | "productId"
  | "locationId"
  | "snapshot";

type ColumnSpec = {
  key: ColumnKey;
  header: string;
  width: number;
  input?: boolean;
  hidden?: boolean;
  wrap?: boolean;
  text?: boolean;
};

export const SHELF_SHEET_COLUMNS: readonly ColumnSpec[] = [
  { key: "code", header: "รหัสสินค้า", width: 16, text: true },
  { key: "name", header: "ชื่อสินค้า", width: 36, wrap: true },
  { key: "category", header: "หมวดหมู่", width: 14, wrap: true },
  { key: "brand", header: "แบรนด์อะไหล่", width: 12, wrap: true },
  { key: "fitment", header: "รุ่นรถ", width: 24, wrap: true },
  { key: "stock", header: "คงเหลือรวม", width: 9 },
  { key: "currentLocation", header: "ตำแหน่งปัจจุบัน", width: 11 },
  { key: "currentType", header: "ประเภทปัจจุบัน", width: 10 },
  { key: "rack", header: "ชั้นวาง", width: 8, input: true, text: true },
  { key: "level", header: "ชั้น", width: 6, input: true },
  { key: "type", header: "ประเภท", width: 8, input: true },
  { key: "confirm", header: "✓ ถูกต้อง", width: 8, input: true },
  { key: "notFound", header: "ไม่พบ", width: 7, input: true },
  { key: "note", header: "หมายเหตุ", width: 22, input: true, wrap: true },
  { key: "productId", header: "productId", width: 4, hidden: true },
  { key: "locationId", header: "locationId", width: 4, hidden: true },
  { key: "snapshot", header: "snapshot", width: 4, hidden: true },
];

const COLUMN_INDEX = new Map(SHELF_SHEET_COLUMNS.map((column, index) => [column.key, index + 1]));
const col = (key: ColumnKey): number => COLUMN_INDEX.get(key) ?? 0;
const VISIBLE_COLUMN_COUNT = SHELF_SHEET_COLUMNS.filter((column) => !column.hidden).length;

const solidFill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

const truncateText = (text: string, maxLength: number): string =>
  text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;

const thaiCompare = (left: string, right: string): number => left.localeCompare(right, "th");

// ─── Export rows ────────────────────────────────────────────────────────────

export const parseShelfExportMode = (value: string | null | undefined): ShelfExportMode =>
  value === "recheck" ? "recheck" : "survey";

/** "A-2|P" / "Z-1|S": what a location looked like when the sheet was exported. */
export const formatShelfSnapshot = (rackCode: string, level: number, isPrimary: boolean): string =>
  `${formatShelfLocationCode(rackCode, level)}|${isPrimary ? "P" : "S"}`;

const describeSnapshot = (snapshot: string): string => {
  const [code, kind] = snapshot.split("|");
  return code ? `${code} (${kind === "P" ? PRIMARY_LABEL : SECONDARY_LABEL})` : "-";
};

export type ShelfFitmentName = { brand: string; model: string };

/** "Toyota Vigo, Revo · Isuzu D-Max", cut to fit one printed cell. */
export const formatShelfFitmentText = (
  names: readonly ShelfFitmentName[],
  maxLength: number = FITMENT_TEXT_MAX_LENGTH,
): string => {
  const byBrand = new Map<string, string[]>();
  for (const { brand, model } of names) {
    const models = byBrand.get(brand) ?? [];
    if (!models.includes(model)) models.push(model);
    byBrand.set(brand, models);
  }
  const text = [...byBrand].map(([brand, models]) => `${brand} ${models.join(", ")}`.trim()).join(" · ");
  return truncateText(text, maxLength);
};

export type ShelfExportRack = { id: string; code: string; name: string | null; levels: number; isActive: boolean };

export type ShelfExportLocation = { id: string; rackId: string; level: number; isPrimary: boolean; createdAt: Date };

export type ShelfExportProduct = {
  id: string;
  code: string;
  name: string;
  categoryName: string;
  brandName: string;
  fitmentText: string;
  stock: number;
  locations: ShelfExportLocation[];
};

export type ShelfSheetLine =
  | { kind: "heading"; text: string; pageBreakBefore: boolean }
  | { kind: "item"; product: ShelfExportProduct; location: ShelfExportLocation | null };

const productItemLines = (product: ShelfExportProduct): ShelfSheetLine[] =>
  product.locations.length === 0
    ? [{ kind: "item", product, location: null }]
    : sortShelfLocations(product.locations).map((location) => ({ kind: "item", product, location }));

/** Survey: category -> parts brand -> product name, a product's rows together. */
const surveyLines = (products: readonly ShelfExportProduct[]): ShelfSheetLine[] =>
  [...products]
    .sort(
      (a, b) =>
        thaiCompare(a.categoryName, b.categoryName) ||
        thaiCompare(a.brandName, b.brandName) ||
        thaiCompare(a.name, b.name) ||
        thaiCompare(a.code, b.code),
    )
    .flatMap(productItemLines);

const rackHeadingText = (rack: ShelfExportRack | undefined): string => {
  if (!rack) return "ชั้นวาง ?";
  const name = rack.name ? ` · ${rack.name}` : "";
  return `ชั้นวาง ${rack.code}${name}${rack.isActive ? "" : " (ปิดใช้งาน)"}`;
};

/** Recheck: rack (sortOrder, code) -> level -> product name, a new page per rack, unlocated last. */
const recheckLines = (
  products: readonly ShelfExportProduct[],
  racks: readonly ShelfExportRack[],
): ShelfSheetLine[] => {
  const rackOrder = new Map(racks.map((rack, index) => [rack.id, index]));
  const racksById = new Map(racks.map((rack) => [rack.id, rack]));
  const located = products
    .flatMap((product) => product.locations.map((location) => ({ product, location })))
    .sort(
      (a, b) =>
        (rackOrder.get(a.location.rackId) ?? racks.length) - (rackOrder.get(b.location.rackId) ?? racks.length) ||
        a.location.level - b.location.level ||
        thaiCompare(a.product.name, b.product.name) ||
        thaiCompare(a.product.code, b.product.code),
    );

  const lines: ShelfSheetLine[] = [];
  let currentRackId: string | null = null;
  for (const { product, location } of located) {
    if (location.rackId !== currentRackId) {
      currentRackId = location.rackId;
      lines.push({ kind: "heading", text: rackHeadingText(racksById.get(currentRackId)), pageBreakBefore: lines.length > 0 });
    }
    lines.push({ kind: "item", product, location });
  }

  const unlocated = products
    .filter((product) => product.locations.length === 0)
    .sort((a, b) => thaiCompare(a.name, b.name) || thaiCompare(a.code, b.code));
  if (unlocated.length > 0) {
    lines.push({ kind: "heading", text: SHELF_UNLOCATED_HEADING, pageBreakBefore: lines.length > 0 });
    lines.push(...unlocated.map((product): ShelfSheetLine => ({ kind: "item", product, location: null })));
  }
  return lines;
};

export const buildShelfExportLines = (
  mode: ShelfExportMode,
  products: readonly ShelfExportProduct[],
  racks: readonly ShelfExportRack[],
): ShelfSheetLine[] => (mode === "survey" ? surveyLines(products) : recheckLines(products, racks));

/** Data rows the sheet will have: one per location, one for a product without any. */
export const countShelfExportRows = (products: readonly ShelfExportProduct[]): number =>
  products.reduce((sum, product) => sum + Math.max(1, product.locations.length), 0);

// ─── Workbook ───────────────────────────────────────────────────────────────

export const SHELF_GUIDE_LINES: readonly string[] = [
  'ตำแหน่ง = ชั้นวาง + ชั้น เช่น A-2 คือชั้นวาง A ชั้นที่ 2 นับจากล่างขึ้นบน (รายชื่อชั้นวางอยู่ในแผ่น "ชั้นวาง")',
  "กรอกได้เฉพาะช่องสีเหลือง: ชั้นวาง, ชั้น, ประเภท, ✓ ถูกต้อง, ไม่พบ, หมายเหตุ ช่องอื่นล็อกไว้",
  'สินค้าอยู่ที่ตำแหน่งเดิมจริง: ใส่เครื่องหมายใดก็ได้ (เช่น ✓ หรือ x) ในช่อง "✓ ถูกต้อง"',
  "สินค้าย้ายไปอยู่ที่อื่น: กรอกชั้นวางและชั้นใหม่ในแถวเดิม ประเภทเดิมไม่เปลี่ยน",
  'ไม่พบสินค้าที่ตำแหน่งนี้แล้ว: ใส่เครื่องหมายในช่อง "ไม่พบ" ระบบจะเอาตำแหน่งนี้ออก ถ้าเป็นที่เก็บประจำ ที่เก็บเพิ่มที่เพิ่มล่าสุดจะเป็นที่เก็บประจำแทน',
  'ต้องการให้ตำแหน่งนี้เป็นที่เก็บประจำ: เลือก "ประจำ" ในช่องประเภท ที่เก็บประจำเดิมจะกลายเป็นที่เก็บเพิ่ม',
  "สินค้าที่ยังไม่มีตำแหน่ง: กรอกชั้นวางและชั้นที่พบ ตำแหน่งแรกของสินค้าจะเป็นที่เก็บประจำ",
  'พบสินค้าอีกที่หนึ่ง: ใช้แถวว่างท้ายแผ่น กรอกรหัสสินค้า ชั้นวาง และชั้น ถ้าเลือก "ประจำ" ที่ใหม่จะเป็นที่เก็บประจำและที่เดิมจะกลายเป็นที่เก็บเพิ่ม',
  `สินค้าหนึ่งรายการมีที่เก็บประจำได้ 1 แห่ง และที่เก็บเพิ่มได้ไม่เกิน ${MAX_SECONDARY_SHELF_LOCATIONS} แห่ง`,
  'หมายเหตุ: พิมพ์ข้อความเพื่อบันทึกหมายเหตุของตำแหน่ง พิมพ์ "-" เพื่อล้างหมายเหตุเดิม เว้นว่าง = ไม่เปลี่ยน',
  "แถวที่ไม่ได้กรอกอะไรเลย ระบบจะไม่เปลี่ยนแปลง",
  "ห้ามลบหรือย้ายคอลัมน์ และห้ามแก้คอลัมน์ที่ซ่อนไว้ ถ้าตำแหน่งในระบบเปลี่ยนไปหลังส่งออกไฟล์ แถวนั้นจะถูกข้ามและแจ้งให้ตรวจใหม่",
  "นำเข้าที่เมนู ผังชั้นวาง > นำเข้าตำแหน่ง ระบบจะแสดงผลตรวจไฟล์ให้ดูก่อนบันทึกทุกครั้ง",
];

export type ShelfWorkbookInput = {
  mode: ShelfExportMode;
  products: readonly ShelfExportProduct[];
  racks: readonly ShelfExportRack[];
  filterDescription: string;
  printedAt: Date;
};

const DATA_SHEET_PROTECTION: Partial<ExcelJS.WorksheetProtection> = {
  selectLockedCells: true,
  selectUnlockedCells: true,
  sort: true,
  autoFilter: true,
  formatRows: true,
  insertRows: true,
};

type InputValidations = Partial<Record<ColumnKey, ExcelJS.DataValidation>>;

const escapeHeaderFooter = (text: string): string => text.replace(/&/g, "&&");

const buildHeaderFooter = (title: string, filterDescription: string, printedAt: Date): Partial<ExcelJS.HeaderFooter> => {
  const filters = escapeHeaderFooter(truncateText(filterDescription, HEADER_FILTER_TEXT_MAX_LENGTH));
  const printed = escapeHeaderFooter(formatDateTimeThai(printedAt));
  return {
    oddHeader: `&L&B${escapeHeaderFooter(title)}&B&C${filters}&Rพิมพ์ ${printed}`,
    oddFooter: "&Lผู้ตรวจ ____________________  วันที่ ____________________&Rหน้า &P/&N",
  };
};

const styleTableHeaderRow = (row: ExcelJS.Row, inputColumns: ReadonlySet<number> = new Set()): void => {
  row.height = HEADER_ROW_HEIGHT_PT;
  row.eachCell((cell, columnNumber) => {
    const isInput = inputColumns.has(columnNumber);
    cell.font = { bold: true, size: 10, color: { argb: isInput ? BRAND_ARGB : WHITE_ARGB } };
    cell.fill = solidFill(isInput ? INPUT_HEADER_ARGB : BRAND_ARGB);
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
};

const createDataSheet = (workbook: ExcelJS.Workbook, input: ShelfWorkbookInput): ExcelJS.Worksheet => {
  const sheet = workbook.addWorksheet(SHELF_DATA_SHEET_NAME, {
    views: [{ state: "frozen", xSplit: 2, ySplit: 1 }],
    pageSetup: {
      paperSize: A4_PAPER_SIZE,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: "1:1",
      showGridLines: true,
      horizontalCentered: true,
      margins: PRINT_MARGINS,
    },
    headerFooter: buildHeaderFooter(SHELF_EXPORT_MODE_TITLES[input.mode], input.filterDescription, input.printedAt),
  });
  sheet.columns = SHELF_SHEET_COLUMNS.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width,
    hidden: column.hidden ?? false,
    style: column.text ? { numFmt: "@" } : {},
  }));
  const inputColumns = new Set(SHELF_SHEET_COLUMNS.flatMap((column, index) => (column.input ? [index + 1] : [])));
  styleTableHeaderRow(sheet.getRow(1), inputColumns);
  return sheet;
};

const buildInputValidations = (activeRacks: readonly ShelfExportRack[]): InputValidations => {
  const markList: ExcelJS.DataValidation = { type: "list", allowBlank: true, formulae: ['"✓"'], showErrorMessage: false };
  const validations: InputValidations = {
    type: {
      type: "list",
      allowBlank: true,
      formulae: [`"${PRIMARY_LABEL},${SECONDARY_LABEL}"`],
      showErrorMessage: true,
      errorTitle: "ประเภทไม่ถูกต้อง",
      error: `เลือก ${PRIMARY_LABEL} หรือ ${SECONDARY_LABEL}`,
    },
    confirm: markList,
    notFound: markList,
  };
  if (activeRacks.length === 0) return validations;
  const maxLevels = Math.max(...activeRacks.map((rack) => rack.levels));
  validations.rack = {
    type: "list",
    allowBlank: true,
    formulae: [`${SHELF_LIST_SHEET_NAME}!$A$1:$A$${activeRacks.length}`],
    showErrorMessage: true,
    errorTitle: "ไม่พบชั้นวาง",
    error: 'เลือกชั้นวางจากรายการ (ดูแผ่น "ชั้นวาง")',
  };
  validations.level = {
    type: "whole",
    operator: "between",
    allowBlank: true,
    formulae: [1, maxLevels],
    showErrorMessage: true,
    errorTitle: "ชั้นไม่ถูกต้อง",
    error: `ชั้นต้องเป็นเลข 1-${maxLevels}`,
  };
  return validations;
};

type SheetValidationModel = { add: (address: string, validation: ExcelJS.DataValidation) => void };

/**
 * The sheet-level validation list exceljs keeps (untyped). Per-cell `cell.dataValidation` is
 * avoided on purpose: exceljs merges those into overlapping ranges, which Excel then "repairs".
 */
const sheetValidationModel = (sheet: ExcelJS.Worksheet): SheetValidationModel | null => {
  if (!("dataValidations" in sheet)) return null;
  const model = sheet.dataValidations;
  if (typeof model !== "object" || model === null || !("add" in model)) return null;
  const add = model.add;
  if (typeof add !== "function") return null;
  return { add: (address, validation) => void add.call(model, address, validation) };
};

/** One range per input column over the data area; heading rows inside it stay locked. */
const applyInputValidations = (sheet: ExcelJS.Worksheet, validations: InputValidations, lastRow: number): void => {
  const model = sheetValidationModel(sheet);
  const firstRow = 2;
  if (!model || lastRow < firstRow) return;
  for (const column of SHELF_SHEET_COLUMNS) {
    const validation = validations[column.key];
    if (!validation) continue;
    const letter = sheet.getColumn(col(column.key)).letter;
    model.add(`${letter}${firstRow}:${letter}${lastRow}`, validation);
  }
};

/** Data row look: tall enough to handwrite, input cells yellow and unlocked. */
const styleItemRow = (row: ExcelJS.Row, codeEditable: boolean): void => {
  row.height = DATA_ROW_HEIGHT_PT;
  SHELF_SHEET_COLUMNS.forEach((column, index) => {
    const cell = row.getCell(index + 1);
    cell.alignment = { vertical: "middle", wrapText: column.wrap ?? false };
    const editable = column.input === true || (codeEditable && column.key === "code");
    if (!editable) return;
    cell.fill = solidFill(INPUT_FILL_ARGB);
    cell.protection = { locked: false };
  });
  row.getCell(col("name")).font = { size: 9 };
  row.getCell(col("fitment")).font = { size: 9 };
  row.getCell(col("currentLocation")).font = { bold: true };
};

const itemRowValues = (
  line: Extract<ShelfSheetLine, { kind: "item" }>,
  racksById: ReadonlyMap<string, ShelfExportRack>,
): Partial<Record<ColumnKey, string | number | null>> => {
  const { product, location } = line;
  const rackCode = location ? (racksById.get(location.rackId)?.code ?? "?") : "";
  return {
    code: product.code,
    name: product.name,
    category: product.categoryName,
    brand: product.brandName,
    fitment: product.fitmentText,
    stock: product.stock,
    currentLocation: location ? formatShelfLocationCode(rackCode, location.level) : null,
    currentType: location ? (location.isPrimary ? PRIMARY_LABEL : SECONDARY_LABEL) : null,
    productId: product.id,
    locationId: location?.id ?? null,
    snapshot: location ? formatShelfSnapshot(rackCode, location.level, location.isPrimary) : null,
  };
};

const addHeadingRow = (sheet: ExcelJS.Worksheet, text: string, pageBreakBefore: boolean): void => {
  if (pageBreakBefore) sheet.lastRow?.addPageBreak();
  const row = sheet.addRow({ name: text });
  row.height = HEADING_ROW_HEIGHT_PT;
  for (let column = 1; column <= VISIBLE_COLUMN_COUNT; column++) {
    row.getCell(column).fill = solidFill(HEADING_FILL_ARGB);
  }
  const cell = row.getCell(col("name"));
  cell.font = { bold: true, size: 11, color: { argb: BRAND_ARGB } };
  cell.alignment = { vertical: "middle" };
};

const writeSheetLines = (
  sheet: ExcelJS.Worksheet,
  lines: readonly ShelfSheetLine[],
  racks: readonly ShelfExportRack[],
): void => {
  const racksById = new Map(racks.map((rack) => [rack.id, rack]));
  for (const line of lines) {
    if (line.kind === "heading") {
      addHeadingRow(sheet, line.text, line.pageBreakBefore);
      continue;
    }
    styleItemRow(sheet.addRow(itemRowValues(line, racksById)), false);
  }
  addHeadingRow(sheet, SHELF_EXTRA_ROWS_HEADING, lines.length > 0);
  for (let index = 0; index < SHELF_EXPORT_EXTRA_ROWS; index++) {
    styleItemRow(sheet.addRow({}), true);
  }
};

const addGuideSheet = (workbook: ExcelJS.Workbook, mode: ShelfExportMode): void => {
  const sheet = workbook.addWorksheet(SHELF_GUIDE_SHEET_NAME, {
    pageSetup: { paperSize: A4_PAPER_SIZE, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  sheet.getColumn(1).width = 110;
  const title = sheet.addRow([`วิธีกรอก${SHELF_EXPORT_MODE_TITLES[mode]}`]);
  title.font = { bold: true, size: 14, color: { argb: BRAND_ARGB } };
  title.height = 28;
  SHELF_GUIDE_LINES.forEach((line, index) => {
    const row = sheet.addRow([`${index + 1}. ${line}`]);
    row.getCell(1).alignment = { wrapText: true, vertical: "top" };
  });
};

const addRackSheet = (workbook: ExcelJS.Workbook, racks: readonly ShelfExportRack[]): void => {
  const sheet = workbook.addWorksheet(SHELF_RACK_SHEET_NAME, {
    pageSetup: { paperSize: A4_PAPER_SIZE, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, showGridLines: true },
  });
  sheet.columns = [
    { header: "รหัสชั้นวาง", key: "code", width: 14 },
    { header: "ชื่อ", key: "name", width: 30 },
    { header: "จำนวนชั้น", key: "levels", width: 12 },
    { header: "สถานะ", key: "status", width: 14 },
  ];
  styleTableHeaderRow(sheet.getRow(1));
  for (const rack of racks) {
    sheet.addRow({ code: rack.code, name: rack.name ?? "", levels: rack.levels, status: rack.isActive ? "ใช้งาน" : "ปิดใช้งาน" });
  }
};

const addListSheet = async (workbook: ExcelJS.Workbook, activeRacks: readonly ShelfExportRack[]): Promise<void> => {
  const sheet = workbook.addWorksheet(SHELF_LIST_SHEET_NAME, { state: "hidden" });
  activeRacks.forEach((rack, index) => {
    sheet.getCell(index + 1, 1).value = rack.code;
  });
  await sheet.protect("", { selectLockedCells: true, selectUnlockedCells: true });
};

/** The printable, keyable survey / recheck workbook. */
export const buildShelfLocationWorkbook = async (input: ShelfWorkbookInput): Promise<ArrayBuffer> => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "autoparts";
  workbook.created = input.printedAt;
  const activeRacks = input.racks.filter((rack) => rack.isActive);

  const sheet = createDataSheet(workbook, input);
  const lines = buildShelfExportLines(input.mode, input.products, input.racks);
  writeSheetLines(sheet, lines, input.racks);
  applyInputValidations(sheet, buildInputValidations(activeRacks), sheet.rowCount);
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.rowCount, column: SHELF_SHEET_COLUMNS.length } };
  await sheet.protect("", DATA_SHEET_PROTECTION);

  addGuideSheet(workbook, input.mode);
  addRackSheet(workbook, input.racks);
  await addListSheet(workbook, activeRacks);
  return workbook.xlsx.writeBuffer();
};

// ─── Upload checks and parsing ──────────────────────────────────────────────

const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
/** Browsers without Office installed send a generic type (or none) for .xlsx. */
const ACCEPTED_UPLOAD_MIME_TYPES = new Set([
  XLSX_MIME_TYPE,
  "application/octet-stream",
  "application/zip",
  "application/x-zip-compressed",
  "",
]);
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04] as const;

export const SHELF_IMPORT_FILE_MESSAGES = {
  extension: "รองรับเฉพาะไฟล์ .xlsx ที่ส่งออกจากหน้าผังชั้นวาง",
  mime: "ชนิดไฟล์ไม่ถูกต้อง รองรับเฉพาะไฟล์ Excel (.xlsx)",
  empty: "ไฟล์ว่างเปล่า",
  tooLarge: "ไฟล์ใหญ่เกิน 2 MB",
  signature: "ไฟล์นี้ไม่ใช่ไฟล์ Excel (.xlsx) ที่ถูกต้อง",
  unreadable: "อ่านไฟล์ Excel ไม่ได้ ไฟล์อาจเสียหาย กรุณาบันทึกเป็น .xlsx แล้วลองใหม่",
  header:
    "ไฟล์นี้ไม่ใช่ใบสำรวจ/ใบตรวจตำแหน่งจากระบบ หรือคอลัมน์ถูกแก้ไข กรุณาดาวน์โหลดใบใหม่จากหน้าผังชั้นวาง",
  tooManyRows: `ไฟล์มีข้อมูลเกิน ${SHELF_IMPORT_MAX_ROWS.toLocaleString("en-US")} แถว กรุณาแบ่งไฟล์`,
} as const;

/** Name, type and size, before reading the bytes. */
export const checkShelfImportFileMeta = (file: { name: string; type: string; size: number }): string | null => {
  if (!file.name.toLowerCase().endsWith(".xlsx")) return SHELF_IMPORT_FILE_MESSAGES.extension;
  if (!ACCEPTED_UPLOAD_MIME_TYPES.has(file.type)) return SHELF_IMPORT_FILE_MESSAGES.mime;
  if (file.size <= 0) return SHELF_IMPORT_FILE_MESSAGES.empty;
  if (file.size > SHELF_IMPORT_MAX_FILE_BYTES) return SHELF_IMPORT_FILE_MESSAGES.tooLarge;
  return null;
};

/** An .xlsx is a zip: it must start with "PK\x03\x04". */
export const checkShelfImportFileSignature = (head: Uint8Array): string | null =>
  ZIP_SIGNATURE.every((byte, index) => head[index] === byte) ? null : SHELF_IMPORT_FILE_MESSAGES.signature;

export type ShelfImportRow = {
  rowNumber: number;
  productId: string;
  locationId: string;
  snapshot: string;
  productCode: string;
  productName: string;
  currentLocation: string;
  rack: string;
  level: string;
  type: string;
  confirm: string;
  notFound: string;
  note: string;
  /** Hidden columns were edited or are inconsistent. */
  malformed: boolean;
};

export type ShelfWorkbookParseResult = { ok: true; rows: ShelfImportRow[] } | { ok: false; error: string };

const ID_PATTERN = /^[a-z0-9]{1,50}$/;
const SNAPSHOT_PATTERN = /^[A-Z0-9]{1,4}-\d{1,2}\|[PS]$/;

const hiddenColumnsSchema = z
  .object({
    productId: z.union([z.literal(""), z.string().regex(ID_PATTERN)]),
    locationId: z.union([z.literal(""), z.string().regex(ID_PATTERN)]),
    snapshot: z.union([z.literal(""), z.string().regex(SNAPSHOT_PATTERN)]),
  })
  .refine((value) => (value.locationId ? Boolean(value.productId && value.snapshot) : !value.snapshot));

const cellText = (value: ExcelJS.CellValue): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "TRUE" : "";
  if (value instanceof Date) return value.toISOString();
  if ("richText" in value) return value.richText.map((part) => part.text).join("").trim();
  if ("hyperlink" in value) return String(value.text).trim();
  if ("formula" in value || "sharedFormula" in value) return value.result === undefined ? "" : cellText(value.result);
  return "";
};

const UNMARKED_VALUES = new Set(["", "0", "-", "false", "no", "n"]);
const isMarked = (text: string): boolean => !UNMARKED_VALUES.has(text.trim().toLowerCase());

/** True when a person wrote any instruction on the row. */
const hasInstruction = (row: ShelfImportRow): boolean =>
  Boolean(row.rack || row.level || row.type || row.note || isMarked(row.confirm) || isMarked(row.notFound));

const readImportRow = (row: ExcelJS.Row): ShelfImportRow | null => {
  const text = (key: ColumnKey): string =>
    cellText(row.getCell(col(key)).value).slice(0, SHELF_IMPORT_TEXT_MAX_LENGTH);
  const values = {
    productId: text("productId"),
    locationId: text("locationId"),
    snapshot: text("snapshot"),
    productCode: text("code"),
    productName: text("name"),
    currentLocation: text("currentLocation"),
    rack: text("rack"),
    level: text("level"),
    type: text("type"),
    confirm: text("confirm"),
    notFound: text("notFound"),
    note: text("note"),
  };
  const draft: ShelfImportRow = { rowNumber: row.number, ...values, malformed: false };
  if (!values.productId && !values.productCode && !hasInstruction(draft)) return null;
  const hidden = hiddenColumnsSchema.safeParse(values);
  return { ...draft, malformed: !hidden.success };
};

const hasExpectedHeader = (sheet: ExcelJS.Worksheet): boolean => {
  const header = sheet.getRow(1);
  return SHELF_SHEET_COLUMNS.every((column, index) => cellText(header.getCell(index + 1).value) === column.header);
};

/** exceljs read options: skip parts we never read, cap the sheet size against oversized files. */
const WORKBOOK_READ_OPTIONS = {
  ignoreNodes: ["dataValidations", "conditionalFormatting", "extLst", "hyperlinks", "drawing", "picture", "tableParts"],
  maxRows: SHELF_IMPORT_READ_MAX_SHEET_ROWS,
  maxCols: SHELF_IMPORT_READ_MAX_COLUMNS,
};

const loadWorkbook = async (data: ArrayBuffer): Promise<ExcelJS.Workbook | "tooManyRows" | null> => {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(data, WORKBOOK_READ_OPTIONS);
    return workbook;
  } catch (error) {
    return error instanceof Error && /count .* exceeded/i.test(error.message) ? "tooManyRows" : null;
  }
};

/** Reads the data sheet of a filled survey / recheck workbook. */
export const parseShelfLocationWorkbook = async (data: ArrayBuffer): Promise<ShelfWorkbookParseResult> => {
  const workbook = await loadWorkbook(data);
  if (workbook === "tooManyRows") return { ok: false, error: SHELF_IMPORT_FILE_MESSAGES.tooManyRows };
  if (!workbook) return { ok: false, error: SHELF_IMPORT_FILE_MESSAGES.unreadable };
  const sheet = workbook.getWorksheet(SHELF_DATA_SHEET_NAME) ?? workbook.worksheets.find(hasExpectedHeader);
  if (!sheet || !hasExpectedHeader(sheet)) return { ok: false, error: SHELF_IMPORT_FILE_MESSAGES.header };

  const rows: ShelfImportRow[] = [];
  let tooMany = false;
  sheet.eachRow((row, rowNumber) => {
    if (tooMany || rowNumber === 1) return;
    const parsed = readImportRow(row);
    if (!parsed) return;
    rows.push(parsed);
    tooMany = rows.length > SHELF_IMPORT_MAX_ROWS;
  });
  return tooMany ? { ok: false, error: SHELF_IMPORT_FILE_MESSAGES.tooManyRows } : { ok: true, rows };
};

// ─── Import planning ────────────────────────────────────────────────────────

export type ShelfImportProduct = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  /** Locations as stored now. */
  locations: readonly ShelfLocationDraft[];
};

export type ShelfImportContext = {
  racksById: ReadonlyMap<string, ShelfRackRule>;
  racksByCode: ReadonlyMap<string, ShelfRackRule>;
  productsById: ReadonlyMap<string, ShelfImportProduct>;
  productIdByCode: ReadonlyMap<string, string>;
  now: Date;
};

export type ShelfImportIssueKind = "error" | "conflict" | "warning";

export type ShelfImportIssue = {
  rowNumber: number;
  kind: ShelfImportIssueKind;
  productCode: string;
  productName: string;
  location: string;
  /** What was keyed on the row, so it can be fixed from the CSV. */
  entered: string;
  message: string;
};

export type ShelfImportProductPlan = {
  productId: string;
  productCode: string;
  productName: string;
  before: ShelfLocationDraft[];
  after: ShelfLocationDraft[];
  diff: ShelfLocationDiff;
  /** False when the product's locations were only confirmed. */
  changed: boolean;
  rowNumbers: number[];
};

export type ShelfImportCounts = {
  rows: number;
  changedProducts: number;
  confirmedProducts: number;
  changedRows: number;
  confirmedRows: number;
  unchangedRows: number;
  errorRows: number;
  conflictRows: number;
  warningRows: number;
};

export type ShelfImportPlan = {
  products: ShelfImportProductPlan[];
  issues: ShelfImportIssue[];
  counts: ShelfImportCounts;
};

const IMPORT_MESSAGES = {
  malformed: "ข้อมูลซ่อนในแถวนี้ถูกแก้ไข กรุณาใช้แถวจากไฟล์ที่ส่งออกจากระบบ",
  missingCode: "ไม่มีรหัสสินค้า",
  productNotFound: (code: string): string => `ไม่พบสินค้า ${code}`,
  codeMismatch: "รหัสสินค้าไม่ตรงกับข้อมูลซ่อนของแถว (แถวอาจถูกย้ายหรือเรียงใหม่)",
  productInactive: "สินค้านี้ถูกปิดใช้งานแล้ว (ยังบันทึกตำแหน่งให้)",
  halfLocation: "กรอกชั้นวางและชั้นให้ครบทั้งสองช่อง",
  levelNotNumber: "ชั้นต้องเป็นตัวเลขจำนวนเต็มตั้งแต่ 1",
  rackNotFound: (code: string): string => `ไม่พบชั้นวาง ${code}`,
  rackInactive: (code: string): string => `ชั้นวาง ${code} ถูกปิดใช้งานแล้ว`,
  levelOutOfRange: (code: string, levels: number): string => `ชั้นวาง ${code} มีแค่ชั้น 1-${levels}`,
  badType: `ประเภทต้องเป็น ${PRIMARY_LABEL} หรือ ${SECONDARY_LABEL}`,
  confirmAndNotFound: "ใส่เครื่องหมายทั้ง ✓ ถูกต้อง และ ไม่พบ ในแถวเดียวกัน",
  notFoundWithTarget: "ใส่เครื่องหมาย ไม่พบ พร้อมกรอกตำแหน่งใหม่ ถ้าย้ายที่ให้กรอกแค่ชั้นวางและชั้นใหม่",
  confirmWithNewTarget: "ใส่เครื่องหมาย ✓ ถูกต้อง แต่กรอกตำแหน่งใหม่ด้วย ให้เลือกอย่างใดอย่างหนึ่ง",
  unlocatedNeedsTarget: "แถวที่ยังไม่มีตำแหน่ง ต้องกรอกชั้นวางและชั้น",
  locationGone: "ตำแหน่งนี้ถูกเปลี่ยนหรือเอาออกไปแล้วหลังส่งออกไฟล์ กรุณาส่งออกใบใหม่แล้วตรวจอีกครั้ง",
  snapshotChanged: (was: string, now: string): string =>
    `ตำแหน่งในระบบเปลี่ยนไปแล้ว (ตอนส่งออก ${was} ตอนนี้ ${now}) กรุณาตรวจใหม่`,
  productNowLocated: (now: string): string => `สินค้านี้มีตำแหน่งในระบบแล้วหลังส่งออกไฟล์ (${now}) กรุณาตรวจใหม่`,
  duplicateConflict: (rows: string): string => `ระบุสินค้าและตำแหน่งเดียวกันซ้ำ (แถว ${rows}) แต่คำสั่งไม่ตรงกัน`,
  duplicateSame: (row: number): string => `ซ้ำกับแถว ${row} จึงข้ามแถวนี้`,
  locationChangedInFile: "ตำแหน่งนี้ถูกเปลี่ยนไปแล้วโดยแถวก่อนหน้าในไฟล์เดียวกัน",
  stillPrimary: `ที่เก็บประจำเปลี่ยนเป็นที่เก็บเพิ่มเองไม่ได้ ให้เลือก ${PRIMARY_LABEL} ที่ตำแหน่งอื่นแทน`,
  becamePrimary: "สินค้านี้ยังไม่มีที่เก็บประจำ ตำแหน่งนี้จึงเป็นที่เก็บประจำ",
} as const;

type RowTarget = ShelfLocationTarget & { code: string };
type RowType = "primary" | "secondary" | null;
/** undefined = keep the note, null = clear it. */
type RowNote = string | null | undefined;

type RowInputs = { target: RowTarget | null; type: RowType; confirm: boolean; notFound: boolean; note: RowNote };

type LocatedIntent = {
  located: true;
  row: ShelfImportRow;
  product: ShelfImportProduct;
  locationId: string;
  target: RowTarget | null;
  type: RowType;
  confirm: boolean;
  notFound: boolean;
  note: RowNote;
};

type UnlocatedIntent = {
  located: false;
  row: ShelfImportRow;
  product: ShelfImportProduct;
  target: RowTarget;
  type: RowType;
  note: RowNote;
};

type RowIntent = LocatedIntent | UnlocatedIntent;

type RowOutcome = "changed" | "confirmed" | "unchanged" | "error" | "conflict";

type RowReading =
  | { kind: "skip" }
  | { kind: "issue"; issue: ShelfImportIssue }
  | { kind: "intent"; intent: RowIntent; warnings: ShelfImportIssue[] };

type Checked<T> = { ok: true; value: T } | { ok: false; message: string };
const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });

const describeEntered = (row: ShelfImportRow): string =>
  [
    row.rack || row.level ? `ชั้นวาง ${row.rack || "-"} ชั้น ${row.level || "-"}` : "",
    row.type ? `ประเภท ${row.type}` : "",
    isMarked(row.confirm) ? "✓ ถูกต้อง" : "",
    isMarked(row.notFound) ? "ไม่พบ" : "",
    row.note ? `หมายเหตุ ${row.note}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

const buildIssue = (
  row: ShelfImportRow,
  kind: ShelfImportIssueKind,
  message: string,
  product?: ShelfImportProduct,
): ShelfImportIssue => ({
  rowNumber: row.rowNumber,
  kind,
  productCode: product?.code ?? row.productCode,
  productName: product?.name ?? row.productName,
  location: row.currentLocation,
  entered: describeEntered(row),
  message,
});

const resolveProduct = (row: ShelfImportRow, context: ShelfImportContext): Checked<ShelfImportProduct> => {
  const code = row.productCode.trim();
  if (row.productId) {
    const product = context.productsById.get(row.productId);
    if (!product) return fail(IMPORT_MESSAGES.productNotFound(code || row.productId));
    if (code && code !== product.code) return fail(IMPORT_MESSAGES.codeMismatch);
    return { ok: true, value: product };
  }
  if (!code) return fail(IMPORT_MESSAGES.missingCode);
  const productId = context.productIdByCode.get(code) ?? context.productIdByCode.get(code.toUpperCase());
  const product = productId ? context.productsById.get(productId) : undefined;
  return product ? { ok: true, value: product } : fail(IMPORT_MESSAGES.productNotFound(code));
};

const currentSnapshot = (location: ShelfLocationDraft, context: ShelfImportContext): string =>
  formatShelfSnapshot(context.racksById.get(location.rackId)?.code ?? "?", location.level, location.isPrimary);

/** The row was exported from a state that is no longer true. Rows a person added are never stale. */
const findConflict = (row: ShelfImportRow, product: ShelfImportProduct, context: ShelfImportContext): string | null => {
  if (!row.productId) return null;
  if (row.locationId) {
    const current = product.locations.find((location) => location.id === row.locationId);
    if (!current) return IMPORT_MESSAGES.locationGone;
    const now = currentSnapshot(current, context);
    return now === row.snapshot ? null : IMPORT_MESSAGES.snapshotChanged(describeSnapshot(row.snapshot), describeSnapshot(now));
  }
  if (product.locations.length === 0) return null;
  return IMPORT_MESSAGES.productNowLocated(describeShelfLocations(product.locations, context.racksById).join(", "));
};

const parseLevelInput = (text: string): number | null => {
  const value = Number(text);
  return Number.isInteger(value) && value >= 1 ? value : null;
};

/** ชั้นวาง + ชั้น, or "A-2" typed into ชั้นวาง alone. */
const readTarget = (row: ShelfImportRow, racksByCode: ReadonlyMap<string, ShelfRackRule>): Checked<RowTarget | null> => {
  const rackText = row.rack.trim();
  const levelText = row.level.trim();
  if (!rackText && !levelText) return { ok: true, value: null };
  if (!rackText) return fail(IMPORT_MESSAGES.halfLocation);
  const combined = levelText ? null : parseShelfLocationCode(rackText);
  if (!levelText && !combined) return fail(IMPORT_MESSAGES.halfLocation);
  const rackCode = combined?.rackCode ?? normalizeShelfRackCode(rackText);
  const level = combined?.level ?? parseLevelInput(levelText);
  if (level === null) return fail(IMPORT_MESSAGES.levelNotNumber);
  const rack = racksByCode.get(rackCode);
  if (!rack) return fail(IMPORT_MESSAGES.rackNotFound(rackCode));
  if (!rack.isActive) return fail(IMPORT_MESSAGES.rackInactive(rack.code));
  if (level > rack.levels) return fail(IMPORT_MESSAGES.levelOutOfRange(rack.code, rack.levels));
  return { ok: true, value: { rackId: rack.id, level, code: formatShelfLocationCode(rack.code, level) } };
};

const PRIMARY_INPUTS = new Set([PRIMARY_LABEL, "p", "primary", "หลัก"]);
const SECONDARY_INPUTS = new Set([SECONDARY_LABEL, "s", "secondary", "สำรอง"]);

const readType = (text: string): Checked<RowType> => {
  const value = text.trim().toLowerCase();
  if (!value) return { ok: true, value: null };
  if (PRIMARY_INPUTS.has(value)) return { ok: true, value: "primary" };
  if (SECONDARY_INPUTS.has(value)) return { ok: true, value: "secondary" };
  return fail(IMPORT_MESSAGES.badType);
};

const readNote = (text: string): Checked<RowNote> => {
  const value = text.trim();
  if (!value) return { ok: true, value: undefined };
  if (value === "-") return { ok: true, value: null };
  if (value.length > SHELF_LOCATION_NOTE_MAX_LENGTH) return fail(SHELF_RULE_ERROR_MESSAGES.NOTE_TOO_LONG);
  return { ok: true, value };
};

const readInputs = (row: ShelfImportRow, context: ShelfImportContext): Checked<RowInputs> => {
  const target = readTarget(row, context.racksByCode);
  if (!target.ok) return target;
  const type = readType(row.type);
  if (!type.ok) return type;
  const note = readNote(row.note);
  if (!note.ok) return note;
  return {
    ok: true,
    value: {
      target: target.value,
      type: type.value,
      confirm: isMarked(row.confirm),
      notFound: isMarked(row.notFound),
      note: note.value,
    },
  };
};

const buildIntent = (row: ShelfImportRow, product: ShelfImportProduct, inputs: RowInputs): Checked<RowIntent> => {
  if (inputs.confirm && inputs.notFound) return fail(IMPORT_MESSAGES.confirmAndNotFound);
  if (inputs.notFound && inputs.target) return fail(IMPORT_MESSAGES.notFoundWithTarget);
  if (!row.locationId) {
    if (!inputs.target) return fail(IMPORT_MESSAGES.unlocatedNeedsTarget);
    return { ok: true, value: { located: false, row, product, target: inputs.target, type: inputs.type, note: inputs.note } };
  }
  const current = product.locations.find((location) => location.id === row.locationId);
  const movesAway = inputs.target && (current?.rackId !== inputs.target.rackId || current?.level !== inputs.target.level);
  if (inputs.confirm && movesAway) return fail(IMPORT_MESSAGES.confirmWithNewTarget);
  return { ok: true, value: { located: true, row, product, locationId: row.locationId, ...inputs } };
};

const interpretRow = (row: ShelfImportRow, context: ShelfImportContext): RowReading => {
  if (!hasInstruction(row)) return { kind: "skip" };
  if (row.malformed) return { kind: "issue", issue: buildIssue(row, "error", IMPORT_MESSAGES.malformed) };
  const product = resolveProduct(row, context);
  if (!product.ok) return { kind: "issue", issue: buildIssue(row, "error", product.message) };
  const conflict = findConflict(row, product.value, context);
  if (conflict) return { kind: "issue", issue: buildIssue(row, "conflict", conflict, product.value) };
  const inputs = readInputs(row, context);
  if (!inputs.ok) return { kind: "issue", issue: buildIssue(row, "error", inputs.message, product.value) };
  const intent = buildIntent(row, product.value, inputs.value);
  if (!intent.ok) return { kind: "issue", issue: buildIssue(row, "error", intent.message, product.value) };
  const warnings = product.value.isActive ? [] : [buildIssue(row, "warning", IMPORT_MESSAGES.productInactive, product.value)];
  return { kind: "intent", intent: intent.value, warnings };
};

const intentKey = (intent: RowIntent): string =>
  `${intent.product.id}|${intent.located ? intent.locationId : `@${intent.target.rackId}:${intent.target.level}`}`;

const intentSignature = (intent: RowIntent): string =>
  JSON.stringify([
    intent.located ? intent.notFound : false,
    intent.located ? intent.confirm : false,
    intent.target?.code ?? "",
    intent.type ?? "",
    intent.note === undefined ? "~" : (intent.note ?? "-"),
  ]);

type DuplicateResolution = { kept: RowIntent[]; issues: ShelfImportIssue[]; outcomes: Map<number, RowOutcome> };

/** Same product + location twice: identical rows count once, contradicting rows are all skipped. */
const resolveDuplicates = (intents: readonly RowIntent[]): DuplicateResolution => {
  const groups = new Map<string, RowIntent[]>();
  for (const intent of intents) {
    const key = intentKey(intent);
    groups.set(key, [...(groups.get(key) ?? []), intent]);
  }
  const dropped = new Set<RowIntent>();
  const issues: ShelfImportIssue[] = [];
  const outcomes = new Map<number, RowOutcome>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const conflicting = new Set(group.map(intentSignature)).size > 1;
    const rowList = group.map((intent) => intent.row.rowNumber).join(", ");
    for (const [index, intent] of group.entries()) {
      if (!conflicting && index === 0) continue;
      dropped.add(intent);
      const message = conflicting ? IMPORT_MESSAGES.duplicateConflict(rowList) : IMPORT_MESSAGES.duplicateSame(group[0].row.rowNumber);
      issues.push(buildIssue(intent.row, conflicting ? "error" : "warning", message, intent.product));
      outcomes.set(intent.row.rowNumber, conflicting ? "error" : "unchanged");
    }
  }
  return { kept: intents.filter((intent) => !dropped.has(intent)), issues, outcomes };
};

type StepResult = { ok: true; locations: ShelfLocationDraft[] } | { ok: false; message: string };
type LocationRef = { id: string } | { target: ShelfLocationTarget };

const runChange = (
  locations: ShelfLocationDraft[],
  change: ShelfLocationChange,
  context: ShelfImportContext,
): StepResult => {
  const result = applyShelfLocationChange(locations, change, context.racksById, context.now);
  if (result.ok) return result;
  return fail(
    result.error === "LOCATION_NOT_FOUND" ? IMPORT_MESSAGES.locationChangedInFile : SHELF_RULE_ERROR_MESSAGES[result.error],
  );
};

const findByRef = (locations: readonly ShelfLocationDraft[], ref: LocationRef): ShelfLocationDraft | undefined =>
  "id" in ref
    ? locations.find((location) => location.id === ref.id)
    : locations.find((location) => location.rackId === ref.target.rackId && location.level === ref.target.level);

/** Promote by row id, or by place for a location planned earlier in the same file (no id yet). */
const promoteAt = (locations: ShelfLocationDraft[], ref: LocationRef, context: ShelfImportContext): StepResult => {
  const draft = findByRef(locations, ref);
  if (!draft) return fail(IMPORT_MESSAGES.locationChangedInFile);
  if (draft.id) return runChange(locations, { kind: "promote", locationId: draft.id }, context);
  return {
    ok: true,
    locations: locations.map((location) => {
      if (location === draft) return { ...location, isPrimary: true, touched: true };
      return location.isPrimary ? { ...location, isPrimary: false } : location;
    }),
  };
};

const setNoteAt = (
  locations: ShelfLocationDraft[],
  ref: LocationRef,
  note: string | null,
  context: ShelfImportContext,
): StepResult => {
  const draft = findByRef(locations, ref);
  if (!draft) return fail(IMPORT_MESSAGES.locationChangedInFile);
  if (draft.id) return runChange(locations, { kind: "setNote", locationId: draft.id, note }, context);
  return { ok: true, locations: locations.map((location) => (location === draft ? { ...location, note } : location)) };
};

const plainTarget = (target: RowTarget): ShelfLocationTarget => ({ rackId: target.rackId, level: target.level });

/** A row exported with a location: remove, move, promote, confirm and/or note it. */
const applyLocatedIntent = (
  locations: ShelfLocationDraft[],
  intent: LocatedIntent,
  context: ShelfImportContext,
): StepResult => {
  const { locationId } = intent;
  if (intent.notFound) return runChange(locations, { kind: "remove", locationId }, context);
  let result: StepResult = { ok: true, locations };
  let ref: LocationRef = { id: locationId };
  if (intent.target) {
    const target = plainTarget(intent.target);
    result = runChange(locations, { kind: "relocate", locationId, target }, context);
    ref = { target };
  } else if (intent.confirm) {
    result = runChange(locations, { kind: "confirm", locationId }, context);
  }
  if (result.ok && intent.type === "primary") result = promoteAt(result.locations, ref, context);
  if (result.ok && intent.note !== undefined) result = setNoteAt(result.locations, ref, intent.note, context);
  return result;
};

/** An unlocated product or a row a person added: place it, or make it the new home. */
const applyUnlocatedIntent = (
  locations: ShelfLocationDraft[],
  intent: UnlocatedIntent,
  context: ShelfImportContext,
): StepResult => {
  const target = plainTarget(intent.target);
  const hasPrimary = locations.some((location) => location.isPrimary);
  const change: ShelfLocationChange =
    intent.type === "primary" && hasPrimary
      ? { kind: "movePrimary", target, keepOldAsSecondary: true }
      : { kind: "place", target };
  const result = runChange(locations, change, context);
  if (!result.ok || intent.note === undefined) return result;
  return setNoteAt(result.locations, { target }, intent.note, context);
};

const locationStateKey = (locations: readonly ShelfLocationDraft[]): string =>
  locations
    .map((location) =>
      [location.id ?? "new", location.rackId, location.level, location.isPrimary ? "P" : "S", location.note ?? ""].join(":"),
    )
    .sort()
    .join("|");

const classifyRow = (before: ShelfLocationDraft[], after: ShelfLocationDraft[], intent: RowIntent): RowOutcome => {
  if (locationStateKey(before) !== locationStateKey(after)) return "changed";
  const confirms = intent.located ? intent.confirm || intent.target !== null || intent.type === "primary" : true;
  return confirms ? "confirmed" : "unchanged";
};

/** Asked for เพิ่ม but the location is (still or now) the home. */
const secondaryRequestWarnings = (
  intents: readonly RowIntent[],
  finalLocations: readonly ShelfLocationDraft[],
): ShelfImportIssue[] =>
  intents.flatMap((intent) => {
    if (intent.type !== "secondary" || (intent.located && intent.notFound)) return [];
    const ref: LocationRef = intent.target ? { target: intent.target } : { id: intent.located ? intent.locationId : "" };
    if (!findByRef(finalLocations, ref)?.isPrimary) return [];
    const message = intent.located ? IMPORT_MESSAGES.stillPrimary : IMPORT_MESSAGES.becamePrimary;
    return [buildIssue(intent.row, "warning", message, intent.product)];
  });

/**
 * Each existing location moves at most once (one row per location), always onto a spot that is
 * free at that point of the file, so running the moves in file order never collides on the
 * (product, rack, level) unique index.
 */
const orderMovesByFile = (diff: ShelfLocationDiff, moveOrder: readonly string[]): ShelfLocationDiff => {
  const position = (id: string): number => moveOrder.indexOf(id);
  return { ...diff, updates: [...diff.updates].sort((a, b) => position(a.id) - position(b.id)) };
};

type ProductOutcome = {
  plan: ShelfImportProductPlan | null;
  outcomes: Map<number, RowOutcome>;
  issues: ShelfImportIssue[];
};

const applyProductIntents = (
  product: ShelfImportProduct,
  intents: readonly RowIntent[],
  context: ShelfImportContext,
): ProductOutcome => {
  const before = [...product.locations];
  let current = before;
  const moveOrder: string[] = [];
  const applied: RowIntent[] = [];
  const outcomes = new Map<number, RowOutcome>();
  const issues: ShelfImportIssue[] = [];
  for (const intent of intents) {
    const result = intent.located ? applyLocatedIntent(current, intent, context) : applyUnlocatedIntent(current, intent, context);
    if (!result.ok) {
      issues.push(buildIssue(intent.row, "error", result.message, product));
      outcomes.set(intent.row.rowNumber, "error");
      continue;
    }
    outcomes.set(intent.row.rowNumber, classifyRow(current, result.locations, intent));
    if (intent.located && intent.target) moveOrder.push(intent.locationId);
    current = result.locations;
    applied.push(intent);
  }
  issues.push(...secondaryRequestWarnings(applied, current));
  const diff = orderMovesByFile(diffShelfLocations(before, current), moveOrder);
  if (isEmptyShelfLocationDiff(diff)) return { plan: null, outcomes, issues };
  return {
    plan: {
      productId: product.id,
      productCode: product.code,
      productName: product.name,
      before,
      after: current,
      diff,
      changed: !isVerifyOnlyShelfDiff(diff),
      rowNumbers: applied.map((intent) => intent.row.rowNumber),
    },
    outcomes,
    issues,
  };
};

const groupIntentsByProduct = (intents: readonly RowIntent[]): Map<string, RowIntent[]> => {
  const groups = new Map<string, RowIntent[]>();
  for (const intent of intents) groups.set(intent.product.id, [...(groups.get(intent.product.id) ?? []), intent]);
  return groups;
};

const countPlan = (
  rows: readonly ShelfImportRow[],
  outcomes: ReadonlyMap<number, RowOutcome>,
  products: readonly ShelfImportProductPlan[],
  issues: readonly ShelfImportIssue[],
): ShelfImportCounts => {
  const tally = (outcome: RowOutcome): number => rows.filter((row) => (outcomes.get(row.rowNumber) ?? "unchanged") === outcome).length;
  return {
    rows: rows.length,
    changedProducts: products.filter((product) => product.changed).length,
    confirmedProducts: products.filter((product) => !product.changed).length,
    changedRows: tally("changed"),
    confirmedRows: tally("confirmed"),
    unchangedRows: tally("unchanged"),
    errorRows: tally("error"),
    conflictRows: tally("conflict"),
    warningRows: new Set(issues.filter((issue) => issue.kind === "warning").map((issue) => issue.rowNumber)).size,
  };
};

/**
 * Turns the rows of a filled sheet into per-product location changes. Rows are replayed per
 * product in file order on the stored locations; a row that cannot be applied is skipped and
 * reported without affecting the others.
 */
export const planShelfLocationImport = (rows: readonly ShelfImportRow[], context: ShelfImportContext): ShelfImportPlan => {
  const outcomes = new Map<number, RowOutcome>();
  const issues: ShelfImportIssue[] = [];
  const intents: RowIntent[] = [];
  for (const row of rows) {
    const reading = interpretRow(row, context);
    if (reading.kind === "skip") continue;
    if (reading.kind === "issue") {
      issues.push(reading.issue);
      outcomes.set(row.rowNumber, reading.issue.kind === "conflict" ? "conflict" : "error");
      continue;
    }
    intents.push(reading.intent);
    issues.push(...reading.warnings);
  }

  const duplicates = resolveDuplicates(intents);
  issues.push(...duplicates.issues);
  for (const [rowNumber, outcome] of duplicates.outcomes) outcomes.set(rowNumber, outcome);

  const products: ShelfImportProductPlan[] = [];
  for (const productIntents of groupIntentsByProduct(duplicates.kept).values()) {
    const result = applyProductIntents(productIntents[0].product, productIntents, context);
    if (result.plan) products.push(result.plan);
    issues.push(...result.issues);
    for (const [rowNumber, outcome] of result.outcomes) outcomes.set(rowNumber, outcome);
  }

  issues.sort((a, b) => a.rowNumber - b.rowNumber);
  return { products, issues, counts: countPlan(rows, outcomes, products, issues) };
};

// ─── Loading helpers and preview ────────────────────────────────────────────

/** Products the import has to look up: only rows that carry an instruction. */
export const collectShelfImportLookups = (
  rows: readonly ShelfImportRow[],
): { productIds: string[]; productCodes: string[] } => {
  const productIds = new Set<string>();
  const productCodes = new Set<string>();
  for (const row of rows) {
    if (row.malformed || !hasInstruction(row)) continue;
    const code = row.productCode.trim();
    if (row.productId) productIds.add(row.productId);
    else if (code) {
      productCodes.add(code);
      productCodes.add(code.toUpperCase());
    }
  }
  return { productIds: [...productIds], productCodes: [...productCodes] };
};

export const buildShelfImportContext = (input: {
  racks: readonly ShelfRackRule[];
  products: readonly { id: string; code: string; name: string; isActive: boolean }[];
  drafts: ReadonlyMap<string, ShelfLocationDraft[]>;
  now: Date;
}): ShelfImportContext => ({
  racksById: new Map(input.racks.map((rack) => [rack.id, rack])),
  racksByCode: new Map(input.racks.map((rack) => [normalizeShelfRackCode(rack.code), rack])),
  productsById: new Map(
    input.products.map((product) => [product.id, { ...product, locations: input.drafts.get(product.id) ?? [] }]),
  ),
  productIdByCode: new Map(input.products.map((product) => [product.code, product.id])),
  now: input.now,
});

export type ShelfImportPreviewChange = {
  productId: string;
  productCode: string;
  productName: string;
  before: ShelfLocationBadgeItem[];
  after: ShelfLocationBadgeItem[];
  rowNumbers: number[];
};

export type ShelfImportPreview = {
  fileName: string;
  counts: ShelfImportCounts;
  changes: ShelfImportPreviewChange[];
  /** Changed products beyond SHELF_IMPORT_PREVIEW_MAX_CHANGES, left out of `changes`. */
  hiddenChangeCount: number;
  issues: ShelfImportIssue[];
};

const toBadgeItems = (
  locations: readonly ShelfLocationDraft[],
  racksById: ReadonlyMap<string, Pick<ShelfRackRule, "code">>,
): ShelfLocationBadgeItem[] =>
  sortShelfLocations(locations).map((location, index) => ({
    id: location.id ?? `new-${index}`,
    code: formatShelfLocationCode(racksById.get(location.rackId)?.code ?? "?", location.level),
    isPrimary: location.isPrimary,
    note: location.note,
  }));

/** Plain, serializable preview for the client. */
export const buildShelfImportPreview = (
  plan: ShelfImportPlan,
  racksById: ReadonlyMap<string, Pick<ShelfRackRule, "code">>,
  fileName: string,
): ShelfImportPreview => {
  const changed = plan.products.filter((product) => product.changed);
  return {
    fileName,
    counts: plan.counts,
    changes: changed.slice(0, SHELF_IMPORT_PREVIEW_MAX_CHANGES).map((product) => ({
      productId: product.productId,
      productCode: product.productCode,
      productName: product.productName,
      before: toBadgeItems(product.before, racksById),
      after: toBadgeItems(product.after, racksById),
      rowNumbers: product.rowNumbers,
    })),
    hiddenChangeCount: Math.max(0, changed.length - SHELF_IMPORT_PREVIEW_MAX_CHANGES),
    issues: plan.issues,
  };
};
