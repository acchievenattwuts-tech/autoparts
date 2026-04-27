import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { formatDateThai } from "@/lib/th-date";
import type { ARAPStockFilters } from "@/lib/ar-ap-stock-report-queries";

const BOM = "﻿";

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

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export type ARRegisterStatus =
  | "PAID"
  | "PARTIAL"
  | "UNPAID"
  | "OVERDUE"
  | "CANCELLED";

export type ARRegisterRow = {
  kind: "SALE" | "CN";
  id: string;
  docNo: string;
  docDate: Date;
  dueDate: Date | null;
  customerId: string | null;
  customerName: string;
  paymentType: "CASH_SALE" | "CREDIT_SALE" | "CN_RETURN";
  netAmount: number;
  paidAmount: number;
  amountRemain: number;
  creditTerm: number | null;
  daysOverdue: number | null;
  status: ARRegisterStatus;
};

function deriveSaleStatus(opts: {
  cancelled: boolean;
  paymentType: "CASH_SALE" | "CREDIT_SALE";
  netAmount: number;
  amountRemain: number;
  dueDate: Date | null;
  today: Date;
}): { status: ARRegisterStatus; daysOverdue: number | null } {
  if (opts.cancelled) return { status: "CANCELLED", daysOverdue: null };
  if (opts.paymentType === "CASH_SALE") return { status: "PAID", daysOverdue: null };
  if (opts.amountRemain <= 0) return { status: "PAID", daysOverdue: null };

  const today = startOfDay(opts.today).getTime();
  const due = opts.dueDate ? startOfDay(opts.dueDate).getTime() : null;
  const daysOverdue =
    due != null ? Math.floor((today - due) / 86_400_000) : null;

  if (daysOverdue != null && daysOverdue > 0) {
    return { status: "OVERDUE", daysOverdue };
  }
  if (opts.amountRemain < opts.netAmount) {
    return { status: "PARTIAL", daysOverdue };
  }
  return { status: "UNPAID", daysOverdue };
}

export async function queryARRegisterRows(
  filters: ARAPStockFilters,
): Promise<ARRegisterRow[]> {
  const customerWhere = filters.customerId
    ? { customerId: filters.customerId }
    : {};

  const [sales, cns] = await Promise.all([
    db.sale.findMany({
      where: {
        ...customerWhere,
        paymentType: "CREDIT_SALE",
        saleDate: { gte: filters.from, lte: filters.to },
      },
      orderBy: [{ customerId: "asc" }, { saleDate: "asc" }],
      take: 2000,
      select: {
        id: true,
        saleNo: true,
        saleDate: true,
        status: true,
        paymentType: true,
        customerId: true,
        customerName: true,
        customer: { select: { name: true } },
        netAmount: true,
        amountRemain: true,
        creditTerm: true,
      },
    }),
    db.creditNote.findMany({
      where: {
        ...customerWhere,
        settlementType: "CREDIT_DEBT",
        cnDate: { gte: filters.from, lte: filters.to },
      },
      orderBy: [{ customerId: "asc" }, { cnDate: "asc" }],
      take: 2000,
      select: {
        id: true,
        cnNo: true,
        cnDate: true,
        status: true,
        customerId: true,
        customerName: true,
        customer: { select: { name: true } },
        totalAmount: true,
        amountRemain: true,
      },
    }),
  ]);

  const today = new Date();
  const rows: ARRegisterRow[] = [];

  for (const s of sales) {
    const netAmount = Number(s.netAmount);
    const amountRemain = Number(s.amountRemain);
    const paidAmount = Math.max(0, netAmount - amountRemain);
    const dueDate =
      s.paymentType === "CREDIT_SALE"
        ? addDays(s.saleDate, s.creditTerm ?? 0)
        : null;
    const { status, daysOverdue } = deriveSaleStatus({
      cancelled: s.status === "CANCELLED",
      paymentType: s.paymentType,
      netAmount,
      amountRemain,
      dueDate,
      today,
    });
    rows.push({
      kind: "SALE",
      id: s.id,
      docNo: s.saleNo,
      docDate: s.saleDate,
      dueDate,
      customerId: s.customerId,
      customerName: s.customer?.name ?? s.customerName ?? "-",
      paymentType: s.paymentType,
      netAmount,
      paidAmount,
      amountRemain: s.status === "CANCELLED" ? 0 : amountRemain,
      creditTerm: s.creditTerm,
      daysOverdue,
      status,
    });
  }

  for (const c of cns) {
    const totalAmount = Number(c.totalAmount);
    const amountRemain = Number(c.amountRemain);
    const paidAmount = Math.max(0, totalAmount - amountRemain);
    rows.push({
      kind: "CN",
      id: c.id,
      docNo: c.cnNo,
      docDate: c.cnDate,
      dueDate: null,
      customerId: c.customerId,
      customerName: c.customer?.name ?? c.customerName ?? "-",
      paymentType: "CN_RETURN",
      netAmount: -totalAmount,
      paidAmount: -paidAmount,
      amountRemain: c.status === "CANCELLED" ? 0 : -amountRemain,
      creditTerm: null,
      daysOverdue: null,
      status: c.status === "CANCELLED" ? "CANCELLED" : amountRemain <= 0 ? "PAID" : "UNPAID",
    });
  }

  rows.sort((a, b) => {
    const cmp = (a.customerName || "").localeCompare(b.customerName || "");
    if (cmp !== 0) return cmp;
    return a.docDate.getTime() - b.docDate.getTime();
  });

  return rows;
}

