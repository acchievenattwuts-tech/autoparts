import assert from "node:assert/strict";
import test from "node:test";

import ExcelJS from "exceljs";

import {
  buildShelfExportLines,
  buildShelfImportContext,
  buildShelfImportPreview,
  buildShelfLocationWorkbook,
  checkShelfImportFileMeta,
  checkShelfImportFileSignature,
  collectShelfImportLookups,
  countShelfExportRows,
  formatShelfFitmentText,
  parseShelfLocationWorkbook,
  planShelfLocationImport,
  SHELF_DATA_SHEET_NAME,
  SHELF_EXPORT_EXTRA_ROWS,
  SHELF_IMPORT_FILE_MESSAGES,
  SHELF_IMPORT_MAX_FILE_BYTES,
  SHELF_SHEET_COLUMNS,
  SHELF_UNLOCATED_HEADING,
  type ShelfExportProduct,
  type ShelfExportRack,
  type ShelfImportContext,
  type ShelfImportPlan,
  type ShelfImportRow,
} from "@/lib/shelf-location-excel";
import {
  describeShelfLocations,
  SHELF_RULE_ERROR_MESSAGES,
  type ShelfLocationDraft,
} from "@/lib/shelf-location-rules";

const NOW = new Date("2026-10-19T03:00:00.000Z");

const racks: ShelfExportRack[] = [
  { id: "ra", code: "A", name: "หน้าร้าน", levels: 4, isActive: true },
  { id: "rb", code: "B", name: null, levels: 3, isActive: true },
  { id: "rz", code: "Z", name: "หลังร้าน", levels: 2, isActive: true },
  { id: "rx", code: "X", name: null, levels: 2, isActive: false },
];
const racksById = new Map(racks.map((rack) => [rack.id, rack]));

const minutesAgo = (minutes: number): Date => new Date(NOW.getTime() - minutes * 60_000);

const draft = (
  id: string,
  rackId: string,
  level: number,
  isPrimary: boolean,
  age = 60,
  note: string | null = null,
): ShelfLocationDraft => ({ id, rackId, level, isPrimary, note, createdAt: minutesAgo(age), touched: false });

type TestProduct = { id: string; code: string; name: string; isActive: boolean; locations: ShelfLocationDraft[] };

const baseProducts = (): TestProduct[] => [
  {
    id: "p1",
    code: "OIL-001",
    name: "กรองน้ำมันเครื่อง",
    isActive: true,
    locations: [draft("l1", "ra", 2, true, 300), draft("l2", "rz", 1, false, 100)],
  },
  { id: "p2", code: "BRK-002", name: "ผ้าเบรกหน้า", isActive: true, locations: [] },
  { id: "p3", code: "CL-003", name: "คอยล์เย็น", isActive: true, locations: [draft("l3", "rb", 1, true)] },
  { id: "p4", code: "OLD-004", name: "สินค้าเลิกขาย", isActive: false, locations: [] },
  {
    id: "p5",
    code: "FULL-005",
    name: "สินค้าเต็มชั้น",
    isActive: true,
    locations: [
      draft("l51", "ra", 1, true, 400),
      draft("l52", "ra", 3, false, 300),
      draft("l53", "rb", 2, false, 200),
      draft("l54", "rz", 2, false, 100),
    ],
  },
];

const contextFor = (products: TestProduct[] = baseProducts()): ShelfImportContext =>
  buildShelfImportContext({
    racks: racks.map(({ id, code, levels, isActive }) => ({ id, code, levels, isActive })),
    products: products.map(({ id, code, name, isActive }) => ({ id, code, name, isActive })),
    drafts: new Map(products.map((product) => [product.id, product.locations])),
    now: NOW,
  });

const blankRow = (rowNumber: number, overrides: Partial<ShelfImportRow> = {}): ShelfImportRow => ({
  rowNumber,
  productId: "",
  locationId: "",
  snapshot: "",
  productCode: "",
  productName: "",
  currentLocation: "",
  rack: "",
  level: "",
  type: "",
  confirm: "",
  notFound: "",
  note: "",
  malformed: false,
  ...overrides,
});

