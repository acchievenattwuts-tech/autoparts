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
  const count = await db.stockCard.count({
    where: { docNo: { startsWith: pattern } },
  });
  return `${pattern}${String(count + 1).padStart(4, "0")}`;
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
  const count = await db.receipt.count({
    where: { receiptNo: { startsWith: pattern } },
  });
  return `${pattern}${String(count + 1).padStart(4, "0")}`;
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
  const count = await db.expense.count({
    where: { expenseNo: { startsWith: pattern } },
  });
  return `${pattern}${String(count + 1).padStart(4, "0")}`;
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