const ARP_TYPE_LABEL: Record<ARRegisterRow["paymentType"], string> = {
  CASH_SALE: "ขายสด",
  CREDIT_SALE: "ขายเชื่อ",
  CN_RETURN: "CN คืนสินค้า",
};

const STATUS_LABEL: Record<ARRegisterStatus, string> = {
  PAID: "ชำระแล้ว",
  PARTIAL: "ชำระบางส่วน",
  UNPAID: "ยังไม่ชำระ",
  OVERDUE: "เกินกำหนด",
  CANCELLED: "ยกเลิก",
};

export function buildARRegisterCsv(rows: ARRegisterRow[]): string {
  const header = csvRow([
    "เลขที่",
    "วันที่",
    "ลูกค้า",
    "ประเภท",
    "ยอดรวม",
    "รับชำระแล้ว",
    "ค้างชำระ",
    "ครบกำหนด",
    "เกินกำหนด (วัน)",
    "สถานะ",
  ]);
  const body = rows.map((r) =>
    csvRow([
      r.docNo,
      formatDateThai(r.docDate),
      r.customerName,
      ARP_TYPE_LABEL[r.paymentType],
      r.netAmount,
      r.paidAmount,
      r.amountRemain,
      r.dueDate ? formatDateThai(r.dueDate) : "",
      r.daysOverdue != null && r.daysOverdue > 0 ? r.daysOverdue : "",
      STATUS_LABEL[r.status],
    ]),
  );
  return BOM + [header, ...body].join("\r\n");
}