const SNAPSHOTS: Record<string, string> = {
  l1: "A-2|P",
  l2: "Z-1|S",
  l3: "B-1|P",
  l51: "A-1|P",
  l52: "A-3|S",
  l53: "B-2|S",
  l54: "Z-2|S",
};

/** A row as exported: hidden ids and snapshot filled, plus what the person keyed. */
const exportedRow = (
  rowNumber: number,
  productId: string,
  locationId: string | null,
  inputs: Partial<ShelfImportRow> = {},
): ShelfImportRow => {
  const product = baseProducts().find((item) => item.id === productId);
  return blankRow(rowNumber, {
    productId,
    productCode: product?.code ?? "",
    productName: product?.name ?? "",
    locationId: locationId ?? "",
    snapshot: locationId ? (SNAPSHOTS[locationId] ?? "") : "",
    currentLocation: locationId ? (SNAPSHOTS[locationId] ?? "").split("|")[0] : "",
    ...inputs,
  });
};

const plan = (rows: ShelfImportRow[], context: ShelfImportContext = contextFor()): ShelfImportPlan =>
  planShelfLocationImport(rows, context);

const afterOf = (result: ShelfImportPlan, productId: string): string[] => {
  const product = result.products.find((item) => item.productId === productId);
  assert.ok(product, `expected a plan for ${productId}`);
  return describeShelfLocations(product.after, racksById);
};

const issueMessages = (result: ShelfImportPlan, kind?: "error" | "conflict" | "warning"): string[] =>
  result.issues.filter((issue) => !kind || issue.kind === kind).map((issue) => `${issue.rowNumber}: ${issue.message}`);

// ─── Export layout ──────────────────────────────────────────────────────────

const exportProducts = (): ShelfExportProduct[] => [
  {
    id: "p3",
    code: "CL-003",
    name: "คอยล์เย็น",
    categoryName: "แอร์",
    brandName: "",
    fitmentText: "Toyota Vigo",
    stock: 2,
    locations: [{ id: "l3", rackId: "rb", level: 1, isPrimary: true, createdAt: minutesAgo(60) }],
  },
  {
    id: "p2",
    code: "BRK-002",
    name: "ผ้าเบรกหน้า",
    categoryName: "เบรก",
    brandName: "Bendix",
    fitmentText: "",
    stock: 3,
    locations: [],
  },
  {
    id: "p1",
    code: "OIL-001",
    name: "กรองน้ำมันเครื่อง",
    categoryName: "กรอง",
    brandName: "Denso",
    fitmentText: "Isuzu D-Max",
    stock: 5,
    locations: [
      { id: "l2", rackId: "rz", level: 1, isPrimary: false, createdAt: minutesAgo(100) },
      { id: "l1", rackId: "ra", level: 2, isPrimary: true, createdAt: minutesAgo(300) },
    ],
  },
];

const buildWorkbook = (mode: "survey" | "recheck"): Promise<ArrayBuffer> =>
  buildShelfLocationWorkbook({
    mode,
    products: exportProducts(),
    racks,
    filterDescription: "คงเหลือ > 0 & ทุกหมวด",
    printedAt: NOW,
  });

const loadDataSheet = async (buffer: ArrayBuffer): Promise<{ workbook: ExcelJS.Workbook; sheet: ExcelJS.Worksheet }> => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet(SHELF_DATA_SHEET_NAME);
  assert.ok(sheet);
  return { workbook, sheet };
};

const columnOf = (key: string): number => SHELF_SHEET_COLUMNS.findIndex((column) => column.key === key) + 1;

const findRowNumber = (sheet: ExcelJS.Worksheet, productId: string, locationId: string | null): number => {
  let found = 0;
  sheet.eachRow((row, rowNumber) => {
    const rowProduct = String(row.getCell(columnOf("productId")).value ?? "");
    const rowLocation = String(row.getCell(columnOf("locationId")).value ?? "");
    if (rowProduct === productId && rowLocation === (locationId ?? "")) found = rowNumber;
  });
  assert.ok(found > 0, `row for ${productId}/${locationId} not found`);
  return found;
};

