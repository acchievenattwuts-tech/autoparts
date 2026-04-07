"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, dbTx } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { generateSupplierPaymentNo } from "@/lib/doc-number";
import {
  CashBankDirection,
  CashBankSourceType,
  PaymentMethod,
  Prisma,
  PurchaseReturnSettlementType,
  PurchaseType,
} from "@/lib/generated/prisma";
import {
  recalculatePurchaseAmountRemain,
  recalculatePurchaseReturnAmountRemain,
  recalculateSupplierAdvanceAmountRemain,
} from "@/lib/amount-remain";
import { clearCashBankSourceMovements, replaceCashBankSourceMovements } from "@/lib/cash-bank";

type TxClient = Prisma.TransactionClient;
type SupplierDocumentClient = Pick<
  typeof db,
  "purchase" | "purchaseReturn" | "supplierAdvance"
> &
  Pick<TxClient, "purchase" | "purchaseReturn" | "supplierAdvance">;

export type SupplierSettlementDocument = {
  id: string;
  docNo: string;
  docDate: string;
  totalAmount: number;
  usedAmount: number;
  outstanding: number;
  type: "PURCHASE" | "SUPPLIER_CREDIT" | "ADVANCE";
};

export type SupplierSettlementDocumentBundle = {
  purchases: SupplierSettlementDocument[];
  credits: SupplierSettlementDocument[];
  advances: SupplierSettlementDocument[];
};

type AvailableDocument = {
  id: string;
  docNo: string;
  docDate: Date;
  totalAmount: number;
  usedAmount: number;
  outstanding: number;
};

type AvailableDocumentBundle = {
  purchases: AvailableDocument[];
  credits: AvailableDocument[];
  advances: AvailableDocument[];
};

const supplierPaymentItemSchema = z
  .object({
    purchaseId: z.string().optional(),
    purchaseReturnId: z.string().optional(),
    advanceId: z.string().optional(),
    paidAmount: z.coerce.number().positive("ยอดที่นำมาชำระต้องมากกว่า 0"),
  })
  .superRefine((data, ctx) => {
    const refCount = [data.purchaseId, data.purchaseReturnId, data.advanceId].filter(Boolean).length;
    if (refCount !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "แต่ละรายการต้องอ้างอิงเอกสารได้เพียง 1 ประเภท",
      });
    }
  });

const supplierPaymentSchema = z.object({
  supplierId: z.string().min(1, "กรุณาเลือกซัพพลายเออร์"),
  paymentDate: z.string().min(1, "กรุณาระบุวันที่เอกสาร"),
  cashBankAccountId: z.string().optional(),
  note: z.string().max(500).optional(),
  items: z.array(supplierPaymentItemSchema).min(1, "กรุณาเลือกรายการที่ต้องการชำระอย่างน้อย 1 รายการ"),
});

type ParsedSupplierPayment = z.infer<typeof supplierPaymentSchema>;

function sumPaidAmount(items: Array<{ paidAmount: Prisma.Decimal | number }>): number {
  return items.reduce((sum, item) => sum + Number(item.paidAmount), 0);
}

async function resolveSupplierPaymentMethod(
  tx: TxClient,
  accountId: string | undefined,
  totalCashPaid: number,
): Promise<PaymentMethod> {
  if (totalCashPaid <= 0) return PaymentMethod.CREDIT;
  if (!accountId) throw new Error("กรุณาเลือกบัญชีจ่ายเงิน");

  const account = await tx.cashBankAccount.findUnique({
    where: { id: accountId },
    select: { type: true },
  });

  if (!account) throw new Error("ไม่พบบัญชีจ่ายเงิน");
  return account.type === "CASH" ? PaymentMethod.CASH : PaymentMethod.TRANSFER;
}

