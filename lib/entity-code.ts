import { db } from "@/lib/db";

function nextCode(prefix: string, existingCodes: string[]): string {
  const regex = new RegExp(`^${prefix}(\\d+)$`);
  let max = 0;
  for (const code of existingCodes) {
    const m = code.match(regex);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

export async function generateProductCode(): Promise<string> {
  const rows = await db.product.findMany({ select: { code: true } });
  return nextCode("P", rows.map((r) => r.code));
}

export async function generateCustomerCode(): Promise<string> {
  const rows = await db.customer.findMany({
    select: { code: true },
    where: { code: { not: null } },
  });
  return nextCode("C", rows.map((r) => r.code!));
}

export async function generateExpenseCodeCode(): Promise<string> {
  const rows = await db.expenseCode.findMany({ select: { code: true } });
  return nextCode("E", rows.map((r) => r.code));
}

export async function generateSupplierCode(): Promise<string> {
  const rows = await db.supplier.findMany({
    select: { code: true },
    where: { code: { not: null } },
  });
  return nextCode("S", rows.map((r) => r.code!));
}