export async function buildARRegisterExcel(
  rows: ARRegisterRow[],
  title: string,
): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(title);

  ws.columns = [
    { header: "เลขที่", key: "docNo", width: 16 },
    { header: "วันที่", key: "docDate", width: 12 },
    { header: "ลูกค้า", key: "customerName", width: 28 },
    { header: "ประเภท", key: "type", width: 12 },
    { header: "ยอดรวม", key: "netAmount", width: 14 },
    { header: "รับชำระแล้ว", key: "paidAmount", width: 14 },
    { header: "ค้างชำระ", key: "amountRemain", width: 14 },
    { header: "ครบกำหนด", key: "dueDate", width: 12 },
    { header: "เกิน (วัน)", key: "daysOverdue", width: 10 },
    { header: "สถานะ", key: "status", width: 14 },
  ];
  styleHeader(ws);

  for (const r of rows) {
    const row = ws.addRow({
      docNo: r.docNo,
      docDate: formatDateThai(r.docDate),
      customerName: r.customerName,
      type: ARP_TYPE_LABEL[r.paymentType],
      netAmount: r.netAmount,
      paidAmount: r.paidAmount,
      amountRemain: r.amountRemain,
      dueDate: r.dueDate ? formatDateThai(r.dueDate) : "",
      daysOverdue: r.daysOverdue != null && r.daysOverdue > 0 ? r.daysOverdue : "",
      status: STATUS_LABEL[r.status],
    });
    row.getCell("netAmount").numFmt = "#,##0.00";
    row.getCell("paidAmount").numFmt = "#,##0.00";
    row.getCell("amountRemain").numFmt = "#,##0.00";
    if (r.status === "CANCELLED") {
      row.font = { italic: true, color: { argb: "FF9CA3AF" } };
    } else if (r.status === "OVERDUE") {
      row.getCell("amountRemain").font = { color: { argb: "FFE02020" }, bold: true };
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf]);
}

// ─── AP Register ─────────────────────────────────────────────────────────────

export type APRegisterRow = {
  kind: "PURCHASE" | "ADVANCE" | "RETURN";
  id: string;
  docNo: string;
  docDate: Date;
  dueDate: Date | null;
  supplierId: string | null;
  supplierName: string;
  rowType: "CREDIT_PURCHASE" | "ADVANCE" | "PR_CREDIT";
  netAmount: number;
  paidAmount: number;
  amountRemain: number;
  creditTerm: number | null;
  daysOverdue: number | null;
  status: ARRegisterStatus;
};

const AP_TYPE_LABEL: Record<APRegisterRow["rowType"], string> = {
  CREDIT_PURCHASE: "ซื้อเชื่อ",
  ADVANCE: "เงินมัดจำ",
  PR_CREDIT: "คืนซื้อ (เครดิต)",
};