async function getAvailableSupplierDocuments(
  tx: SupplierDocumentClient,
  supplierId: string,
  excludePaymentId?: string,
): Promise<AvailableDocumentBundle> {
  const purchaseOr = [{ amountRemain: { gt: 0 } }] as Prisma.PurchaseWhereInput[];
  const creditOr = [{ amountRemain: { gt: 0 } }] as Prisma.PurchaseReturnWhereInput[];
  const advanceOr = [{ amountRemain: { gt: 0 } }] as Prisma.SupplierAdvanceWhereInput[];

  if (excludePaymentId) {
    purchaseOr.push({ supplierPaymentItems: { some: { paymentId: excludePaymentId } } });
    creditOr.push({ supplierPaymentItems: { some: { paymentId: excludePaymentId } } });
    advanceOr.push({ supplierPayments: { some: { paymentId: excludePaymentId } } });
  }

  const [purchases, credits, advances] = await Promise.all([
    tx.purchase.findMany({
      where: {
        supplierId,
        status: "ACTIVE",
        purchaseType: PurchaseType.CREDIT_PURCHASE,
        OR: purchaseOr,
      },
      orderBy: [{ purchaseDate: "asc" }, { purchaseNo: "asc" }],
      select: {
        id: true,
        purchaseNo: true,
        purchaseDate: true,
        netAmount: true,
        amountRemain: true,
        supplierPaymentItems: {
          where: { paymentId: excludePaymentId ?? "__never__" },
          select: { paidAmount: true },
        },
      },
    }),
    tx.purchaseReturn.findMany({
      where: {
        supplierId,
        status: "ACTIVE",
        settlementType: PurchaseReturnSettlementType.SUPPLIER_CREDIT,
        OR: creditOr,
      },
      orderBy: [{ returnDate: "asc" }, { returnNo: "asc" }],
      select: {
        id: true,
        returnNo: true,
        returnDate: true,
        totalAmount: true,
        amountRemain: true,
        supplierPaymentItems: {
          where: { paymentId: excludePaymentId ?? "__never__" },
          select: { paidAmount: true },
        },
      },
    }),
    tx.supplierAdvance.findMany({
      where: {
        supplierId,
        status: "ACTIVE",
        OR: advanceOr,
      },
      orderBy: [{ advanceDate: "asc" }, { advanceNo: "asc" }],
      select: {
        id: true,
        advanceNo: true,
        advanceDate: true,
        totalAmount: true,
        amountRemain: true,
        supplierPayments: {
          where: { paymentId: excludePaymentId ?? "__never__" },
          select: { paidAmount: true },
        },
      },
    }),
  ]);

  return {
    purchases: purchases.map((purchase) => {
      const currentUsage = sumPaidAmount(purchase.supplierPaymentItems);
      return {
        id: purchase.id,
        docNo: purchase.purchaseNo,
        docDate: purchase.purchaseDate,
        totalAmount: Number(purchase.netAmount),
        usedAmount: Number(purchase.netAmount) - Number(purchase.amountRemain) - currentUsage,
        outstanding: Number(purchase.amountRemain) + currentUsage,
      };
    }),
    credits: credits.map((credit) => {
      const currentUsage = sumPaidAmount(credit.supplierPaymentItems);
      return {
        id: credit.id,
        docNo: credit.returnNo,
        docDate: credit.returnDate,
        totalAmount: Number(credit.totalAmount),
        usedAmount: Number(credit.totalAmount) - Number(credit.amountRemain) - currentUsage,
        outstanding: Number(credit.amountRemain) + currentUsage,
      };
    }),
    advances: advances.map((advance) => {
      const currentUsage = sumPaidAmount(advance.supplierPayments);
      return {
        id: advance.id,
        docNo: advance.advanceNo,
        docDate: advance.advanceDate,
        totalAmount: Number(advance.totalAmount),
        usedAmount: Number(advance.totalAmount) - Number(advance.amountRemain) - currentUsage,
        outstanding: Number(advance.amountRemain) + currentUsage,
      };
    }),
  };
}

function serializeDocuments(bundle: AvailableDocumentBundle): SupplierSettlementDocumentBundle {
  return {
    purchases: bundle.purchases.map((item) => ({ ...item, docDate: item.docDate.toISOString(), type: "PURCHASE" })),
    credits: bundle.credits.map((item) => ({ ...item, docDate: item.docDate.toISOString(), type: "SUPPLIER_CREDIT" })),
    advances: bundle.advances.map((item) => ({ ...item, docDate: item.docDate.toISOString(), type: "ADVANCE" })),
  };
}

function parseSupplierPaymentForm(
  formData: FormData,
): { success: true; data: ParsedSupplierPayment } | { success: false; error: string } {
  try {
    const parsed = supplierPaymentSchema.parse({
      supplierId: formData.get("supplierId"),
      paymentDate: formData.get("paymentDate"),
      cashBankAccountId: formData.get("cashBankAccountId") || undefined,
      note: formData.get("note") || undefined,
      items: JSON.parse((formData.get("items") as string) ?? "[]"),
    });
    return { success: true, data: parsed };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
    }
    return { success: false, error: "ข้อมูลไม่ถูกต้อง" };
  }
}

function calculateCashPaid(items: ParsedSupplierPayment["items"]): number {
  return items.reduce((sum, item) => {
    if (item.purchaseId) return sum + item.paidAmount;
    return sum - item.paidAmount;
  }, 0);
}

