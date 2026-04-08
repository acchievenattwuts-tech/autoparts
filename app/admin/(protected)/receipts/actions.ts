"use server";

import { db, dbTx } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { generateReceiptNo } from "@/lib/doc-number";
import { PaymentMethod, Prisma } from "@/lib/generated/prisma";
import { recalculateSaleAmountRemain, recalculateCNAmountRemain } from "@/lib/amount-remain";
import { CashBankDirection, CashBankSourceType } from "@/lib/generated/prisma";
import { clearCashBankSourceMovements, replaceCashBankSourceMovements } from "@/lib/cash-bank";
import {
  getAvailableReceiptDocuments as getAvailableReceiptDocumentsForAR,
  validateReceiptItemsAgainstAvailable as validateReceiptItemsAgainstAvailableForAR,
} from "@/lib/ar-settlement";

type TxClient = Prisma.TransactionClient;
type ReceiptDocumentClient = Pick<typeof db, "sale" | "creditNote"> &
  Pick<TxClient, "sale" | "creditNote">;

type AvailableReceiptDocument = {
  id: string;
  docNo: string;
  docDate: Date;
  totalAmount: number;
  usedAmount: number;
  outstanding: number;
};

type AvailableReceiptDocumentBundle = {
  sales: AvailableReceiptDocument[];
  creditNotes: AvailableReceiptDocument[];
};

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

const receiptItemSchema = z
  .object({
    saleId: z.string().optional(),
    cnId: z.string().optional(),
    paidAmount: z.coerce.number().positive("ยอดที่รับชำระต้องมากกว่า 0"),
  })
  .superRefine((data, ctx) => {
    const refCount = [data.saleId, data.cnId].filter(Boolean).length;
    if (refCount !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "แต่ละรายการต้องอ้างอิงเอกสารได้เพียง 1 ประเภท",
      });
    }
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

type ParsedReceipt = z.infer<typeof receiptSchema>;

function sumReceiptUsage(items: Array<{ paidAmount: Prisma.Decimal | number }>): number {
  return items.reduce((sum, item) => sum + Number(item.paidAmount), 0);
}

