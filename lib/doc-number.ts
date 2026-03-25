import { db } from "@/lib/db";

/**
 * Generate document number: {PREFIX}{YYYYMMDD}{4-digit sequence}
 * Example: BF202401010001, PO202401010003
 */
export async function generateDocNo(prefix: string, date?: Date): Promise<string> {
  const d = date ?? new Date();
  const dateStr = d.toISOString().slice(0, 10).replace(/-/g, "");
  const pattern = `${prefix}${dateStr}`;
  const count = await db.stockCard.count({
    where: { docNo: { startsWith: pattern } },
  });
  return `${pattern}${String(count + 1).padStart(4, "0")}`;
}
