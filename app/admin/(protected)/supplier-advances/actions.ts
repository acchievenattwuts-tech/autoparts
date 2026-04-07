"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, dbTx } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { generateSupplierAdvanceNo } from "@/lib/doc-number";
import {
  CashBankDirection,
  CashBankSourceType,
  PaymentMethod,
} from "@/lib/generated/prisma";
import { clearCashBankSourceMovements, replaceCashBankSourceMovements } from "@/lib/cash-bank";
import { recalculateSupplierAdvanceAmountRemain } from "@/lib/amount-remain";

const supplierAdvanceSchema = z.object({
  supplierId: z.string().min(1, "กรุณาเลือกซัพพลายเออร์"),
  advanceDate: z.string().min(1, "กรุณาระบุวันที่"),
  totalAmount: z.coerce.number().positive("ยอดเงินมัดจำต้องมากกว่า 0"),
  cashBankAccountId: z.string().min(1, "กรุณาเลือกบัญชีจ่ายเงิน"),
  note: z.string().max(500).optional(),
});

async function resolveSupplierAdvancePaymentMethod(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  accountId: string,
): Promise<PaymentMethod> {
  const account = await tx.cashBankAccount.findUnique({
    where: { id: accountId },
    select: { type: true },
  });

  if (!account) {
    throw new Error("ไม่พบบัญชีจ่ายเงินที่เลือก");
  }

  return account.type === "CASH" ? PaymentMethod.CASH : PaymentMethod.TRANSFER;
}

async function getActiveSupplierPaymentRefs(advanceId: string): Promise<string[]> {
  const refs = await db.supplierPaymentItem.findMany({
    where: {
      advanceId,
      payment: { status: "ACTIVE" },
    },
    select: {
      payment: { select: { paymentNo: true } },
    },
  });

  return [...new Set(refs.map((item) => item.payment.paymentNo))];
}

