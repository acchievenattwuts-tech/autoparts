import { db } from "@/lib/db";
import {
  DocStatus,
  VatType,
  SaleType,
  SalePaymentType,
  CreditNoteType,
  PaymentMethod,
} from "@/lib/generated/prisma";

// â”€â”€â”€ Filter helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function parseDate(s: string | undefined, fallback: Date): Date {
  if (!s) return fallback;
  const d = new Date(s);
  return isNaN(d.getTime()) ? fallback : d;
}

function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

export type ReportFilters = {
  from: Date;
  to: Date;
  fromStr: string;
  toStr: string;
  showCancelled: boolean;
  accountId?: string;
  paymentType?: string;  // for sales
  saleType?: string;     // for sales
  cnType?: string;       // for credit-notes
  paymentMethod?: string; // for receipts
  docType?: string;      // for payments: ALL | PURCHASE | EXPENSE
};

export function parseReportQueryFilters(
  params: Record<string, string | undefined>,
): ReportFilters {
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const from = parseDate(params.from, firstOfMonth);
  const to = parseDate(params.to, today);
  return {
    from,
    to: endOfDay(to),
    fromStr: params.from ?? from.toISOString().slice(0, 10),
    toStr: params.to ?? today.toISOString().slice(0, 10),
    showCancelled: params.showCancelled === "1",
    accountId: params.accountId,
    paymentType: params.paymentType,
    saleType: params.saleType,
    cnType: params.cnType,
    paymentMethod: params.paymentMethod,
    docType: params.docType,
  };
}

export function buildExportQuery(filters: ReportFilters): string {
  const p = new URLSearchParams();
  p.set("from", filters.fromStr);
  p.set("to", filters.toStr);
  if (filters.showCancelled) p.set("showCancelled", "1");
  if (filters.accountId) p.set("accountId", filters.accountId);
  if (filters.paymentType) p.set("paymentType", filters.paymentType);
  if (filters.saleType) p.set("saleType", filters.saleType);
  if (filters.cnType) p.set("cnType", filters.cnType);
  if (filters.paymentMethod) p.set("paymentMethod", filters.paymentMethod);
  if (filters.docType) p.set("docType", filters.docType);
  return p.toString();
}

// â”€â”€â”€ Label helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function saleTypeLabel(t: SaleType): string {
  return t === "RETAIL" ? "à¸›à¸¥à¸µà¸" : "à¸ªà¹ˆà¸‡";
}

export function paymentTypeLabel(t: SalePaymentType): string {
  return t === "CASH_SALE" ? "à¹€à¸‡à¸´à¸™à¸ªà¸”" : "à¹€à¸Šà¸·à¹ˆà¸­";
}

export function vatTypeLabel(t: VatType): string {
  if (t === "NO_VAT") return "à¹„à¸¡à¹ˆà¸¡à¸µ VAT";
  if (t === "EXCLUDING_VAT") return "à¹à¸¢à¸ VAT";
  return "à¸£à¸§à¸¡ VAT";
}

export function cnTypeLabel(t: CreditNoteType): string {
  if (t === "RETURN") return "à¸„à¸·à¸™à¸ªà¸´à¸™à¸„à¹‰à¸²";
  if (t === "DISCOUNT") return "à¸ªà¹ˆà¸§à¸™à¸¥à¸”";
  return "à¸­à¸·à¹ˆà¸™à¹†";
}

export function paymentMethodLabel(m: PaymentMethod | null | undefined): string {
  if (m === "CASH") return "à¹€à¸‡à¸´à¸™à¸ªà¸”";
  if (m === "TRANSFER") return "à¹‚à¸­à¸™à¹€à¸‡à¸´à¸™";
  if (m === "CREDIT") return "à¹€à¸„à¸£à¸”à¸´à¸•";
  return "-";
}

export function settlementLabel(s: string): string {
  return s === "CASH_REFUND" ? "à¸„à¸·à¸™à¹€à¸‡à¸´à¸™à¸ªà¸”" : "à¸•à¸±à¹‰à¸‡à¸«à¸™à¸µà¹‰";
}

export function statusLabel(s: DocStatus): string {
  return s === "ACTIVE" ? "à¸›à¸à¸•à¸´" : "à¸¢à¸à¹€à¸¥à¸´à¸";
}

// â”€â”€â”€ Row types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type SaleRow = {
  rowNo: number;
  docNo: string;
  docDate: Date;
  docType: string;
  paymentType: string;
  paymentMethod: string;
  accountName: string;
  customerCode: string;
  customerName: string;
  note: string;
  status: DocStatus;
  productCode: string;
  productName: string;
  qty: number;
  unitName: string;
  unitPrice: number;
  subtotalAmount: number;
  vatType: string;
  vatAmount: number;
  totalAmount: number;
};

