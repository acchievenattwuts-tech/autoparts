"use server";

import { db, dbTx } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { generateReceiptNo } from "@/lib/doc-number";
import { PaymentMethod } from "@/lib/generated/prisma";
import { recalculateSaleAmountRemain, recalculateCNAmountRemain } from "@/lib/amount-remain";
import { CashBankDirection, CashBankSourceType } from "@/lib/generated/prisma";
import { clearCashBankSourceMovements, replaceCashBankSourceMovements } from "@/lib/cash-bank";

// ─────────────────────────────────────────
// getCreditSalesForCustomer
// ─────────────────────────────────────────

export interface CreditSaleItem {
  id:          string;
  saleNo:      string;  // saleNo for SALE type, cnNo for CN type
  saleDate:    string;  // saleDate or cnDate (ISO)
  netAmount:   number;  // netAmount (SALE) or totalAmount (CN)
  paidAmount:  number;  // amount already collected/applied
  outstanding: number;  // amountRemain
  type:        "SALE" | "CN";
}

export async function getCreditSalesForCustomer(customerId: string): Promise<CreditSaleItem[]> {
  const session = await requirePermission("receipts.view").catch(() => null);
  if (!session?.user?.id) return [];

  if (!customerId) return [];

  const [sales, creditNotes] = await Promise.all([
    // Outstanding credit sales
    db.sale.findMany({
      where: {
        customerId,
        paymentType:  "CREDIT_SALE",
        status:       "ACTIVE",
        amountRemain: { gt: 0 },
      },
      orderBy: { saleDate: "asc" },
      select: {
        id:           true,
        saleNo:       true,
        saleDate:     true,
        netAmount:    true,
        amountRemain: true,
      },
    }),
    // Unused CREDIT_DEBT credit notes (these are credits the customer can apply)
    db.creditNote.findMany({
      where: {
        customerId,
        settlementType: "CREDIT_DEBT",
        status:         "ACTIVE",
        amountRemain:   { gt: 0 },
      },
      orderBy: { cnDate: "asc" },
      select: {
        id:           true,
        cnNo:         true,
        cnDate:       true,
        totalAmount:  true,
        amountRemain: true,
      },
    }),
  ]);

  const saleItems: CreditSaleItem[] = sales.map((s) => ({
    id:          s.id,
    saleNo:      s.saleNo,
    saleDate:    s.saleDate.toISOString(),
    netAmount:   Number(s.netAmount),
    paidAmount:  Number(s.netAmount) - Number(s.amountRemain),
    outstanding: Number(s.amountRemain),
    type:        "SALE",
  }));

  const cnItems: CreditSaleItem[] = creditNotes.map((cn) => ({
    id:          cn.id,
    saleNo:      cn.cnNo,
    saleDate:    cn.cnDate.toISOString(),
    netAmount:   Number(cn.totalAmount),
    paidAmount:  Number(cn.totalAmount) - Number(cn.amountRemain),
    outstanding: Number(cn.amountRemain),
    type:        "CN",
  }));

  return [...saleItems, ...cnItems];
}

// ─────────────────────────────────────────
// createReceipt
// ─────────────────────────────────────────

const receiptItemSchema = z.object({
  saleId:     z.string().optional(),
  cnId:       z.string().optional(),
  paidAmount: z.coerce.number().positive(),
}).refine((data) => !!(data.saleId || data.cnId), {
  message: "แต่ละรายการต้องมี saleId หรือ cnId",
});

const receiptSchema = z.object({
  customerId:    z.string().optional(),
  customerName:  z.string().max(100).optional(),
  receiptDate:   z.string().min(1),
  paymentMethod: z.nativeEnum(PaymentMethod).optional(),
  cashBankAccountId: z.string().optional(),
  note:          z.string().max(500).optional(),
  items:         z.array(receiptItemSchema).min(1, "ต้องมีรายการชำระอย่างน้อย 1 รายการ"),
});