export async function createSupplierAdvance(
  formData: FormData,
): Promise<{ success: boolean; advanceNo?: string; error?: string }> {
  const session = await requirePermission("supplier_advances.create").catch(() => null);
  if (!session?.user?.id) {
    return { success: false, error: "กรุณาเข้าสู่ระบบก่อน" };
  }

  let parsed: z.infer<typeof supplierAdvanceSchema>;
  try {
    parsed = supplierAdvanceSchema.parse({
      supplierId: formData.get("supplierId"),
      advanceDate: formData.get("advanceDate"),
      totalAmount: formData.get("totalAmount"),
      cashBankAccountId: formData.get("cashBankAccountId"),
      note: formData.get("note") || undefined,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
    }
    return { success: false, error: "ข้อมูลไม่ถูกต้อง" };
  }

  const advanceDate = new Date(parsed.advanceDate);
  const advanceNo = await generateSupplierAdvanceNo(advanceDate);

  try {
    await dbTx(async (tx) => {
      const paymentMethod = await resolveSupplierAdvancePaymentMethod(tx, parsed.cashBankAccountId);

      const advance = await tx.supplierAdvance.create({
        data: {
          advanceNo,
          advanceDate,
          supplierId: parsed.supplierId,
          userId: session.user.id,
          totalAmount: parsed.totalAmount,
          amountRemain: parsed.totalAmount,
          paymentMethod,
          note: parsed.note?.trim() || null,
          cashBankAccountId: parsed.cashBankAccountId,
        },
      });

      await replaceCashBankSourceMovements(
        tx,
        CashBankSourceType.SUPPLIER_ADVANCE,
        advance.id,
        [
          {
            accountId: parsed.cashBankAccountId,
            txnDate: advanceDate,
            direction: CashBankDirection.OUT,
            amount: parsed.totalAmount,
            referenceNo: advanceNo,
            note: parsed.note?.trim() || null,
          },
        ],
      );
    });

    revalidatePath("/admin/supplier-advances");
    revalidatePath("/admin/cash-bank");
    revalidatePath("/admin/reports");
    return { success: true, advanceNo };
  } catch (error) {
    console.error("[createSupplierAdvance]", error);
    return {
      success: false,
      error: "เกิดข้อผิดพลาด ไม่สามารถบันทึกเงินมัดจำซัพพลายเออร์ได้",
    };
  }
}

export async function updateSupplierAdvance(
  id: string,
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("supplier_advances.update").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const existing = await db.supplierAdvance.findUnique({
    where: { id },
    select: {
      id: true,
      advanceNo: true,
      status: true,
    },
  });

  if (!existing) return { error: "ไม่พบเอกสาร" };
  if (existing.status === "CANCELLED") {
    return { error: "เอกสารถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้" };
  }

  const activeRefs = await getActiveSupplierPaymentRefs(id);
  if (activeRefs.length > 0) {
    return {
      error: `ไม่สามารถแก้ไขได้ เนื่องจากถูกใช้ในเอกสารจ่ายชำระ: ${activeRefs.join(", ")}`,
    };
  }

  let parsed: z.infer<typeof supplierAdvanceSchema>;
  try {
    parsed = supplierAdvanceSchema.parse({
      supplierId: formData.get("supplierId"),
      advanceDate: formData.get("advanceDate"),
      totalAmount: formData.get("totalAmount"),
      cashBankAccountId: formData.get("cashBankAccountId"),
      note: formData.get("note") || undefined,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
    }
    return { error: "ข้อมูลไม่ถูกต้อง" };
  }

  const advanceDate = new Date(parsed.advanceDate);

  try {
    await dbTx(async (tx) => {
      const paymentMethod = await resolveSupplierAdvancePaymentMethod(tx, parsed.cashBankAccountId);

      await tx.supplierAdvance.update({
        where: { id },
        data: {
          advanceDate,
          supplierId: parsed.supplierId,
          totalAmount: parsed.totalAmount,
          paymentMethod,
          note: parsed.note?.trim() || null,
          cashBankAccountId: parsed.cashBankAccountId,
        },
      });

      // Recalculate amountRemain from active SupplierPayment usages instead of
      // blindly resetting to totalAmount (which would erase existing applications)
      await recalculateSupplierAdvanceAmountRemain(tx, id);

      await replaceCashBankSourceMovements(
        tx,
        CashBankSourceType.SUPPLIER_ADVANCE,
        id,
        [
          {
            accountId: parsed.cashBankAccountId,
            txnDate: advanceDate,
            direction: CashBankDirection.OUT,
            amount: parsed.totalAmount,
            referenceNo: existing.advanceNo,
            note: parsed.note?.trim() || null,
          },
        ],
      );
    });

    revalidatePath("/admin/supplier-advances");
    revalidatePath(`/admin/supplier-advances/${id}`);
    revalidatePath("/admin/cash-bank");
    revalidatePath("/admin/reports");
    return { success: true };
  } catch (error) {
    console.error("[updateSupplierAdvance]", error);
    return {
      error: "เกิดข้อผิดพลาด ไม่สามารถแก้ไขเงินมัดจำซัพพลายเออร์ได้",
    };
  }
}

const cancelSupplierAdvanceSchema = z.object({
  advanceId: z.string().min(1),
  cancelNote: z.string().max(200).optional(),
});

export async function cancelSupplierAdvance(
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("supplier_advances.cancel").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = cancelSupplierAdvanceSchema.safeParse({
    advanceId: formData.get("advanceId"),
    cancelNote: formData.get("cancelNote") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const advance = await db.supplierAdvance.findUnique({
    where: { id: parsed.data.advanceId },
    select: {
      id: true,
      status: true,
    },
  });

  if (!advance) return { error: "ไม่พบเอกสาร" };
  if (advance.status === "CANCELLED") return { error: "เอกสารถูกยกเลิกไปแล้ว" };

  const activeRefs = await getActiveSupplierPaymentRefs(advance.id);
  if (activeRefs.length > 0) {
    return {
      error: `ไม่สามารถยกเลิกได้ เนื่องจากถูกใช้ในเอกสารจ่ายชำระ: ${activeRefs.join(", ")}`,
    };
  }

  try {
    await dbTx(async (tx) => {
      await clearCashBankSourceMovements(tx, CashBankSourceType.SUPPLIER_ADVANCE, advance.id);
      await tx.supplierAdvance.update({
        where: { id: advance.id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelNote: parsed.data.cancelNote?.trim() || null,
          amountRemain: 0,
        },
      });
    });

    revalidatePath("/admin/supplier-advances");
    revalidatePath(`/admin/supplier-advances/${advance.id}`);
    revalidatePath("/admin/cash-bank");
    revalidatePath("/admin/reports");
    return { success: true };
  } catch (error) {
    console.error("[cancelSupplierAdvance]", error);
    return {
      error: "เกิดข้อผิดพลาด ไม่สามารถยกเลิกเงินมัดจำซัพพลายเออร์ได้",
    };
  }
}