function collectAffectedIds(items: Array<{
  purchaseId?: string | null | undefined;
  purchaseReturnId?: string | null | undefined;
  advanceId?: string | null | undefined;
}>): {
  purchaseIds: string[];
  purchaseReturnIds: string[];
  advanceIds: string[];
} {
  return {
    purchaseIds: [...new Set(items.map((item) => item.purchaseId).filter((id): id is string => !!id))],
    purchaseReturnIds: [
      ...new Set(items.map((item) => item.purchaseReturnId).filter((id): id is string => !!id)),
    ],
    advanceIds: [...new Set(items.map((item) => item.advanceId).filter((id): id is string => !!id))],
  };
}

function validatePaymentItemsAgainstAvailable(
  items: ParsedSupplierPayment["items"],
  available: AvailableDocumentBundle,
): string | null {
  const purchaseMap = new Map(available.purchases.map((item) => [item.id, item]));
  const creditMap = new Map(available.credits.map((item) => [item.id, item]));
  const advanceMap = new Map(available.advances.map((item) => [item.id, item]));
  const usedMap = new Map<string, number>();

  const registerAmount = (key: string, amount: number): number => {
    const nextAmount = (usedMap.get(key) ?? 0) + amount;
    usedMap.set(key, nextAmount);
    return nextAmount;
  };

  for (const item of items) {
    if (item.purchaseId) {
      const purchase = purchaseMap.get(item.purchaseId);
      if (!purchase) return "พบเอกสารซื้อเชื่อที่เลือกไม่ถูกต้องหรือไม่สามารถใช้งานได้แล้ว";
      if (registerAmount(`purchase:${item.purchaseId}`, item.paidAmount) > purchase.outstanding + 0.0001) {
        return `ยอดชำระของ ${purchase.docNo} มากกว่ายอดคงเหลือที่ใช้ได้`;
      }
      continue;
    }

    if (item.purchaseReturnId) {
      const credit = creditMap.get(item.purchaseReturnId);
      if (!credit) return "พบเอกสารเครดิตซัพพลายเออร์ที่เลือกไม่ถูกต้องหรือไม่สามารถใช้งานได้แล้ว";
      if (registerAmount(`credit:${item.purchaseReturnId}`, item.paidAmount) > credit.outstanding + 0.0001) {
        return `ยอดที่นำเครดิต ${credit.docNo} มาใช้ มากกว่ายอดคงเหลือที่ใช้ได้`;
      }
      continue;
    }

    if (item.advanceId) {
      const advance = advanceMap.get(item.advanceId);
      if (!advance) return "พบเอกสารเงินมัดจำซัพพลายเออร์ที่เลือกไม่ถูกต้องหรือไม่สามารถใช้งานได้แล้ว";
      if (registerAmount(`advance:${item.advanceId}`, item.paidAmount) > advance.outstanding + 0.0001) {
        return `ยอดที่นำมัดจำ ${advance.docNo} มาใช้ มากกว่ายอดคงเหลือที่ใช้ได้`;
      }
    }
  }

  if (!items.some((item) => !!item.purchaseId)) {
    return "กรุณาเลือกใบซื้อเชื่ออย่างน้อย 1 รายการ";
  }

  return null;
}

async function recalculateAffectedDocuments(
  tx: TxClient,
  affectedIds: ReturnType<typeof collectAffectedIds>,
): Promise<void> {
  for (const purchaseId of affectedIds.purchaseIds) {
    await recalculatePurchaseAmountRemain(tx, purchaseId);
  }
  for (const purchaseReturnId of affectedIds.purchaseReturnIds) {
    await recalculatePurchaseReturnAmountRemain(tx, purchaseReturnId);
  }
  for (const advanceId of affectedIds.advanceIds) {
    await recalculateSupplierAdvanceAmountRemain(tx, advanceId);
  }
}

export async function getOutstandingSupplierDocuments(
  supplierId: string,
  excludePaymentId?: string,
): Promise<SupplierSettlementDocumentBundle> {
  const session = await requirePermission("supplier_payments.view").catch(() => null);
  if (!session?.user?.id || !supplierId) {
    return { purchases: [], credits: [], advances: [] };
  }

  const available = await getAvailableSupplierDocuments(db, supplierId, excludePaymentId);
  return serializeDocuments(available);
}