export type PurchaseRow = {
  rowNo: number;
  docNo: string;
  docDate: Date;
  paymentStatus: string;
  paymentMethod: string;
  accountName: string;
  supplierCode: string;
  supplierName: string;
  referenceNo: string;
  status: DocStatus;
  productCode: string;
  productName: string;
  qty: number;
  unitName: string;
  unitPrice: number;
  subtotalAmount: number;
  vatType: string;
  vatAmount: number;
  totalAmount: number;
};

export type CreditNoteRow = {
  rowNo: number;
  docNo: string;
  docDate: Date;
  refSaleNo: string;
  customerCode: string;
  customerName: string;
  cnType: string;
  settlement: string;
  paymentMethod: string;
  accountName: string;
  status: DocStatus;
  productCode: string;
  productName: string;
  qty: number;
  unitPrice: number;
  subtotalAmount: number;
  vatType: string;
  vatAmount: number;
  totalAmount: number;
  detail: string;
};

export type ReceiptRow = {
  rowNo: number;
  docNo: string;
  docDate: Date;
  customerCode: string;
  customerName: string;
  refDocNo: string;
  refType: string;
  paymentMethod: string;
  accountName: string;
  status: DocStatus;
  amount: number;
};

export type PaymentRow = {
  rowNo: number;
  docNo: string;
  docDate: Date;
  docType: string;
  partyName: string;
  paymentMethod: string;
  accountName: string;
  status: DocStatus;
  subtotalAmount: number;
  vatType: string;
  vatAmount: number;
  netAmount: number;
};

// â”€â”€â”€ Query: Sales Register â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function querySalesRows(filters: ReportFilters): Promise<SaleRow[]> {
  const statusFilter: { status?: DocStatus } = filters.showCancelled
    ? {}
    : { status: "ACTIVE" };

  const sales = await db.sale.findMany({
    where: {
      saleDate: { gte: filters.from, lte: filters.to },
      ...statusFilter,
      ...(filters.paymentType && filters.paymentType !== "ALL"
        ? { paymentType: filters.paymentType as SalePaymentType }
        : {}),
      ...(filters.saleType && filters.saleType !== "ALL"
        ? { saleType: filters.saleType as SaleType }
        : {}),
    },
      select: {
        saleNo: true,
        saleDate: true,
        saleType: true,
        paymentType: true,
        paymentMethod: true,
        vatType: true,
        vatAmount: true,
        subtotalAmount: true,
        status: true,
        customerName: true,
        note: true,
        cashBankAccount: { select: { name: true } },
        customer: { select: { code: true } },
      items: {
        select: {
          quantity: true,
          salePrice: true,
          subtotalAmount: true,
          totalAmount: true,
          product: { select: { code: true, name: true, saleUnitName: true } },
        },
      },
    },
    orderBy: [{ saleDate: "asc" }, { saleNo: "asc" }],
    take: 2000,
  });

  const rows: SaleRow[] = [];
  let rowNo = 1;
  for (const sale of sales) {
    const saleSubtotal = Number(sale.subtotalAmount);
    const saleVat = Number(sale.vatAmount);
    for (const item of sale.items) {
      const sub = Number(item.subtotalAmount);
      const vatShare =
        saleSubtotal > 0
          ? Math.round((sub / saleSubtotal) * saleVat * 100) / 100
          : 0;
      rows.push({
        rowNo: rowNo++,
        docNo: sale.saleNo,
        docDate: sale.saleDate,
        docType: saleTypeLabel(sale.saleType),
        paymentType: paymentTypeLabel(sale.paymentType),
        paymentMethod: paymentMethodLabel(sale.paymentMethod),
        accountName: sale.cashBankAccount?.name ?? "-",
        customerCode: sale.customer?.code ?? "",
        customerName: sale.customerName ?? "",
        note: sale.note ?? "",
        status: sale.status,
        productCode: item.product.code,
        productName: item.product.name,
        qty: item.quantity,
        unitName: item.product.saleUnitName,
        unitPrice: Number(item.salePrice),
        subtotalAmount: sub,
        vatType: vatTypeLabel(sale.vatType),
        vatAmount: vatShare,
        totalAmount: Number(item.totalAmount),
      });
    }
  }
  return rows;
}

