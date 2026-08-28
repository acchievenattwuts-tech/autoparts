export type ParsedPriceImportRow = {
  line: number;
  productCode: string;
  amount: number;
};

export type PriceImportParseResult = {
  rows: ParsedPriceImportRow[];
  errors: string[];
};

const MAX_ROWS = 10_000;

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

const normalizeHeader = (value: string) => value.trim().toLowerCase().replace(/[\s_-]/g, "");

export function parsePriceImportCsv(csv: string): PriceImportParseResult {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { rows: [], errors: ["ไฟล์ว่าง"] };
  if (lines.length - 1 > MAX_ROWS) return { rows: [], errors: [`รองรับสูงสุด ${MAX_ROWS.toLocaleString("th-TH")} รายการต่อครั้ง`] };

  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  const codeIndex = headers.findIndex((header) => ["productcode", "code", "รหัสสินค้า"].includes(header));
  const amountIndex = headers.findIndex((header) => ["price", "amount", "ราคา"].includes(header));
  if (codeIndex < 0 || amountIndex < 0) {
    return { rows: [], errors: ["หัวตารางต้องมี productCode และ price"] };
  }

  const rows: ParsedPriceImportRow[] = [];
  const errors: string[] = [];
  const seenCodes = new Map<string, number>();
  for (let index = 1; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const cells = parseCsvLine(lines[index]);
    const productCode = (cells[codeIndex] ?? "").trim();
    const amountText = (cells[amountIndex] ?? "").replace(/,/g, "").trim();
    const amount = Number(amountText);
    if (!productCode) {
      errors.push(`บรรทัด ${lineNumber}: ไม่มีรหัสสินค้า`);
      continue;
    }
    if (!amountText || !Number.isFinite(amount) || amount < 0 || amount > 9_999_999) {
      errors.push(`บรรทัด ${lineNumber}: ราคาไม่ถูกต้อง`);
      continue;
    }
    const normalizedCode = productCode.toLocaleUpperCase("en-US");
    const firstLine = seenCodes.get(normalizedCode);
    if (firstLine) {
      errors.push(`บรรทัด ${lineNumber}: รหัส ${productCode} ซ้ำกับบรรทัด ${firstLine}`);
      continue;
    }
    seenCodes.set(normalizedCode, lineNumber);
    rows.push({ line: lineNumber, productCode, amount: Math.round(amount * 100) / 100 });
  }
  return { rows, errors };
}