const firstExtraRowNumber = (sheet: ExcelJS.Worksheet): number => sheet.rowCount - SHELF_EXPORT_EXTRA_ROWS + 1;

test("survey lines sort by category, parts brand and name, home first", () => {
  const lines = buildShelfExportLines("survey", exportProducts(), racks);
  assert.deepEqual(
    lines.map((line) => (line.kind === "item" ? `${line.product.code}:${line.location?.id ?? "-"}` : "heading")),
    ["OIL-001:l1", "OIL-001:l2", "BRK-002:-", "CL-003:l3"],
  );
  assert.equal(countShelfExportRows(exportProducts()), 4);
});

test("recheck lines group by rack in rack order with a page break per rack, unlocated last", () => {
  const lines = buildShelfExportLines("recheck", exportProducts(), racks);
  assert.deepEqual(
    lines.map((line) =>
      line.kind === "item" ? `${line.product.code}:${line.location?.id ?? "-"}` : `# ${line.text} ${line.pageBreakBefore}`,
    ),
    [
      "# ชั้นวาง A · หน้าร้าน false",
      "OIL-001:l1",
      "# ชั้นวาง B true",
      "CL-003:l3",
      "# ชั้นวาง Z · หลังร้าน true",
      "OIL-001:l2",
      `# ${SHELF_UNLOCATED_HEADING} true`,
      "BRK-002:-",
    ],
  );
});

test("the workbook is set up for printing, locking and keying", async () => {
  const { workbook, sheet } = await loadDataSheet(await buildWorkbook("recheck"));
  assert.deepEqual(
    workbook.worksheets.map((item) => item.name),
    [SHELF_DATA_SHEET_NAME, "วิธีกรอก", "ชั้นวาง", "lists"],
  );
  assert.equal(workbook.getWorksheet("lists")?.state, "hidden");
  assert.equal(sheet.pageSetup.orientation, "landscape");
  assert.equal(sheet.pageSetup.fitToWidth, 1);
  assert.equal(sheet.pageSetup.printTitlesRow, "1:1");
  assert.match(sheet.headerFooter.oddHeader ?? "", /ใบตรวจตำแหน่งสินค้าซ้ำ/);
  assert.match(sheet.headerFooter.oddHeader ?? "", /&&/);
  assert.match(sheet.headerFooter.oddFooter ?? "", /ผู้ตรวจ/);
  for (const key of ["productId", "locationId", "snapshot"]) assert.equal(sheet.getColumn(columnOf(key)).hidden, true);

  const rowNumber = findRowNumber(sheet, "p1", "l1");
  const row = sheet.getRow(rowNumber);
  assert.equal(row.getCell(columnOf("rack")).protection?.locked, false);
  assert.equal(row.getCell(columnOf("rack")).dataValidation?.type, "list");
  assert.equal(row.getCell(columnOf("level")).dataValidation?.type, "whole");
  assert.notEqual(row.getCell(columnOf("name")).protection?.locked, false);
  assert.equal(row.height, 26);
  const extra = sheet.getRow(firstExtraRowNumber(sheet));
  assert.equal(extra.getCell(columnOf("code")).protection?.locked, false);
  assert.deepEqual(
    workbook.getWorksheet("lists")?.getColumn(1).values.filter(Boolean),
    ["A", "B", "Z"],
  );
});

