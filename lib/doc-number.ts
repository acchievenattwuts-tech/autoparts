import { db } from "@/lib/db";

/**
 * Generate document number: {PREFIX}{YYMM}{4-digit sequence}
 * Format: SA2603001 = SA prefix, year 2026, month 03, sequence 0001
 * Sequence resets every month (counts only records with same PREFIX+YYMM pattern)
 */
export async function generateDocNo(prefix: string, date?: Date): Promise<string> {
  const d = date ?? new Date();
  const yy   = String(d.getFullYear()).slice(-2);   // last 2 digits of year
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const pattern = `${prefix}${yy}${mm}`;
  const last = await db.stockCard.findFirst({
    where: { docNo: { startsWith: pattern } },
    orderBy: { docNo: "desc" },
    select: { docNo: true },
  });
  const seq = last ? parseInt(last.docNo.slice(pattern.length), 10) + 1 : 1;
  return `${pattern}${String(seq).padStart(4, "0")}`;
}

/**
 * Generate BF number using BalanceForward table (not StockCard)
 * Because cancelled BFs delete their StockCard rows but keep the BalanceForward record.
 * Format: BF{YYMM}{4-digit}
 */
export async function generateBFNo(date?: Date): Promise<string> {
  const d = date ?? new Date();
  const yy   = String(d.getFullYear()).slice(-2);
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const pattern = `BF${yy}${mm}`;
  const last = await db.balanceForward.findFirst({
    where: { docNo: { startsWith: pattern } },
    orderBy: { docNo: "desc" },
    select: { docNo: true },
  });
  const seq = last ? parseInt(last.docNo.slice(pattern.length), 10) + 1 : 1;
  return `${pattern}${String(seq).padStart(4, "0")}`;
}

/**
 * Generate receipt number using Receipt table (not StockCard)
 * Format: REC{YYMM}{4-digit}
 */
export async function generateReceiptNo(date?: Date): Promise<string> {
  const d = date ?? new Date();
  const yy   = String(d.getFullYear()).slice(-2);
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const pattern = `REC${yy}${mm}`;
  const last = await db.receipt.findFirst({
    where: { receiptNo: { startsWith: pattern } },
    orderBy: { receiptNo: "desc" },
    select: { receiptNo: true },
  });
  const seq = last ? parseInt(last.receiptNo.slice(pattern.length), 10) + 1 : 1;
  return `${pattern}${String(seq).padStart(4, "0")}`;
}

/**
 * Generate expense number using Expense table
 * Format: OE{YYMM}{4-digit}
 */
export async function generateExpenseNo(date?: Date): Promise<string> {
  const d = date ?? new Date();
  const yy   = String(d.getFullYear()).slice(-2);
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const pattern = `OE${yy}${mm}`;
  const last = await db.expense.findFirst({
    where: { expenseNo: { startsWith: pattern } },
    orderBy: { expenseNo: "desc" },
    select: { expenseNo: true },
  });
  const seq = last ? parseInt(last.expenseNo.slice(pattern.length), 10) + 1 : 1;
  return `${pattern}${String(seq).padStart(4, "0")}`;
}

/**
 * Generate purchase number using Purchase table
 * Format: RR{YYMM}{4-digit}
 */
export async function generatePurchaseNo(date?: Date): Promise<string> {
  const d = date ?? new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const pattern = `RR${yy}${mm}`;
  const last = await db.purchase.findFirst({
    where: { purchaseNo: { startsWith: pattern } },
    orderBy: { purchaseNo: "desc" },
    select: { purchaseNo: true },
  });
  const seq = last ? parseInt(last.purchaseNo.slice(pattern.length), 10) + 1 : 1;
  return `${pattern}${String(seq).padStart(4, "0")}`;
}

/**
 * Generate purchase return number using PurchaseReturn table
 * Format: CNRR{YYMM}{4-digit}
 */
export async function generatePurchaseReturnNo(date?: Date): Promise<string> {
  const d = date ?? new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const pattern = `CNRR${yy}${mm}`;
  const last = await db.purchaseReturn.findFirst({
    where: { returnNo: { startsWith: pattern } },
    orderBy: { returnNo: "desc" },
    select: { returnNo: true },
  });
  const seq = last ? parseInt(last.returnNo.slice(pattern.length), 10) + 1 : 1;
  return `${pattern}${String(seq).padStart(4, "0")}`;
}

/**
 * Generate sale number using Sale table
 * prefix: SA (cash) or SAC (credit)
 * Format: {prefix}{YYMM}{4-digit}
 */
