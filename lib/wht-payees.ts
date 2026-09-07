import { db } from "@/lib/db";
import type { ExpenseSupplierOption } from "@/app/admin/(protected)/expenses/new/NewExpenseForm";

/**
 * ผู้รับเงินที่เลือกได้ในเอกสารฝั่งจ่าย
 * `hasTaxProfile` บอกว่ารายนั้นกรอกข้อมูลภาษีครบพอที่จะออกหนังสือรับรอง 50 ทวิ ได้แล้วหรือยัง
 */
export async function getExpensePayeeOptions(
  includeSupplierId?: string,
): Promise<ExpenseSupplierOption[]> {
  const suppliers = await db.supplier.findMany({
    where: includeSupplierId
      ? { OR: [{ isActive: true }, { id: includeSupplierId }] }
      : { isActive: true },
    orderBy: [{ code: "asc" }, { name: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      whtPayeeProfile: { select: { isActive: true } },
    },
  });

  return suppliers.map((supplier) => ({
    id: supplier.id,
    code: supplier.code,
    name: supplier.name,
    hasTaxProfile: Boolean(supplier.whtPayeeProfile?.isActive),
  }));
}