test("export -> parse round trip keeps the hidden columns and reads what was keyed", async () => {
  const exported = await buildWorkbook("survey");
  const { workbook, sheet } = await loadDataSheet(exported);
  sheet.getRow(findRowNumber(sheet, "p1", "l1")).getCell(columnOf("confirm")).value = "✓";
  sheet.getRow(findRowNumber(sheet, "p1", "l2")).getCell(columnOf("notFound")).value = "x";
  const unlocated = sheet.getRow(findRowNumber(sheet, "p2", null));
  unlocated.getCell(columnOf("rack")).value = "a";
  unlocated.getCell(columnOf("level")).value = 1;
  const extra = sheet.getRow(firstExtraRowNumber(sheet));
  extra.getCell(columnOf("code")).value = "CL-003";
  extra.getCell(columnOf("rack")).value = "Z";
  extra.getCell(columnOf("level")).value = 2;
  extra.getCell(columnOf("note")).value = "กล่องฟ้า";
  const filled = await workbook.xlsx.writeBuffer();

  const parsed = await parseShelfLocationWorkbook(filled);
  assert.ok(parsed.ok);
  assert.deepEqual(
    parsed.rows.map((row) => [row.productId, row.locationId, row.snapshot, row.productCode]),
    [
      ["p1", "l1", "A-2|P", "OIL-001"],
      ["p1", "l2", "Z-1|S", "OIL-001"],
      ["p2", "", "", "BRK-002"],
      ["p3", "l3", "B-1|P", "CL-003"],
      ["", "", "", "CL-003"],
    ],
  );
  assert.ok(parsed.rows.every((row) => !row.malformed));

  const result = plan(parsed.rows);
  assert.deepEqual(afterOf(result, "p1"), ["A-2 (ประจำ)"]);
  assert.deepEqual(afterOf(result, "p2"), ["A-1 (ประจำ)"]);
  assert.deepEqual(afterOf(result, "p3"), ["B-1 (ประจำ)", "Z-2 (เพิ่ม)"]);
  const p3 = result.products.find((product) => product.productId === "p3");
  assert.deepEqual(p3?.diff.creates, [{ rackId: "rz", level: 2, isPrimary: false, note: "กล่องฟ้า" }]);
  assert.equal(result.counts.changedProducts, 3);
  assert.equal(result.counts.unchangedRows, 1);
  assert.deepEqual(result.issues, []);
});

test("a sheet without the expected header row is rejected", async () => {
  const { workbook, sheet } = await loadDataSheet(await buildWorkbook("survey"));
  sheet.getRow(1).getCell(columnOf("snapshot")).value = "อื่น ๆ";
  const parsed = await parseShelfLocationWorkbook(await workbook.xlsx.writeBuffer());
  assert.deepEqual(parsed, { ok: false, error: SHELF_IMPORT_FILE_MESSAGES.header });

  const other = new ExcelJS.Workbook();
  other.addWorksheet("Sheet1").addRow(["รหัสสินค้า", "ชื่อสินค้า"]);
  assert.deepEqual(await parseShelfLocationWorkbook(await other.xlsx.writeBuffer()), {
    ok: false,
    error: SHELF_IMPORT_FILE_MESSAGES.header,
  });
});

test("a file that is not a workbook is unreadable", async () => {
  const bytes = new TextEncoder().encode("PK\u0003\u0004 not really a zip");
  const parsed = await parseShelfLocationWorkbook(bytes.buffer.slice(0, bytes.byteLength));
  assert.deepEqual(parsed, { ok: false, error: SHELF_IMPORT_FILE_MESSAGES.unreadable });
});

test("upload checks: extension, type, size and zip signature", () => {
  const xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  assert.equal(checkShelfImportFileMeta({ name: "ใบสำรวจ.XLSX", type: xlsx, size: 10 }), null);
  assert.equal(checkShelfImportFileMeta({ name: "a.xlsx", type: "", size: 10 }), null);
  assert.equal(checkShelfImportFileMeta({ name: "a.xls", type: xlsx, size: 10 }), SHELF_IMPORT_FILE_MESSAGES.extension);
  assert.equal(checkShelfImportFileMeta({ name: "a.xlsx", type: "text/csv", size: 10 }), SHELF_IMPORT_FILE_MESSAGES.mime);
  assert.equal(checkShelfImportFileMeta({ name: "a.xlsx", type: xlsx, size: 0 }), SHELF_IMPORT_FILE_MESSAGES.empty);
  assert.equal(
    checkShelfImportFileMeta({ name: "a.xlsx", type: xlsx, size: SHELF_IMPORT_MAX_FILE_BYTES + 1 }),
    SHELF_IMPORT_FILE_MESSAGES.tooLarge,
  );
  assert.equal(checkShelfImportFileSignature(new Uint8Array([0x50, 0x4b, 0x03, 0x04])), null);
  assert.equal(checkShelfImportFileSignature(new Uint8Array([0x25, 0x50, 0x44, 0x46])), SHELF_IMPORT_FILE_MESSAGES.signature);
});