export async function createSupplierPayment(
  formData: FormData,
): Promise<{ success: boolean; paymentNo?: string; error?: string }> {
  const session = await requirePermission("supplier_payments.create").catch(() => null);
  if (!session?.user?.id) return { success: false, error: "กรุณาเข้าสู่ระบบก่อน" };

  const parsedResult = parseSupplierPaymentForm(formData);
  if (!parsedResult.success) return { success: false, error: parsedResult.error };
  const parsed = parsedResult.data;

  const totalCashPaid = calculateCashPaid(parsed.items);
  if (totalCashPaid < 0) {
    return { success: false, error: "ยอดเครดิตและเงินมัดจำที่เลือกมากกว่ายอดซื้อเชื่อที่ต้องการชำระ" };
  }
  if (totalCashPaid > 0 && !parsed.cashBankAccountId) {
    return { success: false, error: "กรุณาเลือกบัญชีจ่ายเงิน" };
  }

  const paymentDate = new Date(parsed.paymentDate);
  const paymentNo = await generateSupplierPaymentNo(paymentDate);

  try {
    await dbTx(async (tx) => {
      const available = await getAvailableSupplierDocuments(tx, parsed.supplierId);
      const validationError = validatePaymentItemsAgainstAvailable(parsed.items, available);
      if (validationError) throw new Error(validationError);

      const paymentMethod = await resolveSupplierPaymentMethod(tx, parsed.cashBankAccountId, totalCashPaid);
      const payment = await tx.supplierPayment.create({
        data: {
          paymentNo,
          paymentDate,
          supplierId: parsed.supplierId,
          userId: session.user.id,
          totalAmount: totalCashPaid,
          paymentMethod,
          note: parsed.note?.trim() || null,
          cashBankAccountId: totalCashPaid > 0 ? parsed.cashBankAccountId ?? null : null,
        },
      });

      await tx.supplierPaymentItem.createMany({
        data: parsed.items.map((item) => ({
          paymentId: payment.id,
          purchaseId: item.purchaseId ?? null,
          purchaseReturnId: item.purchaseReturnId ?? null,
          advanceId: item.advanceId ?? null,
          paidAmount: item.paidAmount,
        })),
      });

      await recalculateAffectedDocuments(tx, collectAffectedIds(parsed.items));
      await replaceCashBankSourceMovements(
        tx,
        CashBankSourceType.SUPPLIER_PAYMENT,
        payment.id,
        totalCashPaid > 0 && parsed.cashBankAccountId
          ? [
              {
                accountId: parsed.cashBankAccountId,
                txnDate: paymentDate,
                direction: CashBankDirection.OUT,
                amount: totalCashPaid,
                referenceNo: paymentNo,
                note: parsed.note?.trim() || null,
              },
            ]
          : [],
      );
    });

    revalidatePath("/admin/supplier-payments");
    revalidatePath("/admin/purchases");
    revalidatePath("/admin/purchase-returns");
    revalidatePath("/admin/supplier-advances");
    revalidatePath("/admin/cash-bank");
    revalidatePath("/admin/reports");
    return { success: true, paymentNo };
  } catch (error) {
    console.error("[createSupplierPayment]", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "เกิดข้อผิดพลาด ไม่สามารถบันทึกเอกสารจ่ายชำระซัพพลายเออร์ได้",
    };
  }
}