export async function queryAPRegisterRows(
  filters: ARAPStockFilters,
): Promise<APRegisterRow[]> {
  const supplierWhere = filters.supplierId
    ? { supplierId: filters.supplierId }
    : {};

  const [purchases, advances, prCredits] = await Promise.all([
    db.purchase.findMany({
      where: {
        ...supplierWhere,
        purchaseType: "CREDIT_PURCHASE",
        purchaseDate: { gte: filters.from, lte: filters.to },
      },
      orderBy: [{ supplierId: "asc" }, { purchaseDate: "asc" }],
      take: 2000,
      select: {
        id: true,
        purchaseNo: true,
        purchaseDate: true,
        status: true,
        supplierId: true,
        supplier: { select: { name: true, creditTerm: true } },
        netAmount: true,
        amountRemain: true,
        creditTerm: true,
      },
    }),
    db.supplierAdvance.findMany({
      where: {
        ...supplierWhere,
        advanceDate: { gte: filters.from, lte: filters.to },
      },
      orderBy: [{ supplierId: "asc" }, { advanceDate: "asc" }],
      take: 2000,
      select: {
        id: true,
        advanceNo: true,
        advanceDate: true,
        status: true,
        supplierId: true,
        supplier: { select: { name: true } },
        totalAmount: true,
        amountRemain: true,
      },
    }),
    db.purchaseReturn.findMany({
      where: {
        ...supplierWhere,
        settlementType: "SUPPLIER_CREDIT",
        returnDate: { gte: filters.from, lte: filters.to },
      },
      orderBy: [{ supplierId: "asc" }, { returnDate: "asc" }],
      take: 2000,
      select: {
        id: true,
        returnNo: true,
        returnDate: true,
        status: true,
        supplierId: true,
        supplier: { select: { name: true } },
        totalAmount: true,
        amountRemain: true,
      },
    }),
  ]);

  const today = new Date();
  const rows: APRegisterRow[] = [];

  for (const p of purchases) {
    const netAmount = Number(p.netAmount);
    const amountRemain = Number(p.amountRemain);
    const paidAmount = Math.max(0, netAmount - amountRemain);
    const term = p.creditTerm ?? 0;
    const dueDate = addDays(p.purchaseDate, term);
    const cancelled = p.status === "CANCELLED";
    const { status, daysOverdue } = deriveSaleStatus({
      cancelled,
      paymentType: "CREDIT_SALE",
      netAmount,
      amountRemain,
      dueDate,
      today,
    });
    rows.push({
      kind: "PURCHASE",
      id: p.id,
      docNo: p.purchaseNo,
      docDate: p.purchaseDate,
      dueDate,
      supplierId: p.supplierId,
      supplierName: p.supplier?.name ?? "-",
      rowType: "CREDIT_PURCHASE",
      netAmount,
      paidAmount,
      amountRemain: cancelled ? 0 : amountRemain,
      creditTerm: p.creditTerm,
      daysOverdue,
      status,
    });
  }

  for (const a of advances) {
    const netAmount = Number(a.totalAmount);
    const amountRemain = Number(a.amountRemain);
    const paidAmount = Math.max(0, netAmount - amountRemain);
    const cancelled = a.status === "CANCELLED";
    rows.push({
      kind: "ADVANCE",
      id: a.id,
      docNo: a.advanceNo,
      docDate: a.advanceDate,
      dueDate: null,
      supplierId: a.supplierId,
      supplierName: a.supplier?.name ?? "-",
      rowType: "ADVANCE",
      netAmount,
      paidAmount,
      amountRemain: cancelled ? 0 : amountRemain,
      creditTerm: null,
      daysOverdue: null,
      status: cancelled
        ? "CANCELLED"
        : amountRemain <= 0
          ? "PAID"
          : amountRemain < netAmount
            ? "PARTIAL"
            : "UNPAID",
    });
  }

  for (const r of prCredits) {
    const netAmount = Number(r.totalAmount);
    const amountRemain = Number(r.amountRemain);
    const paidAmount = Math.max(0, netAmount - amountRemain);
    const cancelled = r.status === "CANCELLED";
    rows.push({
      kind: "RETURN",
      id: r.id,
      docNo: r.returnNo,
      docDate: r.returnDate,
      dueDate: null,
      supplierId: r.supplierId,
      supplierName: r.supplier?.name ?? "-",
      rowType: "PR_CREDIT",
      netAmount: -netAmount,
      paidAmount: -paidAmount,
      amountRemain: cancelled ? 0 : -amountRemain,
      creditTerm: null,
      daysOverdue: null,
      status: cancelled
        ? "CANCELLED"
        : amountRemain <= 0
          ? "PAID"
          : amountRemain < netAmount
            ? "PARTIAL"
            : "UNPAID",
    });
  }

  rows.sort((a, b) => {
    const cmp = (a.supplierName || "").localeCompare(b.supplierName || "");
    if (cmp !== 0) return cmp;
    return a.docDate.getTime() - b.docDate.getTime();
  });

  return rows;
}

export function buildAPRegisterCsv(rows: APRegisterRow[]): string {
  const header = csvRow([
    "เลขที่",
    "วันที่",
    "ผู้จำหน่าย",
    "ประเภท",
    "ยอดรวม",
    "จ่ายแล้ว",
    "คงเหลือ",
    "ครบกำหนด",
    "เกินกำหนด (วัน)",
    "สถานะ",
  ]);
  const body = rows.map((r) =>
    csvRow([
      r.docNo,
      formatDateThai(r.docDate),
      r.supplierName,
      AP_TYPE_LABEL[r.rowType],
      r.netAmount,
      r.paidAmount,
      r.amountRemain,
      r.dueDate ? formatDateThai(r.dueDate) : "",
      r.daysOverdue != null && r.daysOverdue > 0 ? r.daysOverdue : "",
      STATUS_LABEL[r.status],
    ]),
  );
  return BOM + [header, ...body].join("\r\n");
}

