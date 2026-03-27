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
 */