// â”€â”€â”€ Query: Purchase Register â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function queryPurchaseRows(filters: ReportFilters): Promise<PurchaseRow[]> {
  const statusFilter: { status?: DocStatus } = filters.showCancelled
    ? {}
    : { status: "ACTIVE" };

  const purchases = await db.purchase.findMany({
    where: {
      purchaseDate: { gte: filters.from, lte: filters.to },
      ...statusFilter,
    },
      select: {
        purchaseNo: true,
        purchaseDate: true,
        paymentStatus: true,
        paymentMethod: true,
        referenceNo: true,
        vatType: true,
        vatAmount: true,
        subtotalAmount: true,
        cashBankAccount: { select: { name: true } },
        status: true,
        supplier: { select: { code: true, name: true } },
      items: {
        select: {
          quantity: true,
          costPrice: true,
          subtotalAmount: true,
          totalAmount: true,
          product: { select: { code: true, name: true, purchaseUnitName: true } },
        },
      },
    },
    orderBy: [{ purchaseDate: "asc" }, { purchaseNo: "asc" }],
    take: 2000,
  });

  const rows: PurchaseRow[] = [];
  let rowNo = 1;
  for (const p of purchases) {
    const pSubtotal = Number(p.subtotalAmount);
    const pVat = Number(p.vatAmount);
    for (const item of p.items) {
      const sub = Number(item.subtotalAmount);
      const vatShare =
        pSubtotal > 0
          ? Math.round((sub / pSubtotal) * pVat * 100) / 100
          : 0;
      rows.push({
        rowNo: rowNo++,
        docNo: p.purchaseNo,
        docDate: p.purchaseDate,
        paymentStatus: p.paymentStatus,
        paymentMethod: paymentMethodLabel(p.paymentMethod),
        accountName: p.cashBankAccount?.name ?? "-",
        supplierCode: p.supplier?.code ?? "(à¹„à¸¡à¹ˆà¸¡à¸µà¸£à¸«à¸±à¸ª)",
        supplierName: p.supplier?.name ?? "(à¹„à¸¡à¹ˆà¸£à¸°à¸šà¸¸)",
        referenceNo: p.referenceNo ?? "",
        status: p.status,
        productCode: item.product.code,
        productName: item.product.name,
        qty: item.quantity,
        unitName: item.product.purchaseUnitName,
        unitPrice: Number(item.costPrice),
        subtotalAmount: sub,
        vatType: vatTypeLabel(p.vatType),
        vatAmount: vatShare,
        totalAmount: Number(item.totalAmount),
      });
    }
  }
  return rows;
}

// â”€â”€â”€ Query: Credit Note Register â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function queryCreditNoteRows(filters: ReportFilters): Promise<CreditNoteRow[]> {
  const statusFilter: { status?: DocStatus } = filters.showCancelled
    ? {}
    : { status: "ACTIVE" };

  const cns = await db.creditNote.findMany({
    where: {
      cnDate: { gte: filters.from, lte: filters.to },
      ...statusFilter,
      ...(filters.cnType && filters.cnType !== "ALL"
        ? { type: filters.cnType as CreditNoteType }
        : {}),
    },
      select: {
        cnNo: true,
        cnDate: true,
        type: true,
        settlementType: true,
        refundMethod: true,
        vatType: true,
        vatAmount: true,
        subtotalAmount: true,
        status: true,
        customerName: true,
        cashBankAccount: { select: { name: true } },
        sale: { select: { saleNo: true } },
      customer: { select: { code: true } },
      items: {
        select: {
          qty: true,
          unitPrice: true,
          subtotalAmount: true,
          amount: true,
          detail: true,
          product: { select: { code: true, name: true } },
        },
      },
    },
    orderBy: [{ cnDate: "asc" }, { cnNo: "asc" }],
    take: 2000,
  });

  const rows: CreditNoteRow[] = [];
  let rowNo = 1;
  for (const cn of cns) {
    const cnSubtotal = Number(cn.subtotalAmount);
    const cnVat = Number(cn.vatAmount);
    for (const item of cn.items) {
      const sub = Number(item.subtotalAmount);
      const vatShare =
        cnSubtotal > 0
          ? Math.round((sub / cnSubtotal) * cnVat * 100) / 100
          : 0;
      rows.push({
        rowNo: rowNo++,
        docNo: cn.cnNo,
        docDate: cn.cnDate,
        refSaleNo: cn.sale?.saleNo ?? "",
        customerCode: cn.customer?.code ?? "",
        customerName: cn.customerName ?? "",
        cnType: cnTypeLabel(cn.type),
        settlement: settlementLabel(cn.settlementType),
        paymentMethod:
          cn.settlementType === "CASH_REFUND"
            ? cn.refundMethod === "CASH"
              ? "à¹€à¸‡à¸´à¸™à¸ªà¸”"
              : cn.refundMethod === "TRANSFER"
                ? "à¹‚à¸­à¸™à¹€à¸‡à¸´à¸™"
                : "-"
            : "-",
        accountName: cn.cashBankAccount?.name ?? "-",
        status: cn.status,
        productCode: item.product?.code ?? "",
        productName: item.product?.name ?? "",
        qty: Number(item.qty),
        unitPrice: Number(item.unitPrice),
        subtotalAmount: sub,
        vatType: vatTypeLabel(cn.vatType),
        vatAmount: vatShare,
        totalAmount: Number(item.amount),
        detail: item.detail ?? "",
      });
    }
  }
  return rows;
}