function parseReceiptForm(
  formData: FormData,
): { success: true; data: ParsedReceipt } | { success: false; error: string } {
  try {
    const parsed = receiptSchema.parse({
      customerId: formData.get("customerId") ?? undefined,
      customerName: formData.get("customerName") ?? undefined,
      receiptDate: formData.get("receiptDate"),
      paymentMethod: formData.get("paymentMethod") ?? undefined,
      cashBankAccountId: formData.get("cashBankAccountId") ?? undefined,
      note: formData.get("note") ?? undefined,
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

function calculateReceiptTotalAmount(items: ParsedReceipt["items"]): number {
  return items.reduce((sum, item) => {
    if (item.cnId) return sum - item.paidAmount;
    return sum + item.paidAmount;
  }, 0);
}

function collectAffectedReceiptIds(items: Array<{
  saleId?: string | null | undefined;
  cnId?: string | null | undefined;
}>): { saleIds: string[]; cnIds: string[] } {
  return {
    saleIds: [...new Set(items.map((item) => item.saleId).filter((id): id is string => !!id))],
    cnIds: [...new Set(items.map((item) => item.cnId).filter((id): id is string => !!id))],
  };
}

async function getAvailableReceiptDocuments(
  tx: ReceiptDocumentClient,
  customerId: string,
  excludeReceiptId?: string,
): Promise<AvailableReceiptDocumentBundle> {
  const saleOr = [{ amountRemain: { gt: 0 } }] as Prisma.SaleWhereInput[];
  const cnOr = [{ amountRemain: { gt: 0 } }] as Prisma.CreditNoteWhereInput[];

  if (excludeReceiptId) {
    saleOr.push({ receipts: { some: { receiptId: excludeReceiptId } } });
    cnOr.push({ receiptItems: { some: { receiptId: excludeReceiptId } } });
  }

  const [sales, creditNotes] = await Promise.all([
    tx.sale.findMany({
      where: {
        customerId,
        paymentType: "CREDIT_SALE",
        status: "ACTIVE",
        OR: saleOr,
      },
      orderBy: [{ saleDate: "asc" }, { saleNo: "asc" }],
      select: {
        id: true,
        saleNo: true,
        saleDate: true,
        netAmount: true,
        amountRemain: true,
        receipts: {
          where: { receiptId: excludeReceiptId ?? "__never__" },
          select: { paidAmount: true },
        },
      },
    }),
    tx.creditNote.findMany({
      where: {
        customerId,
        settlementType: "CREDIT_DEBT",
        status: "ACTIVE",
        OR: cnOr,
      },
      orderBy: [{ cnDate: "asc" }, { cnNo: "asc" }],
      select: {
        id: true,
        cnNo: true,
        cnDate: true,
        totalAmount: true,
        amountRemain: true,
        receiptItems: {
          where: { receiptId: excludeReceiptId ?? "__never__" },
          select: { paidAmount: true },
        },
      },
    }),
  ]);

  return {
    sales: sales.map((sale) => {
      const currentUsage = sumReceiptUsage(sale.receipts);
      return {
        id: sale.id,
        docNo: sale.saleNo,
        docDate: sale.saleDate,
        totalAmount: Number(sale.netAmount),
        usedAmount: Number(sale.netAmount) - Number(sale.amountRemain) - currentUsage,
        outstanding: Number(sale.amountRemain) + currentUsage,
      };
    }),
    creditNotes: creditNotes.map((creditNote) => {
      const currentUsage = sumReceiptUsage(creditNote.receiptItems);
      return {
        id: creditNote.id,
        docNo: creditNote.cnNo,
        docDate: creditNote.cnDate,
        totalAmount: Number(creditNote.totalAmount),
        usedAmount: Number(creditNote.totalAmount) - Number(creditNote.amountRemain) - currentUsage,
        outstanding: Number(creditNote.amountRemain) + currentUsage,
      };
    }),
  };
}

function validateReceiptItemsAgainstAvailable(
  customerId: string | undefined,
  items: ParsedReceipt["items"],
  available: AvailableReceiptDocumentBundle,
): string | null {
  if (!customerId) {
    return "กรุณาเลือกลูกค้า";
  }

  const saleMap = new Map(available.sales.map((item) => [item.id, item]));
  const cnMap = new Map(available.creditNotes.map((item) => [item.id, item]));
  const usedMap = new Map<string, number>();

  const registerAmount = (key: string, amount: number): number => {
    const nextAmount = (usedMap.get(key) ?? 0) + amount;
    usedMap.set(key, nextAmount);
    return nextAmount;
  };

  for (const item of items) {
    if (item.saleId) {
      const sale = saleMap.get(item.saleId);
      if (!sale) {
        return "พบใบขายเชื่อที่เลือกไม่ถูกต้อง ถูกยกเลิก หรือไม่ใช่ของลูกค้ารายนี้";
      }
      if (registerAmount(`sale:${item.saleId}`, item.paidAmount) > sale.outstanding + 0.0001) {
        return `ยอดรับชำระของ ${sale.docNo} มากกว่ายอดคงเหลือที่รับได้`;
      }
      continue;
    }

    if (item.cnId) {
      const creditNote = cnMap.get(item.cnId);
      if (!creditNote) {
        return "พบใบลดหนี้เครดิตที่เลือกไม่ถูกต้อง ถูกยกเลิก หรือไม่ใช่ของลูกค้ารายนี้";
      }
      if (registerAmount(`cn:${item.cnId}`, item.paidAmount) > creditNote.outstanding + 0.0001) {
        return `ยอดที่นำเครดิต ${creditNote.docNo} มาใช้ มากกว่ายอดคงเหลือที่ใช้ได้`;
      }
    }
  }

  return null;
}

async function recalculateAffectedReceiptDocuments(
  tx: TxClient,
  affectedIds: ReturnType<typeof collectAffectedReceiptIds>,
): Promise<void> {
  for (const saleId of affectedIds.saleIds) {
    await recalculateSaleAmountRemain(tx, saleId);
  }
  for (const cnId of affectedIds.cnIds) {
    await recalculateCNAmountRemain(tx, cnId);
  }
}

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

  const parsedResult = parseReceiptForm(formData);
  if (!parsedResult.success) {
    return { success: false, error: parsedResult.error };
  }
  const parsed = parsedResult.data;

  try {
    const docDate   = new Date(parsed.receiptDate);
    const receiptNo = await generateReceiptNo(docDate);

    // Sale items add to total; CN items are credits that reduce the total
    const totalAmount = calculateReceiptTotalAmount(parsed.items);
    if (totalAmount > 0 && !parsed.cashBankAccountId) {
      return { success: false, error: "กรุณาเลือกบัญชีรับเงิน" };
    }

    const resolvedCashBankAccountId = totalAmount > 0 ? parsed.cashBankAccountId : undefined;
    const affectedIds = collectAffectedReceiptIds(parsed.items);

    await dbTx(async (tx) => {
      const available = await getAvailableReceiptDocumentsForAR(tx, parsed.customerId ?? "");
      const validationError = validateReceiptItemsAgainstAvailableForAR(parsed.customerId, parsed.items, available);
      if (validationError) throw new Error(validationError);

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

      await recalculateAffectedReceiptDocuments(tx, affectedIds);

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
    return {
      success: false,
      error: err instanceof Error ? err.message : "เกิดข้อผิดพลาด ไม่สามารถบันทึกใบเสร็จได้",
    };
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

  const parsedResult = parseReceiptForm(formData);
  if (!parsedResult.success) return { error: parsedResult.error };
  const parsed = parsedResult.data;

  const docDate     = new Date(parsed.receiptDate);
  const totalAmount = calculateReceiptTotalAmount(parsed.items);
  if (totalAmount > 0 && !parsed.cashBankAccountId) {
    return { error: "กรุณาเลือกบัญชีรับเงิน" };
  }

  const resolvedCashBankAccountId = totalAmount > 0 ? parsed.cashBankAccountId : undefined;
  const oldAffectedIds = collectAffectedReceiptIds(existing.items);
  const newAffectedIds = collectAffectedReceiptIds(parsed.items);
  const allAffectedIds = {
    saleIds: [...new Set([...oldAffectedIds.saleIds, ...newAffectedIds.saleIds])],
    cnIds: [...new Set([...oldAffectedIds.cnIds, ...newAffectedIds.cnIds])],
  };

  try {
    await dbTx(async (tx) => {
      const available = await getAvailableReceiptDocumentsForAR(tx, parsed.customerId ?? "", id);
      const validationError = validateReceiptItemsAgainstAvailableForAR(parsed.customerId, parsed.items, available);
      if (validationError) throw new Error(validationError);

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
      await recalculateAffectedReceiptDocuments(tx, allAffectedIds);

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
    return {
      error: err instanceof Error ? err.message : "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
    };
  }
}