test("fitment text groups models under their brand and is cut short", () => {
  assert.equal(
    formatShelfFitmentText([
      { brand: "Toyota", model: "Vigo" },
      { brand: "Toyota", model: "Revo" },
      { brand: "Toyota", model: "Vigo" },
      { brand: "Isuzu", model: "D-Max" },
    ]),
    "Toyota Vigo, Revo · Isuzu D-Max",
  );
  assert.equal(formatShelfFitmentText([{ brand: "Toyota", model: "Vigo Champ Smart Cab" }], 12), "Toyota Vigo…");
});

// ─── Rows with a location ───────────────────────────────────────────────────

test("✓ only confirms the location", () => {
  const result = plan([exportedRow(2, "p1", "l1", { confirm: "✓" })]);
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].changed, false);
  assert.deepEqual(result.products[0].diff, { deleteIds: [], creates: [], updates: [{ id: "l1", verify: true }] });
  assert.equal(result.counts.confirmedRows, 1);
  assert.equal(result.counts.confirmedProducts, 1);
  assert.equal(result.counts.changedProducts, 0);
});

test("ไม่พบ on the home removes it and promotes the newest secondary", () => {
  const result = plan([exportedRow(2, "p1", "l1", { notFound: "x" })]);
  assert.deepEqual(afterOf(result, "p1"), ["Z-1 (ประจำ)"]);
  assert.deepEqual(result.products[0].diff.deleteIds, ["l1"]);
  assert.equal(result.counts.changedRows, 1);
});

test("a new rack and level relocates the row and keeps its type", () => {
  const result = plan([exportedRow(3, "p1", "l2", { rack: "b", level: "2" })]);
  assert.deepEqual(afterOf(result, "p1"), ["A-2 (ประจำ)", "B-2 (เพิ่ม)"]);
  assert.deepEqual(result.products[0].diff.updates, [{ id: "l2", verify: true, rackId: "rb", level: 2 }]);
});

test("ประจำ on a secondary promotes it, after moving it when a new place is given", () => {
  const promoted = plan([exportedRow(3, "p1", "l2", { type: "ประจำ" })]);
  assert.deepEqual(afterOf(promoted, "p1"), ["Z-1 (ประจำ)", "A-2 (เพิ่ม)"]);

  const movedAndPromoted = plan([exportedRow(3, "p1", "l2", { rack: "B", level: "3", type: "ประจำ" })]);
  assert.deepEqual(afterOf(movedAndPromoted, "p1"), ["B-3 (ประจำ)", "A-2 (เพิ่ม)"]);
});

test("a note is set, '-' clears it, and the same place written again is a confirmation", () => {
  const noted = plan([exportedRow(2, "p1", "l1", { note: " กล่องฟ้า " })]);
  assert.deepEqual(noted.products[0].diff.updates, [{ id: "l1", verify: false, note: "กล่องฟ้า" }]);

  const products = baseProducts();
  products[0].locations[0] = draft("l1", "ra", 2, true, 300, "เดิม");
  const cleared = plan([exportedRow(2, "p1", "l1", { note: "-" })], contextFor(products));
  assert.deepEqual(cleared.products[0].diff.updates, [{ id: "l1", verify: false, note: null }]);

  const rewritten = plan([exportedRow(2, "p1", "l1", { rack: "A", level: "2" })]);
  assert.equal(rewritten.products[0].changed, false);
  assert.equal(rewritten.counts.confirmedRows, 1);
});