export async function updateSupplierPayment(
  id: string,
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("supplier_payments.update").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const existing = await db.supplierPayment.findUnique({
    where: { id },
    select: {
      id: true,
      paymentNo: true,
      status: true,
      items: {
        select: {
          purchaseId: true,
          purchaseReturnId: true,
          advanceId: true,
        },
      },
    },
  });

  if (!existing) return { error: "ไม่พบเอกสาร" };
  if (existing.status === "CANCELLED") return { error: "เอกสารถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้" };

  const parsedResult = parseSupplierPaymentForm(formData);
  if (!parsedResult.success) return { error: parsedResult.error };
  const parsed = parsedResult.data;

  const totalCashPaid = calculateCashPaid(parsed.items);
  if (totalCashPaid < 0) {
    return { error: "ยอดเครดิตและเงินมัดจำที่เลือกมากกว่ายอดซื้อเชื่อที่ต้องการชำระ" };
  }
  if (totalCashPaid > 0 && !parsed.cashBankAccountId) {
    return { error: "กรุณาเลือกบัญชีจ่ายเงิน" };
  }

  const oldAffectedIds = collectAffectedIds(existing.items);
  const newAffectedIds = collectAffectedIds(parsed.items);
  const allAffectedIds = {
    purchaseIds: [...new Set([...oldAffectedIds.purchaseIds, ...newAffectedIds.purchaseIds])],
    purchaseReturnIds: [...new Set([...oldAffectedIds.purchaseReturnIds, ...newAffectedIds.purchaseReturnIds])],
    advanceIds: [...new Set([...oldAffectedIds.advanceIds, ...newAffectedIds.advanceIds])],
  };

  try {
    await dbTx(async (tx) => {
      const available = await getAvailableSupplierDocuments(tx, parsed.supplierId, id);
      const validationError = validatePaymentItemsAgainstAvailable(parsed.items, available);
      if (validationError) throw new Error(validationError);

      const paymentMethod = await resolveSupplierPaymentMethod(tx, parsed.cashBankAccountId, totalCashPaid);

      await tx.supplierPaymentItem.deleteMany({ where: { paymentId: id } });
      await tx.supplierPayment.update({
        where: { id },
        data: {
          paymentDate: new Date(parsed.paymentDate),
          supplierId: parsed.supplierId,
          totalAmount: totalCashPaid,
          paymentMethod,
          note: parsed.note?.trim() || null,
          cashBankAccountId: totalCashPaid > 0 ? parsed.cashBankAccountId ?? null : null,
        },
      });

      await tx.supplierPaymentItem.createMany({
        data: parsed.items.map((item) => ({
          paymentId: id,
          purchaseId: item.purchaseId ?? null,
          purchaseReturnId: item.purchaseReturnId ?? null,
          advanceId: item.advanceId ?? null,
          paidAmount: item.paidAmount,
        })),
      });

      await recalculateAffectedDocuments(tx, allAffectedIds);
      await replaceCashBankSourceMovements(
        tx,
        CashBankSourceType.SUPPLIER_PAYMENT,
        id,
        totalCashPaid > 0 && parsed.cashBankAccountId
          ? [
              {
                accountId: parsed.cashBankAccountId,
                txnDate: new Date(parsed.paymentDate),
                direction: CashBankDirection.OUT,
                amount: totalCashPaid,
                referenceNo: existing.paymentNo,
                note: parsed.note?.trim() || null,
              },
            ]
          : [],
      );
    });

    revalidatePath("/admin/supplier-payments");
    revalidatePath(`/admin/supplier-payments/${id}`);
    revalidatePath("/admin/purchases");
    revalidatePath("/admin/purchase-returns");
    revalidatePath("/admin/supplier-advances");
    revalidatePath("/admin/cash-bank");
    revalidatePath("/admin/reports");
    return { success: true };
  } catch (error) {
    console.error("[updateSupplierPayment]", error);
    return {
      error: error instanceof Error ? error.message : "เกิดข้อผิดพลาด ไม่สามารถแก้ไขเอกสารจ่ายชำระซัพพลายเออร์ได้",
    };
  }
}

const cancelSupplierPaymentSchema = z.object({
  paymentId: z.string().min(1),
  cancelNote: z.string().max(200).optional(),
});

export async function cancelSupplierPayment(
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("supplier_payments.cancel").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = cancelSupplierPaymentSchema.safeParse({
    paymentId: formData.get("paymentId"),
    cancelNote: formData.get("cancelNote") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const payment = await db.supplierPayment.findUnique({
    where: { id: parsed.data.paymentId },
    select: {
      id: true,
      status: true,
      items: {
        select: {
          purchaseId: true,
          purchaseReturnId: true,
          advanceId: true,
        },
      },
    },
  });

  if (!payment) return { error: "ไม่พบเอกสาร" };
  if (payment.status === "CANCELLED") return { error: "เอกสารถูกยกเลิกไปแล้ว" };

  try {
    await dbTx(async (tx) => {
      await clearCashBankSourceMovements(tx, CashBankSourceType.SUPPLIER_PAYMENT, payment.id);
      await tx.supplierPayment.update({
        where: { id: payment.id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelNote: parsed.data.cancelNote?.trim() || null,
        },
      });
      await recalculateAffectedDocuments(tx, collectAffectedIds(payment.items));
    });

    revalidatePath("/admin/supplier-payments");
    revalidatePath(`/admin/supplier-payments/${payment.id}`);
    revalidatePath("/admin/purchases");
    revalidatePath("/admin/purchase-returns");
    revalidatePath("/admin/supplier-advances");
    revalidatePath("/admin/cash-bank");
    revalidatePath("/admin/reports");
    return { success: true };
  } catch (error) {
    console.error("[cancelSupplierPayment]", error);
    return { error: "เกิดข้อผิดพลาด ไม่สามารถยกเลิกเอกสารจ่ายชำระซัพพลายเออร์ได้" };
  }
}
