"use server";

import { db, dbTx } from "@/lib/db";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { generateReceiptNo } from "@/lib/doc-number";
import { PaymentMethod } from "@/lib/generated/prisma";
import { recalculateSaleAmountRemain } from "@/lib/amount-remain";

// ─────────────────────────────────────────
// getCreditSalesForCustomer
// ─────────────────────────────────────────

export interface CreditSaleItem {
  id: string;
  saleNo: string;
  saleDate: string;
  netAmount: number;
  paidAmount: number;
  outstanding: number;
}

export async function getCreditSalesForCustomer(customerId: string): Promise<CreditSaleItem[]> {
  const session = await auth();
  if (!session?.user?.id) return [];

  if (!customerId) return [];

  const sales = await db.sale.findMany({
    where: { customerId, paymentType: "CREDIT_SALE", status: "ACTIVE" },
    orderBy: { saleDate: "asc" },
    select: {
      id:        true,
      saleNo:    true,
      saleDate:  true,
      netAmount: true,
      receipts:  {
        where:  { receipt: { status: "ACTIVE" } },
        select: { paidAmount: true },
      },
    },
  });

  return sales
    .map((s) => {
      const paid        = s.receipts.reduce((sum, r) => sum + Number(r.paidAmount), 0);
      const outstanding = Math.max(0, Number(s.netAmount) - paid);
      return {
        id:          s.id,
        saleNo:      s.saleNo,
        saleDate:    s.saleDate.toISOString(),
        netAmount:   Number(s.netAmount),
        paidAmount:  paid,
        outstanding,
      };
    })
    .filter((s) => s.outstanding > 0);
}

// ─────────────────────────────────────────
// createReceipt
// ─────────────────────────────────────────

const receiptItemSchema = z.object({
  saleId:     z.string().min(1),
  paidAmount: z.coerce.number().positive(),
});

const receiptSchema = z.object({
  customerId:    z.string().optional(),
  customerName:  z.string().max(100).optional(),
  receiptDate:   z.string().min(1),
  paymentMethod: z.nativeEnum(PaymentMethod),
  note:          z.string().max(500).optional(),
  items:         z.array(receiptItemSchema).min(1, "ต้องมีรายการชำระอย่างน้อย 1 รายการ"),
});

export async function createReceipt(
  formData: FormData,
): Promise<{ success: boolean; receiptNo?: string; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "กรุณาเข้าสู่ระบบก่อน" };
  }

  let parsed: z.infer<typeof receiptSchema>;
  try {
    const raw = {
      customerId:    formData.get("customerId") ?? undefined,
      customerName:  formData.get("customerName") ?? undefined,
      receiptDate:   formData.get("receiptDate"),
      paymentMethod: formData.get("paymentMethod"),
      note:          formData.get("note") ?? undefined,
      items:         JSON.parse((formData.get("items") as string) ?? "[]"),
    };
    parsed = receiptSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issues = err.issues;
      return { success: false, error: issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
    }
    return { success: false, error: "ข้อมูลไม่ถูกต้อง" };
  }

  try {
    const docDate     = new Date(parsed.receiptDate);
    const receiptNo   = await generateReceiptNo(docDate);
    const totalAmount = parsed.items.reduce((sum, item) => sum + item.paidAmount, 0);

    await dbTx(async (tx) => {
      const receipt = await tx.receipt.create({
        data: {
          receiptNo,
          receiptDate:   docDate,
          customerId:    parsed.customerId || null,
          customerName:  parsed.customerName || null,
          userId:        session.user!.id,
          totalAmount,
          paymentMethod: parsed.paymentMethod,
          note:          parsed.note || null,
        },
      });

      await tx.receiptItem.createMany({
        data: parsed.items.map((item) => ({
          receiptId:  receipt.id,
          saleId:     item.saleId,
          paidAmount: item.paidAmount,
        })),
      });

      for (const item of parsed.items) {
        await recalculateSaleAmountRemain(tx, item.saleId);
      }
    });

    revalidatePath("/admin/receipts");
    revalidatePath("/admin/customers");

    return { success: true, receiptNo };
  } catch (err) {
    console.error("[createReceipt] error:", err);
    return { success: false, error: "เกิดข้อผิดพลาด ไม่สามารถบันทึกใบเสร็จได้" };
  }
}