// â”€â”€â”€ Query: Receipt Register â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function queryReceiptRows(filters: ReportFilters): Promise<ReceiptRow[]> {
  const statusFilter: { status?: DocStatus } = filters.showCancelled
    ? {}
    : { status: "ACTIVE" };

  const receipts = await db.receipt.findMany({
    where: {
      receiptDate: { gte: filters.from, lte: filters.to },
      ...statusFilter,
      ...(filters.paymentMethod && filters.paymentMethod !== "ALL"
        ? { paymentMethod: filters.paymentMethod as PaymentMethod }
        : {}),
      ...(filters.accountId ? { cashBankAccountId: filters.accountId } : {}),
    },
    select: {
      receiptNo: true,
      receiptDate: true,
      paymentMethod: true,
      totalAmount: true,
      status: true,
      customerName: true,
      cashBankAccount: { select: { name: true } },
      customer: { select: { code: true } },
      items: {
        select: {
          paidAmount: true,
          sale: { select: { saleNo: true } },
          creditNote: { select: { cnNo: true } },
        },
      },
    },
    orderBy: [{ receiptDate: "asc" }, { receiptNo: "asc" }],
    take: 2000,
  });

  const rows: ReceiptRow[] = [];
  let rowNo = 1;
  for (const r of receipts) {
    for (const item of r.items) {
      rows.push({
        rowNo: rowNo++,
        docNo: r.receiptNo,
        docDate: r.receiptDate,
        customerCode: r.customer?.code ?? "",
        customerName: r.customerName ?? "",
        refDocNo: item.sale?.saleNo ?? item.creditNote?.cnNo ?? "",
        refType: item.sale ? "à¹ƒà¸šà¸‚à¸²à¸¢" : item.creditNote ? "CN" : "",
        paymentMethod: paymentMethodLabel(r.paymentMethod),
        accountName: r.cashBankAccount?.name ?? "-",
        status: r.status,
        amount: Number(item.paidAmount),
      });
    }
  }
  return rows;
}