export async function generateSaleNo(prefix: "SA" | "SAC", date?: Date): Promise<string> {
  const d = date ?? new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const pattern = `${prefix}${yy}${mm}`;
  const last = await db.sale.findFirst({
    where: { saleNo: { startsWith: pattern } },
    orderBy: { saleNo: "desc" },
    select: { saleNo: true },
  });
  const seq = last ? parseInt(last.saleNo.slice(pattern.length), 10) + 1 : 1;
  return `${pattern}${String(seq).padStart(4, "0")}`;
}

/**
 * Generate credit note number using CreditNote table
 * Format: CN{YYMM}{4-digit}
 */
export async function generateCNNo(date?: Date): Promise<string> {
  const d = date ?? new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const pattern = `CN${yy}${mm}`;
  const last = await db.creditNote.findFirst({
    where: { cnNo: { startsWith: pattern } },
    orderBy: { cnNo: "desc" },
    select: { cnNo: true },
  });
  const seq = last ? parseInt(last.cnNo.slice(pattern.length), 10) + 1 : 1;
  return `${pattern}${String(seq).padStart(4, "0")}`;
}

/**
 * Generate adjustment number using Adjustment table
 * Format: ADJ{YYMM}{4-digit}
 */
export async function generateAdjNo(date?: Date): Promise<string> {
  const d = date ?? new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const pattern = `ADJ${yy}${mm}`;
  const last = await db.adjustment.findFirst({
    where: { adjustNo: { startsWith: pattern } },
    orderBy: { adjustNo: "desc" },
    select: { adjustNo: true },
  });
  const seq = last ? parseInt(last.adjustNo.slice(pattern.length), 10) + 1 : 1;
  return `${pattern}${String(seq).padStart(4, "0")}`;
}

/**
 * Generate warranty claim number using WarrantyClaim table
 * Format: WC{YYMM}{4-digit}
 */
export async function generateClaimNo(date?: Date): Promise<string> {
  const d = date ?? new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const pattern = `WC${yy}${mm}`;
  const last = await db.warrantyClaim.findFirst({
    where: { claimNo: { startsWith: pattern } },
    orderBy: { claimNo: "desc" },
    select: { claimNo: true },
  });
  const seq = last ? parseInt(last.claimNo.slice(pattern.length), 10) + 1 : 1;
  return `${pattern}${String(seq).padStart(4, "0")}`;
}

/**
 * Generate cash/bank transfer number using CashBankTransfer table
 * Format: CBT{YYMM}{4-digit}
 */
export async function generateCashBankTransferNo(date?: Date): Promise<string> {
  const d = date ?? new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const pattern = `CBT${yy}${mm}`;
  const last = await db.cashBankTransfer.findFirst({
    where: { transferNo: { startsWith: pattern } },
    orderBy: { transferNo: "desc" },
    select: { transferNo: true },
  });
  const seq = last ? parseInt(last.transferNo.slice(pattern.length), 10) + 1 : 1;
  return `${pattern}${String(seq).padStart(4, "0")}`;
}

/**
 * Generate cash/bank adjustment number using CashBankAdjustment table
 * Format: CBA{YYMM}{4-digit}
 */
export async function generateCashBankAdjustmentNo(date?: Date): Promise<string> {
  const d = date ?? new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const pattern = `CBA${yy}${mm}`;
  const last = await db.cashBankAdjustment.findFirst({
    where: { adjustNo: { startsWith: pattern } },
    orderBy: { adjustNo: "desc" },
    select: { adjustNo: true },
  });
  const seq = last ? parseInt(last.adjustNo.slice(pattern.length), 10) + 1 : 1;
  return `${pattern}${String(seq).padStart(4, "0")}`;
}

/**
 * Document prefix reference:
 * BF   — ยอดยกมา (Beginning Balance)
 * RR   — ซื้อสินค้าเข้า (Purchase Order)
 * CNRR — คืนสินค้าซัพพลายเออร์ (Purchase Return)
 * SA   — ขายเงินสด (Cash Sale)
 * SAC  — ขายเงินเชื่อ (Credit Sale)
 * CN   — Credit Note
 * ADJ  — ปรับสต็อก (Adjustment)
 * REC  — ใบเสร็จรับเงิน (Receipt)
 * OE   — ค่าใช้จ่าย (Operating Expense)
 * WC   — ใบเคลมสินค้า (Warranty Claim)
 */