export async function buildAPRegisterExcel(
  rows: APRegisterRow[],
  title: string,
): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(title);

  ws.columns = [
    { header: "เลขที่", key: "docNo", width: 16 },
    { header: "วันที่", key: "docDate", width: 12 },
    { header: "ผู้จำหน่าย", key: "supplierName", width: 28 },
    { header: "ประเภท", key: "type", width: 16 },
    { header: "ยอดรวม", key: "netAmount", width: 14 },
    { header: "จ่ายแล้ว", key: "paidAmount", width: 14 },
    { header: "คงเหลือ", key: "amountRemain", width: 14 },
    { header: "ครบกำหนด", key: "dueDate", width: 12 },
    { header: "เกิน (วัน)", key: "daysOverdue", width: 10 },
    { header: "สถานะ", key: "status", width: 14 },
  ];
  styleHeader(ws);

  for (const r of rows) {
    const row = ws.addRow({
      docNo: r.docNo,
      docDate: formatDateThai(r.docDate),
      supplierName: r.supplierName,
      type: AP_TYPE_LABEL[r.rowType],
      netAmount: r.netAmount,
      paidAmount: r.paidAmount,
      amountRemain: r.amountRemain,
      dueDate: r.dueDate ? formatDateThai(r.dueDate) : "",
      daysOverdue: r.daysOverdue != null && r.daysOverdue > 0 ? r.daysOverdue : "",
      status: STATUS_LABEL[r.status],
    });
    row.getCell("netAmount").numFmt = "#,##0.00";
    row.getCell("paidAmount").numFmt = "#,##0.00";
    row.getCell("amountRemain").numFmt = "#,##0.00";
    if (r.status === "CANCELLED") {
      row.font = { italic: true, color: { argb: "FF9CA3AF" } };
    } else if (r.status === "OVERDUE") {
      row.getCell("amountRemain").font = { color: { argb: "FFE02020" }, bold: true };
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf]);
}

export type ARRegisterSummary = {
  count: number;
  totalNet: number;
  totalPaid: number;
  totalRemain: number;
  totalOverdue: number;
};

export function summarizeARRegister(rows: ARRegisterRow[]): ARRegisterSummary {
  let totalNet = 0;
  let totalPaid = 0;
  let totalRemain = 0;
  let totalOverdue = 0;
  for (const r of rows) {
    if (r.status === "CANCELLED") continue;
    totalNet += r.netAmount;
    totalPaid += r.paidAmount;
    totalRemain += r.amountRemain;
    if (r.status === "OVERDUE") totalOverdue += r.amountRemain;
  }
  return {
    count: rows.filter((r) => r.status !== "CANCELLED").length,
    totalNet,
    totalPaid,
    totalRemain,
    totalOverdue,
  };
}

export function summarizeAPRegister(rows: APRegisterRow[]): ARRegisterSummary {
  let totalNet = 0;
  let totalPaid = 0;
  let totalRemain = 0;
  let totalOverdue = 0;
  for (const r of rows) {
    if (r.status === "CANCELLED") continue;
    totalNet += r.netAmount;
    totalPaid += r.paidAmount;
    totalRemain += r.amountRemain;
    if (r.status === "OVERDUE") totalOverdue += r.amountRemain;
  }
  return {
    count: rows.filter((r) => r.status !== "CANCELLED").length,
    totalNet,
    totalPaid,
    totalRemain,
    totalOverdue,
  };
}

export const STATUS_LABELS = STATUS_LABEL;
export const AR_TYPE_LABELS = ARP_TYPE_LABEL;
export const AP_TYPE_LABELS = AP_TYPE_LABEL;