const cancelReceiptSchema = z.object({
  receiptId:  z.string().min(1),
  cancelNote: z.string().max(200).optional(),
});

export async function cancelReceipt(
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = cancelReceiptSchema.safeParse({
    receiptId:  formData.get("receiptId"),
    cancelNote: formData.get("cancelNote") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { receiptId, cancelNote } = parsed.data;

  const receipt = await db.receipt.findUnique({
    where: { id: receiptId },
    include: { items: { select: { saleId: true } } },
  });
  if (!receipt)                        return { error: "ไม่พบเอกสาร" };
  if (receipt.status === "CANCELLED")  return { error: "เอกสารถูกยกเลิกไปแล้ว" };

  const affectedSaleIds = [...new Set(receipt.items.map((i) => i.saleId).filter((id): id is string => id !== null))];

  try {
    await dbTx(async (tx) => {
      await tx.receipt.update({
        where: { id: receiptId },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelNote },
      });
      for (const saleId of affectedSaleIds) {
        await recalculateSaleAmountRemain(tx, saleId);
      }
    });
    revalidatePath("/admin/receipts");
    return { success: true };
  } catch (err) {
    console.error("[cancelReceipt]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

// ─────────────────────────────────────────
// updateReceipt
// ─────────────────────────────────────────

export async function updateReceipt(
  id: string,
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสเอกสารไม่ถูกต้อง" };
  }

  const existing = await db.receipt.findUnique({
    where: { id },
    include: { items: { select: { saleId: true } } },
  });
  if (!existing)                       return { error: "ไม่พบเอกสาร" };
  if (existing.status === "CANCELLED") return { error: "เอกสารถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้" };

  let items: z.infer<typeof receiptItemSchema>[] = [];
  try {
    const raw = formData.get("items");
    if (typeof raw === "string") items = JSON.parse(raw);
  } catch { return { error: "รูปแบบข้อมูลรายการไม่ถูกต้อง" }; }

  let parsed: z.infer<typeof receiptSchema>;
  try {
    parsed = receiptSchema.parse({
      customerId:    formData.get("customerId") ?? undefined,
      customerName:  formData.get("customerName") ?? undefined,
      receiptDate:   formData.get("receiptDate"),
      paymentMethod: formData.get("paymentMethod"),
      note:          formData.get("note") ?? undefined,
      items,
    });
  } catch (err) {
    if (err instanceof z.ZodError) return { error: err.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
    return { error: "ข้อมูลไม่ถูกต้อง" };
  }

  const docDate     = new Date(parsed.receiptDate);
  const totalAmount = parsed.items.reduce((sum, item) => sum + item.paidAmount, 0);
  const oldSaleIds  = [...new Set(existing.items.map((i) => i.saleId).filter((sid): sid is string => sid !== null))];
  const newSaleIds  = [...new Set(parsed.items.map((i) => i.saleId))];
  const allSaleIds  = [...new Set([...oldSaleIds, ...newSaleIds])];

  try {
    await dbTx(async (tx) => {
      // 1. Delete old receipt items
      await tx.receiptItem.deleteMany({ where: { receiptId: id } });

      // 2. Update header
      await tx.receipt.update({
        where: { id },
        data: {
          receiptDate:   docDate,
          customerId:    parsed.customerId || null,
          customerName:  parsed.customerName || null,
          totalAmount,
          paymentMethod: parsed.paymentMethod,
          note:          parsed.note || null,
        },
      });

      // 3. Re-create receipt items
      await tx.receiptItem.createMany({
        data: parsed.items.map((item) => ({
          receiptId:  id,
          saleId:     item.saleId,
          paidAmount: item.paidAmount,
        })),
      });

      // 4. Recalculate amountRemain for all affected sales
      for (const saleId of allSaleIds) {
        await recalculateSaleAmountRemain(tx, saleId);
      }
    });

    revalidatePath("/admin/receipts");
    revalidatePath(`/admin/receipts/${id}`);
    revalidatePath("/admin/customers");
    return { success: true };
  } catch (err) {
    console.error("[updateReceipt]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