async function resolveReceiptPaymentMethod(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  accountId: string | undefined,
  totalAmount: number,
): Promise<PaymentMethod> {
  if (!accountId) {
    return totalAmount > 0 ? PaymentMethod.TRANSFER : PaymentMethod.CREDIT;
  }

  const account = await tx.cashBankAccount.findUnique({
    where: { id: accountId },
    select: { type: true },
  });
  if (!account) {
    throw new Error("ไม่พบบัญชีรับเงิน");
  }

  return account.type === "CASH" ? PaymentMethod.CASH : PaymentMethod.TRANSFER;
}

export async function createReceipt(
  formData: FormData,
): Promise<{ success: boolean; receiptNo?: string; error?: string }> {
  const session = await requirePermission("receipts.create").catch(() => null);
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
      cashBankAccountId: formData.get("cashBankAccountId") ?? undefined,
      note:          formData.get("note") ?? undefined,
      items:         JSON.parse((formData.get("items") as string) ?? "[]"),
    };
    parsed = receiptSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { success: false, error: err.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
    }
    return { success: false, error: "ข้อมูลไม่ถูกต้อง" };
  }

  try {
    const docDate   = new Date(parsed.receiptDate);
    const receiptNo = await generateReceiptNo(docDate);

    // Sale items add to total; CN items are credits that reduce the total
    const totalAmount = parsed.items.reduce((sum, item) => {
      return item.cnId ? sum - item.paidAmount : sum + item.paidAmount;
    }, 0);
    if (totalAmount > 0 && !parsed.cashBankAccountId) {
      return { success: false, error: "กรุณาเลือกบัญชีรับเงิน" };
    }

    const resolvedCashBankAccountId = totalAmount > 0 ? parsed.cashBankAccountId : undefined;
    const affectedSaleIds = [...new Set(parsed.items.map((i) => i.saleId).filter((id): id is string => !!id))];
    const affectedCnIds   = [...new Set(parsed.items.map((i) => i.cnId).filter((id): id is string => !!id))];

    await dbTx(async (tx) => {
      const resolvedPaymentMethod = await resolveReceiptPaymentMethod(
        tx,
        resolvedCashBankAccountId,
        totalAmount,
      );

      const receipt = await tx.receipt.create({
        data: {
          receiptNo,
          receiptDate:   docDate,
          customerId:    parsed.customerId || null,
          customerName:  parsed.customerName || null,
          userId:        session.user!.id,
          totalAmount,
          paymentMethod: resolvedPaymentMethod,
          cashBankAccountId: resolvedCashBankAccountId || null,
          note:          parsed.note || null,
        },
      });

      await tx.receiptItem.createMany({
        data: parsed.items.map((item) => ({
          receiptId:  receipt.id,
          saleId:     item.saleId ?? null,
          cnId:       item.cnId ?? null,
          paidAmount: item.paidAmount,
        })),
      });

      for (const saleId of affectedSaleIds) {
        await recalculateSaleAmountRemain(tx, saleId);
      }
      for (const cnId of affectedCnIds) {
        await recalculateCNAmountRemain(tx, cnId);
      }

      await replaceCashBankSourceMovements(
        tx,
        CashBankSourceType.RECEIPT,
        receipt.id,
        totalAmount > 0 && resolvedCashBankAccountId
          ? [{
              accountId: resolvedCashBankAccountId,
              txnDate: docDate,
              direction: CashBankDirection.IN,
              amount: totalAmount,
              referenceNo: receiptNo,
              note: parsed.note || null,
            }]
          : [],
      );
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
  const session = await requirePermission("receipts.cancel").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = cancelReceiptSchema.safeParse({
    receiptId:  formData.get("receiptId"),
    cancelNote: formData.get("cancelNote") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { receiptId, cancelNote } = parsed.data;

  const receipt = await db.receipt.findUnique({
    where: { id: receiptId },
    include: { items: { select: { saleId: true, cnId: true } } },
  });
  if (!receipt)                        return { error: "ไม่พบเอกสาร" };
  if (receipt.status === "CANCELLED")  return { error: "เอกสารถูกยกเลิกไปแล้ว" };

  const affectedSaleIds = [...new Set(receipt.items.map((i) => i.saleId).filter((id): id is string => id !== null))];
  const affectedCnIds   = [...new Set(receipt.items.map((i) => i.cnId).filter((id): id is string => id !== null))];

  try {
    await dbTx(async (tx) => {
      await clearCashBankSourceMovements(tx, CashBankSourceType.RECEIPT, receiptId);
      await tx.receipt.update({
        where: { id: receiptId },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelNote },
      });
      for (const saleId of affectedSaleIds) {
        await recalculateSaleAmountRemain(tx, saleId);
      }
      for (const cnId of affectedCnIds) {
        await recalculateCNAmountRemain(tx, cnId);
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
  const session = await requirePermission("receipts.update").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสเอกสารไม่ถูกต้อง" };
  }

  const existing = await db.receipt.findUnique({
    where: { id },
    include: { items: { select: { saleId: true, cnId: true } } },
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
      cashBankAccountId: formData.get("cashBankAccountId") ?? undefined,
      note:          formData.get("note") ?? undefined,
      items,
    });
  } catch (err) {
    if (err instanceof z.ZodError) return { error: err.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
    return { error: "ข้อมูลไม่ถูกต้อง" };
  }

  const docDate     = new Date(parsed.receiptDate);
  const totalAmount = parsed.items.reduce((sum, item) => {
    return item.cnId ? sum - item.paidAmount : sum + item.paidAmount;
  }, 0);
  if (totalAmount > 0 && !parsed.cashBankAccountId) {
    return { error: "กรุณาเลือกบัญชีรับเงิน" };
  }

  const resolvedCashBankAccountId = totalAmount > 0 ? parsed.cashBankAccountId : undefined;
  const oldSaleIds = [...new Set(existing.items.map((i) => i.saleId).filter((s): s is string => s !== null))];
  const oldCnIds   = [...new Set(existing.items.map((i) => i.cnId).filter((s): s is string => s !== null))];
  const newSaleIds = [...new Set(parsed.items.map((i) => i.saleId).filter((s): s is string => !!s))];
  const newCnIds   = [...new Set(parsed.items.map((i) => i.cnId).filter((s): s is string => !!s))];
  const allSaleIds = [...new Set([...oldSaleIds, ...newSaleIds])];
  const allCnIds   = [...new Set([...oldCnIds, ...newCnIds])];

  try {
    await dbTx(async (tx) => {
      const resolvedPaymentMethod = await resolveReceiptPaymentMethod(
        tx,
        resolvedCashBankAccountId,
        totalAmount,
      );

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
          paymentMethod: resolvedPaymentMethod,
          cashBankAccountId: resolvedCashBankAccountId || null,
          note:          parsed.note || null,
        },
      });

      // 3. Re-create receipt items
      await tx.receiptItem.createMany({
        data: parsed.items.map((item) => ({
          receiptId:  id,
          saleId:     item.saleId ?? null,
          cnId:       item.cnId ?? null,
          paidAmount: item.paidAmount,
        })),
      });

      // 4. Recalculate amountRemain for all affected sales and CNs
      for (const saleId of allSaleIds) {
        await recalculateSaleAmountRemain(tx, saleId);
      }
      for (const cnId of allCnIds) {
        await recalculateCNAmountRemain(tx, cnId);
      }

      await replaceCashBankSourceMovements(
        tx,
        CashBankSourceType.RECEIPT,
        id,
        totalAmount > 0 && resolvedCashBankAccountId
          ? [{
              accountId: resolvedCashBankAccountId,
              txnDate: docDate,
              direction: CashBankDirection.IN,
              amount: totalAmount,
              referenceNo: existing.receiptNo,
              note: parsed.note || null,
            }]
          : [],
      );
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