// â”€â”€â”€ Query: Payment Register â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function queryPaymentRows(filters: ReportFilters): Promise<PaymentRow[]> {
  const showCancelled = filters.showCancelled;
  const docType = filters.docType ?? "ALL";
  const rows: PaymentRow[] = [];

  if (docType === "ALL" || docType === "PURCHASE") {
    const statusFilter: { status?: DocStatus } = showCancelled ? {} : { status: "ACTIVE" };
    const purchases = await db.purchase.findMany({
      where: {
        purchaseDate: { gte: filters.from, lte: filters.to },
        paymentStatus: "PAID",
        ...(filters.accountId ? { cashBankAccountId: filters.accountId } : {}),
        ...statusFilter,
      },
      select: {
        purchaseNo: true,
        purchaseDate: true,
        vatType: true,
        vatAmount: true,
        subtotalAmount: true,
        netAmount: true,
        status: true,
        paymentMethod: true,
        cashBankAccount: { select: { name: true } },
        supplier: { select: { name: true } },
      },
      orderBy: [{ purchaseDate: "asc" }, { purchaseNo: "asc" }],
      take: 2000,
    });
    for (const p of purchases) {
      rows.push({
        rowNo: 0,
        docNo: p.purchaseNo,
        docDate: p.purchaseDate,
        docType: "à¸‹à¸·à¹‰à¸­à¸ªà¸´à¸™à¸„à¹‰à¸²",
        partyName: p.supplier?.name ?? "(à¹„à¸¡à¹ˆà¸£à¸°à¸šà¸¸)",
        paymentMethod: paymentMethodLabel(p.paymentMethod),
        accountName: p.cashBankAccount?.name ?? "-",
        status: p.status,
        subtotalAmount: Number(p.subtotalAmount),
        vatType: vatTypeLabel(p.vatType),
        vatAmount: Number(p.vatAmount),
        netAmount: Number(p.netAmount),
      });
    }
  }

  if (docType === "ALL" || docType === "EXPENSE") {
    const statusFilter: { status?: DocStatus } = showCancelled ? {} : { status: "ACTIVE" };
    const expenses = await db.expense.findMany({
      where: {
        expenseDate: { gte: filters.from, lte: filters.to },
        ...(filters.accountId ? { cashBankAccountId: filters.accountId } : {}),
        ...statusFilter,
      },
      select: {
        expenseNo: true,
        expenseDate: true,
        vatType: true,
        vatAmount: true,
        subtotalAmount: true,
        netAmount: true,
        status: true,
        note: true,
        items: {
          select: { expenseCode: { select: { name: true } } },
          take: 1,
        },
        cashBankAccount: { select: { name: true } },
      },
      orderBy: [{ expenseDate: "asc" }, { expenseNo: "asc" }],
      take: 2000,
    });
    for (const e of expenses) {
      const codeName = e.items[0]?.expenseCode?.name ?? "";
      rows.push({
        rowNo: 0,
        docNo: e.expenseNo,
        docDate: e.expenseDate,
        docType: "à¸„à¹ˆà¸²à¹ƒà¸Šà¹‰à¸ˆà¹ˆà¸²à¸¢",
        partyName: codeName + (e.note ? ` â€” ${e.note}` : ""),
        paymentMethod: "-",
        accountName: e.cashBankAccount?.name ?? "-",
        status: e.status,
        subtotalAmount: Number(e.subtotalAmount),
        vatType: vatTypeLabel(e.vatType),
        vatAmount: Number(e.vatAmount),
        netAmount: Number(e.netAmount),
      });
    }
  }

  // Sort by date â†’ docNo, then assign rowNo
  rows.sort((a, b) => {
    const dt = a.docDate.getTime() - b.docDate.getTime();
    return dt !== 0 ? dt : a.docNo.localeCompare(b.docNo);
  });
  rows.forEach((r, i) => (r.rowNo = i + 1));

  return rows;
}

// â”€â”€â”€ CSV builders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const BOM = "\uFEFF";