test("rows with nothing keyed change nothing", () => {
  const result = plan([exportedRow(2, "p1", "l1"), exportedRow(3, "p2", null), exportedRow(4, "p3", "l3", { confirm: "0" })]);
  assert.deepEqual(result.products, []);
  assert.equal(result.counts.unchangedRows, 3);
  assert.deepEqual(result.issues, []);
});

// ─── Rows without a location ────────────────────────────────────────────────

test("an unlocated product gets its first location as the home; A-2 typed in one cell works", () => {
  const result = plan([exportedRow(2, "p2", null, { rack: "a-3" })]);
  assert.deepEqual(afterOf(result, "p2"), ["A-3 (ประจำ)"]);
  assert.deepEqual(result.products[0].diff.creates, [{ rackId: "ra", level: 3, isPrimary: true, note: null }]);
});

test("a row added by product code adds a secondary, or moves the home with ประจำ", () => {
  const secondary = plan([blankRow(40, { productCode: "cl-003", rack: "A", level: "1" })]);
  assert.deepEqual(afterOf(secondary, "p3"), ["B-1 (ประจำ)", "A-1 (เพิ่ม)"]);

  const newHome = plan([blankRow(40, { productCode: "CL-003", rack: "A", level: "1", type: "ประจำ" })]);
  assert.deepEqual(afterOf(newHome, "p3"), ["A-1 (ประจำ)", "B-1 (เพิ่ม)"]);
});

test("rows of one product replay in file order, and moves are ordered so they never collide", () => {
  const result = plan([
    exportedRow(2, "p1", "l2", { rack: "B", level: "2" }),
    exportedRow(3, "p1", "l1", { rack: "Z", level: "1" }),
  ]);
  assert.deepEqual(afterOf(result, "p1"), ["Z-1 (ประจำ)", "B-2 (เพิ่ม)"]);
  assert.deepEqual(
    result.products[0].diff.updates.map((update) => update.id),
    ["l2", "l1"],
  );
});

// ─── Row errors ─────────────────────────────────────────────────────────────

test("row errors skip only that row", () => {
  const result = plan([
    blankRow(10, { productCode: "NOPE-1", rack: "A", level: "1" }),
    exportedRow(11, "p2", null, { rack: "Q", level: "1" }),
    exportedRow(12, "p2", null, { rack: "X", level: "1" }),
    exportedRow(13, "p2", null, { rack: "B", level: "4" }),
    exportedRow(14, "p2", null, { rack: "B", level: "สอง" }),
    exportedRow(15, "p2", null, { rack: "B" }),
    exportedRow(16, "p2", null, { level: "2" }),
    exportedRow(17, "p1", "l1", { confirm: "✓", notFound: "✓" }),
    exportedRow(18, "p1", "l1", { type: "หลักๆ" }),
    exportedRow(19, "p1", "l1", { note: "ก".repeat(101) }),
    exportedRow(20, "p1", "l2", { notFound: "x", rack: "B", level: "1" }),
    exportedRow(21, "p1", "l2", { confirm: "✓", rack: "B", level: "1" }),
    exportedRow(22, "p2", null, { confirm: "✓" }),
    exportedRow(23, "p3", "l3", { productCode: "OIL-001", confirm: "✓" }),
    blankRow(24, { productId: "p3", productCode: "CL-003", locationId: "l3", snapshot: "", confirm: "✓", malformed: true }),
    blankRow(25, { rack: "A", level: "1" }),
    exportedRow(26, "p3", "l3", { confirm: "✓" }),
  ]);
  assert.deepEqual(issueMessages(result), [
    "10: ไม่พบสินค้า NOPE-1",
    "11: ไม่พบชั้นวาง Q",
    "12: ชั้นวาง X ถูกปิดใช้งานแล้ว",
    "13: ชั้นวาง B มีแค่ชั้น 1-3",
    "14: ชั้นต้องเป็นตัวเลขจำนวนเต็มตั้งแต่ 1",
    "15: กรอกชั้นวางและชั้นให้ครบทั้งสองช่อง",
    "16: กรอกชั้นวางและชั้นให้ครบทั้งสองช่อง",
    "17: ใส่เครื่องหมายทั้ง ✓ ถูกต้อง และ ไม่พบ ในแถวเดียวกัน",
    "18: ประเภทต้องเป็น ประจำ หรือ เพิ่ม",
    `19: ${SHELF_RULE_ERROR_MESSAGES.NOTE_TOO_LONG}`,
    "20: ใส่เครื่องหมาย ไม่พบ พร้อมกรอกตำแหน่งใหม่ ถ้าย้ายที่ให้กรอกแค่ชั้นวางและชั้นใหม่",
    "21: ใส่เครื่องหมาย ✓ ถูกต้อง แต่กรอกตำแหน่งใหม่ด้วย ให้เลือกอย่างใดอย่างหนึ่ง",
    "22: แถวที่ยังไม่มีตำแหน่ง ต้องกรอกชั้นวางและชั้น",
    "23: รหัสสินค้าไม่ตรงกับข้อมูลซ่อนของแถว (แถวอาจถูกย้ายหรือเรียงใหม่)",
    "24: ข้อมูลซ่อนในแถวนี้ถูกแก้ไข กรุณาใช้แถวจากไฟล์ที่ส่งออกจากระบบ",
    "25: ไม่มีรหัสสินค้า",
  ]);
  assert.equal(result.counts.errorRows, 16);
  assert.equal(result.counts.confirmedRows, 1);
  assert.deepEqual(result.products.map((product) => product.productId), ["p3"]);
});

test("the secondary limit is reported per row", () => {
  const result = plan([blankRow(30, { productCode: "FULL-005", rack: "Z", level: "1" })]);
  assert.deepEqual(issueMessages(result), [`30: ${SHELF_RULE_ERROR_MESSAGES.SECONDARY_LIMIT}`]);
  assert.deepEqual(result.products, []);
});

test("an inactive product is still saved but flagged", () => {
  const result = plan([blankRow(31, { productCode: "OLD-004", rack: "A", level: "4" })]);
  assert.deepEqual(afterOf(result, "p4"), ["A-4 (ประจำ)"]);
  assert.deepEqual(issueMessages(result, "warning"), ["31: สินค้านี้ถูกปิดใช้งานแล้ว (ยังบันทึกตำแหน่งให้)"]);
  assert.equal(result.counts.warningRows, 1);
});

test("asking for เพิ่ม on the home is applied without demoting and flagged", () => {
  const result = plan([exportedRow(2, "p1", "l1", { type: "เพิ่ม", confirm: "✓" })]);
  assert.equal(result.products[0].changed, false);
  assert.equal(issueMessages(result, "warning").length, 1);
});

// ─── Conflicts ──────────────────────────────────────────────────────────────

test("rows exported from a state that changed since are skipped as conflicts", () => {
  const products = baseProducts();
  products[0].locations = [draft("l1", "ra", 2, false, 300), draft("l9", "rb", 3, true, 10)];
  products[1].locations = [draft("l7", "rz", 2, true)];
  const result = plan(
    [
      exportedRow(2, "p1", "l1", { confirm: "✓" }),
      exportedRow(3, "p1", "l2", { confirm: "✓" }),
      exportedRow(4, "p2", null, { rack: "A", level: "1" }),
      blankRow(5, { productCode: "BRK-002", rack: "B", level: "1" }),
    ],
    contextFor(products),
  );
  assert.deepEqual(issueMessages(result, "conflict"), [
    "2: ตำแหน่งในระบบเปลี่ยนไปแล้ว (ตอนส่งออก A-2 (ประจำ) ตอนนี้ A-2 (เพิ่ม)) กรุณาตรวจใหม่",
    "3: ตำแหน่งนี้ถูกเปลี่ยนหรือเอาออกไปแล้วหลังส่งออกไฟล์ กรุณาส่งออกใบใหม่แล้วตรวจอีกครั้ง",
    "4: สินค้านี้มีตำแหน่งในระบบแล้วหลังส่งออกไฟล์ (Z-2 (ประจำ)) กรุณาตรวจใหม่",
  ]);
  assert.equal(result.counts.conflictRows, 3);
  assert.deepEqual(afterOf(result, "p2"), ["Z-2 (ประจำ)", "B-1 (เพิ่ม)"]);
});