function fmtDate(d: Date): string {
  return d.toLocaleDateString("th-TH-u-ca-gregory", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function csvRow(cells: (string | number)[]): string {
  return cells
    .map((c) => {
      const s = String(c);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    })
    .join(",");
}

export function buildSalesCsv(rows: SaleRow[]): string {
  const header = csvRow([
    "ลำดับ","เลขที่เอกสาร","วันที่","ประเภท","การชำระ","ช่องทางชำระ","บัญชีเงิน","รหัสลูกค้า","ชื่อลูกค้า",
    "หมายเหตุ","สถานะ","รหัสสินค้า","ชื่อสินค้า","จำนวน","หน่วย","ราคา/หน่วย",
    "ก่อน VAT","VAT Type","VAT","รวม",
  ]);
  const body = rows.map((r) =>
    csvRow([
      r.rowNo, r.docNo, fmtDate(r.docDate), r.docType, r.paymentType, r.paymentMethod, r.accountName,
      r.customerCode, r.customerName, r.note, statusLabel(r.status),
      r.productCode, r.productName, r.qty, r.unitName, r.unitPrice,
      r.subtotalAmount, r.vatType, r.vatAmount, r.totalAmount,
    ]),
  );
  return BOM + [header, ...body].join("\r\n");
}

export function buildPurchasesCsv(rows: PurchaseRow[]): string {
  const header = csvRow([
    "ลำดับ","เลขที่เอกสาร","วันที่","สถานะชำระเงิน","ช่องทางชำระ","บัญชีเงิน","รหัสซัพพลายเออร์","ชื่อซัพพลายเออร์",
    "เลขอ้างอิง","สถานะเอกสาร","รหัสสินค้า","ชื่อสินค้า","จำนวน","หน่วย",
    "ราคา/หน่วย","ก่อน VAT","VAT Type","VAT","รวม",
  ]);
  const body = rows.map((r) =>
    csvRow([
      r.rowNo, r.docNo, fmtDate(r.docDate), r.paymentStatus, r.paymentMethod, r.accountName, r.supplierCode, r.supplierName,
      r.referenceNo, statusLabel(r.status), r.productCode, r.productName,
      r.qty, r.unitName, r.unitPrice, r.subtotalAmount,
      r.vatType, r.vatAmount, r.totalAmount,
    ]),
  );
  return BOM + [header, ...body].join("\r\n");
}

export function buildCreditNotesCsv(rows: CreditNoteRow[]): string {
  const header = csvRow([
    "ลำดับ","เลขที่ CN","วันที่","อ้างอิงใบขาย","รหัสลูกค้า","ชื่อลูกค้า",
    "ประเภท CN","การตั้งหนี้","ช่องทางคืนเงิน","บัญชีเงิน","สถานะ","รหัสสินค้า","ชื่อสินค้า","รายละเอียด",
    "จำนวน","ราคา/หน่วย","ก่อน VAT","VAT Type","VAT","รวม",
  ]);
  const body = rows.map((r) =>
    csvRow([
      r.rowNo, r.docNo, fmtDate(r.docDate), r.refSaleNo,
      r.customerCode, r.customerName, r.cnType, r.settlement, r.paymentMethod, r.accountName,
      statusLabel(r.status), r.productCode, r.productName, r.detail,
      r.qty, r.unitPrice, r.subtotalAmount, r.vatType, r.vatAmount, r.totalAmount,
    ]),
  );
  return BOM + [header, ...body].join("\r\n");
}

export function buildReceiptsCsv(rows: ReceiptRow[]): string {
  const header = csvRow([
    "ลำดับ","เลขที่เอกสาร","วันที่","รหัสลูกค้า","ชื่อลูกค้า",
    "เลขที่อ้างอิง","ประเภทอ้างอิง","ช่องทางชำระ","บัญชีเงิน","สถานะ","จำนวนเงิน",
  ]);
  const body = rows.map((r) =>
    csvRow([
      r.rowNo, r.docNo, fmtDate(r.docDate), r.customerCode, r.customerName,
      r.refDocNo, r.refType, r.paymentMethod, r.accountName, statusLabel(r.status), r.amount,
    ]),
  );
  return BOM + [header, ...body].join("\r\n");
}

export function buildPaymentsCsv(rows: PaymentRow[]): string {
  const header = csvRow([
    "ลำดับ","เลขที่เอกสาร","วันที่","ประเภทรายการ","คู่ค้า/รายละเอียด",
    "ช่องทางชำระ","บัญชีเงิน","สถานะ","ก่อน VAT","VAT Type","VAT","ยอดสุทธิ",
  ]);
  const body = rows.map((r) =>
    csvRow([
      r.rowNo, r.docNo, fmtDate(r.docDate), r.docType, r.partyName,
      r.paymentMethod, r.accountName, statusLabel(r.status),
      r.subtotalAmount, r.vatType, r.vatAmount, r.netAmount,
    ]),
  );
  return BOM + [header, ...body].join("\r\n");
}

// â”€â”€â”€ Daily Receipt row type â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type DailyReceiptRow = {
  rowNo: number;
  docNo: string;
  docDate: Date;
  docType: string; // "à¸‚à¸²à¸¢à¸ªà¸”" | "à¸£à¸±à¸šà¸Šà¸³à¸£à¸°à¸«à¸™à¸µà¹‰"
  customerCode: string;
  customerName: string;
  paymentMethod: string;
  accountName: string;
  note: string;
  status: DocStatus;
  amount: number;
};

// â”€â”€â”€ Query: Daily Receipt â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function queryDailyReceiptRows(
  filters: ReportFilters,
): Promise<DailyReceiptRow[]> {
  const showCancelled = filters.showCancelled;
  const docType = filters.docType ?? "ALL";
  const rows: DailyReceiptRow[] = [];

  if (docType === "ALL" || docType === "CASH_SALE") {
    const statusFilter: { status?: DocStatus } = showCancelled ? {} : { status: "ACTIVE" };
    const sales = await db.sale.findMany({
      where: {
        saleDate: { gte: filters.from, lte: filters.to },
        paymentType: "CASH_SALE",
        ...(filters.accountId ? { cashBankAccountId: filters.accountId } : {}),
        ...statusFilter,
      },
      select: {
        saleNo: true,
        saleDate: true,
        customerName: true,
        paymentMethod: true,
        netAmount: true,
        note: true,
        status: true,
        cashBankAccount: { select: { name: true } },
        customer: { select: { code: true } },
      },
      orderBy: [{ saleDate: "asc" }, { saleNo: "asc" }],
      take: 2000,
    });
    for (const s of sales) {
      rows.push({
        rowNo: 0,
        docNo: s.saleNo,
        docDate: s.saleDate,
        docType: "à¸‚à¸²à¸¢à¸ªà¸”",
        customerCode: s.customer?.code ?? "",
        customerName: s.customerName ?? "",
        paymentMethod: paymentMethodLabel(s.paymentMethod),
        accountName: s.cashBankAccount?.name ?? "-",
        note: s.note ?? "",
        status: s.status,
        amount: Number(s.netAmount),
      });
    }
  }

  if (docType === "ALL" || docType === "RECEIPT") {
    const statusFilter: { status?: DocStatus } = showCancelled ? {} : { status: "ACTIVE" };
    const receipts = await db.receipt.findMany({
      where: {
        receiptDate: { gte: filters.from, lte: filters.to },
        ...(filters.accountId ? { cashBankAccountId: filters.accountId } : {}),
        ...statusFilter,
      },
      select: {
        receiptNo: true,
        receiptDate: true,
        customerName: true,
        paymentMethod: true,
        totalAmount: true,
        note: true,
        status: true,
        cashBankAccount: { select: { name: true } },
        customer: { select: { code: true } },
      },
      orderBy: [{ receiptDate: "asc" }, { receiptNo: "asc" }],
      take: 2000,
    });
    for (const r of receipts) {
      rows.push({
        rowNo: 0,
        docNo: r.receiptNo,
        docDate: r.receiptDate,
        docType: "à¸£à¸±à¸šà¸Šà¸³à¸£à¸°à¸«à¸™à¸µà¹‰",
        customerCode: r.customer?.code ?? "",
        customerName: r.customerName ?? "",
        paymentMethod: paymentMethodLabel(r.paymentMethod),
        accountName: r.cashBankAccount?.name ?? "-",
        note: r.note ?? "",
        status: r.status,
        amount: Number(r.totalAmount),
      });
    }
  }

  rows.sort((a, b) => {
    const dt = a.docDate.getTime() - b.docDate.getTime();
    return dt !== 0 ? dt : a.docNo.localeCompare(b.docNo);
  });
  rows.forEach((r, i) => (r.rowNo = i + 1));
  return rows;
}

// â”€â”€â”€ Daily Payment row type â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type DailyPaymentRow = {
  rowNo: number;
  docNo: string;
  docDate: Date;
  docType: string; // "à¸‹à¸·à¹‰à¸­à¸ªà¸´à¸™à¸„à¹‰à¸²" | "à¸„à¹ˆà¸²à¹ƒà¸Šà¹‰à¸ˆà¹ˆà¸²à¸¢" | "à¸„à¸·à¸™à¹€à¸‡à¸´à¸™à¸¥à¸¹à¸à¸„à¹‰à¸²"
  partyCode: string;
  partyName: string;
  paymentMethod: string;
  accountName: string;
  note: string;
  status: DocStatus;
  amount: number;
};

// â”€â”€â”€ Query: Daily Payment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function queryDailyPaymentRows(
  filters: ReportFilters,
): Promise<DailyPaymentRow[]> {
  const showCancelled = filters.showCancelled;
  const docType = filters.docType ?? "ALL";
  const rows: DailyPaymentRow[] = [];

  if (docType === "ALL" || docType === "PURCHASE") {
    const statusFilter: { status?: DocStatus } = showCancelled ? {} : { status: "ACTIVE" };
    const purchases = await db.purchase.findMany({
      where: {
        purchaseDate: { gte: filters.from, lte: filters.to },
        paymentStatus: "PAID",
        ...(filters.accountId ? { cashBankAccountId: filters.accountId } : {}),
        ...statusFilter,
      },
      select: {
        purchaseNo: true,
        purchaseDate: true,
        netAmount: true,
        paymentMethod: true,
        note: true,
        status: true,
        cashBankAccount: { select: { name: true } },
        supplier: { select: { code: true, name: true } },
      },
      orderBy: [{ purchaseDate: "asc" }, { purchaseNo: "asc" }],
      take: 2000,
    });
    for (const p of purchases) {
      rows.push({
        rowNo: 0,
        docNo: p.purchaseNo,
        docDate: p.purchaseDate,
        docType: "à¸‹à¸·à¹‰à¸­à¸ªà¸´à¸™à¸„à¹‰à¸²",
        partyCode: p.supplier?.code ?? "",
        partyName: p.supplier?.name ?? "(à¹„à¸¡à¹ˆà¸£à¸°à¸šà¸¸)",
        paymentMethod: paymentMethodLabel(p.paymentMethod),
        accountName: p.cashBankAccount?.name ?? "-",
        note: p.note ?? "",
        status: p.status,
        amount: Number(p.netAmount),
      });
    }
  }

  if (docType === "ALL" || docType === "EXPENSE") {
    const statusFilter: { status?: DocStatus } = showCancelled ? {} : { status: "ACTIVE" };
    const expenses = await db.expense.findMany({
      where: {
        expenseDate: { gte: filters.from, lte: filters.to },
        ...(filters.accountId ? { cashBankAccountId: filters.accountId } : {}),
        ...statusFilter,
      },
      select: {
        expenseNo: true,
        expenseDate: true,
        netAmount: true,
        note: true,
        status: true,
        cashBankAccount: { select: { name: true } },
        items: {
          select: { expenseCode: { select: { name: true } } },
          take: 1,
        },
      },
      orderBy: [{ expenseDate: "asc" }, { expenseNo: "asc" }],
      take: 2000,
    });
    for (const e of expenses) {
      const codeName = e.items[0]?.expenseCode?.name ?? "";
      rows.push({
        rowNo: 0,
        docNo: e.expenseNo,
        docDate: e.expenseDate,
        docType: "à¸„à¹ˆà¸²à¹ƒà¸Šà¹‰à¸ˆà¹ˆà¸²à¸¢",
        partyCode: "",
        partyName: codeName,
        paymentMethod: "-",
        accountName: e.cashBankAccount?.name ?? "-",
        note: e.note ?? "",
        status: e.status,
        amount: Number(e.netAmount),
      });
    }
  }

  if (docType === "ALL" || docType === "CN_REFUND") {
    const statusFilter: { status?: DocStatus } = showCancelled ? {} : { status: "ACTIVE" };
    const cns = await db.creditNote.findMany({
      where: {
        cnDate: { gte: filters.from, lte: filters.to },
        settlementType: "CASH_REFUND",
        ...(filters.accountId ? { cashBankAccountId: filters.accountId } : {}),
        ...statusFilter,
      },
      select: {
        cnNo: true,
        cnDate: true,
        totalAmount: true,
        refundMethod: true,
        customerName: true,
        note: true,
        status: true,
        cashBankAccount: { select: { name: true } },
        customer: { select: { code: true } },
      },
      orderBy: [{ cnDate: "asc" }, { cnNo: "asc" }],
      take: 2000,
    });
    for (const cn of cns) {
      const pmLabel =
        cn.refundMethod === "CASH" ? "à¹€à¸‡à¸´à¸™à¸ªà¸”"
        : cn.refundMethod === "TRANSFER" ? "à¹‚à¸­à¸™à¹€à¸‡à¸´à¸™"
        : "-";
      rows.push({
        rowNo: 0,
        docNo: cn.cnNo,
        docDate: cn.cnDate,
        docType: "à¸„à¸·à¸™à¹€à¸‡à¸´à¸™à¸¥à¸¹à¸à¸„à¹‰à¸²",
        partyCode: cn.customer?.code ?? "",
        partyName: cn.customerName ?? "",
        paymentMethod: pmLabel,
        accountName: cn.cashBankAccount?.name ?? "-",
        note: cn.note ?? "",
        status: cn.status,
        amount: Number(cn.totalAmount),
      });
    }
  }

  rows.sort((a, b) => {
    const dt = a.docDate.getTime() - b.docDate.getTime();
    return dt !== 0 ? dt : a.docNo.localeCompare(b.docNo);
  });
  rows.forEach((r, i) => (r.rowNo = i + 1));
  return rows;
}