test("a conflict on a row with nothing keyed is not reported", () => {
  const products = baseProducts();
  products[0].locations = [];
  const result = plan([exportedRow(2, "p1", "l1")], contextFor(products));
  assert.deepEqual(result.issues, []);
  assert.equal(result.counts.unchangedRows, 1);
});

// ─── Duplicates ─────────────────────────────────────────────────────────────

test("the same product and location twice: contradicting rows are skipped, identical rows count once", () => {
  const contradicting = plan([
    exportedRow(2, "p1", "l1", { confirm: "✓" }),
    exportedRow(9, "p1", "l1", { notFound: "✓" }),
    blankRow(40, { productCode: "BRK-002", rack: "A", level: "1" }),
    blankRow(41, { productCode: "BRK-002", rack: "a", level: "1", type: "ประจำ" }),
  ]);
  assert.deepEqual(issueMessages(contradicting, "error"), [
    "2: ระบุสินค้าและตำแหน่งเดียวกันซ้ำ (แถว 2, 9) แต่คำสั่งไม่ตรงกัน",
    "9: ระบุสินค้าและตำแหน่งเดียวกันซ้ำ (แถว 2, 9) แต่คำสั่งไม่ตรงกัน",
    "40: ระบุสินค้าและตำแหน่งเดียวกันซ้ำ (แถว 40, 41) แต่คำสั่งไม่ตรงกัน",
    "41: ระบุสินค้าและตำแหน่งเดียวกันซ้ำ (แถว 40, 41) แต่คำสั่งไม่ตรงกัน",
  ]);
  assert.deepEqual(contradicting.products, []);

  const identical = plan([
    blankRow(40, { productCode: "BRK-002", rack: "A", level: "1" }),
    blankRow(41, { productCode: "BRK-002", rack: "A", level: "1" }),
  ]);
  assert.deepEqual(afterOf(identical, "p2"), ["A-1 (ประจำ)"]);
  assert.deepEqual(issueMessages(identical), ["41: ซ้ำกับแถว 40 จึงข้ามแถวนี้"]);
  assert.equal(identical.counts.changedRows, 1);
  assert.equal(identical.counts.unchangedRows, 1);
});

// ─── Lookups and preview ────────────────────────────────────────────────────

test("only rows with an instruction are looked up", () => {
  const lookups = collectShelfImportLookups([
    exportedRow(2, "p1", "l1"),
    exportedRow(3, "p2", null, { rack: "A", level: "1" }),
    blankRow(4, { productCode: "cl-003", rack: "B", level: "1" }),
    blankRow(5, { productCode: "IGNORED" }),
  ]);
  assert.deepEqual(lookups, { productIds: ["p2"], productCodes: ["cl-003", "CL-003"] });
});

test("the preview lists changed products with badge items and every issue", () => {
  const result = plan([
    exportedRow(2, "p1", "l2", { type: "ประจำ" }),
    exportedRow(3, "p3", "l3", { confirm: "✓" }),
    exportedRow(4, "p2", null, { rack: "Q", level: "1" }),
  ]);
  const preview = buildShelfImportPreview(result, racksById, "survey.xlsx");
  assert.equal(preview.fileName, "survey.xlsx");
  assert.equal(preview.changes.length, 1);
  assert.deepEqual(
    preview.changes[0].before.map((item) => [item.code, item.isPrimary]),
    [["A-2", true], ["Z-1", false]],
  );
  assert.deepEqual(
    preview.changes[0].after.map((item) => [item.code, item.isPrimary]),
    [["Z-1", true], ["A-2", false]],
  );
  assert.equal(preview.counts.changedProducts, 1);
  assert.equal(preview.counts.confirmedProducts, 1);
  assert.equal(preview.issues.length, 1);
  assert.equal(preview.hiddenChangeCount, 0);
});