// â”€â”€â”€ CSV builders for daily reports â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function buildDailyReceiptCsv(rows: DailyReceiptRow[]): string {
  const header = csvRow([
    "ลำดับ","เลขที่เอกสาร","วันที่","ประเภท","รหัสลูกค้า","ชื่อลูกค้า",
    "ช่องทางชำระ","บัญชีเงิน","หมายเหตุ","สถานะ","จำนวนเงิน",
  ]);
  const body = rows.map((r) =>
    csvRow([
      r.rowNo, r.docNo, fmtDate(r.docDate), r.docType,
      r.customerCode, r.customerName, r.paymentMethod, r.accountName,
      r.note, statusLabel(r.status), r.amount,
    ]),
  );
  return BOM + [header, ...body].join("\r\n");
}

export function buildDailyPaymentCsv(rows: DailyPaymentRow[]): string {
  const header = csvRow([
    "ลำดับ","เลขที่เอกสาร","วันที่","ประเภทรายการ","รหัสคู่ค้า","ชื่อคู่ค้า/รายละเอียด",
    "ช่องทางชำระ","บัญชีเงิน","หมายเหตุ","สถานะ","จำนวนเงิน",
  ]);
  const body = rows.map((r) =>
    csvRow([
      r.rowNo, r.docNo, fmtDate(r.docDate), r.docType,
      r.partyCode, r.partyName, r.paymentMethod, r.accountName,
      r.note, statusLabel(r.status), r.amount,
    ]),
  );
  return BOM + [header, ...body].join("\r\n");
}





