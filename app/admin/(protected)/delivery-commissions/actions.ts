"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  diffEntity,
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { clearCashBankSourceMovements, replaceCashBankSourceMovements } from "@/lib/cash-bank";
import { db, dbTx } from "@/lib/db";
import { generateDeliveryCommissionRunNo, generateExpenseNo } from "@/lib/doc-number";
import {
  AuditAction,
  CashBankDirection,
  CashBankSourceType,
  DocStatus,
  FulfillmentType,
  ShippingStatus,
  VatType,
} from "@/lib/generated/prisma";
import { rebuildExpenseProfitFacts } from "@/lib/profit-fact";
import { requirePermission } from "@/lib/require-auth";
import { getSiteConfig } from "@/lib/site-config";
import { parseDateOnlyToEndOfDay, parseDateOnlyToStartOfDay } from "@/lib/th-date";

const MAX_PAYOUT_SALES = 200;
const MAX_DOCNO_RETRIES = 3;

const createSchema = z.object({
  deliveryStaffId: z.string().min(1, "กรุณาเลือกพนักงานส่ง"),
  cashBankAccountId: z.string().min(1, "กรุณาเลือกบัญชีที่จ่ายออก"),
  fromDate: z.string().min(1, "กรุณาระบุวันที่เริ่มต้น"),
  toDate: z.string().min(1, "กรุณาระบุวันที่สิ้นสุด"),
  payDate: z.string().min(1, "กรุณาระบุวันที่ทำจ่าย"),
  note: z.string().max(500).optional(),
  saleIds: z
    .array(z.string())
    .min(1, "กรุณาเลือกเอกสารจัดส่งอย่างน้อย 1 รายการ")
    .max(MAX_PAYOUT_SALES, `ทำจ่ายได้ครั้งละไม่เกิน ${MAX_PAYOUT_SALES} บิล`),
});

const cancelSchema = z.object({
  runId: z.string().min(1),
  cancelNote: z.string().max(200).optional(),
});

type PrismaKnownError = {
  code: string;
  meta?: {
    target?: string[] | string;
  };
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isPrismaKnownError(error: unknown): error is PrismaKnownError {
  return typeof error === "object" && error !== null && "code" in error;
}

function getPrismaErrorTargets(error: unknown): string[] {
  if (!isPrismaKnownError(error)) return [];

  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.filter((value): value is string => typeof value === "string");
  }

  return typeof target === "string" ? [target] : [];
}

async function getRunAuditSnapshot(runId: string) {
  return db.deliveryCommissionRun.findUnique({
    where: { id: runId },
    include: {
      deliveryStaff: { select: { id: true, name: true, email: true } },
      cashBankAccount: { select: { code: true, name: true, type: true } },
      expenseCode: { select: { code: true, name: true } },
      expense: { select: { expenseNo: true, status: true } },
      items: { orderBy: [{ saleDate: "asc" }, { saleNo: "asc" }] },
    },
  });
}

function parseSaleIds(formData: FormData): string[] {
  const repeated = formData
    .getAll("saleIds")
    .filter((value): value is string => typeof value === "string");
  if (repeated.length > 0) {
    return [...new Set(repeated)].slice(0, MAX_PAYOUT_SALES + 1);
  }

  const raw = formData.get("saleIdsJson");
  if (typeof raw !== "string") return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((value): value is string => typeof value === "string"))].slice(
          0,
          MAX_PAYOUT_SALES + 1,
        )
      : [];
  } catch {
    return [];
  }
}

type CreateRunResult = {
  success?: boolean;
  runId?: string;
  runNo?: string;
  error?: string;
};

export async function createDeliveryCommissionRun(formData: FormData): Promise<CreateRunResult> {
  const session = await requirePermission("delivery_commissions.create").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const requestContext = await getRequestContext();
  const parsed = createSchema.safeParse({
    deliveryStaffId: formData.get("deliveryStaffId"),
    cashBankAccountId: formData.get("cashBankAccountId"),
    fromDate: formData.get("fromDate"),
    toDate: formData.get("toDate"),
    payDate: formData.get("payDate"),
    note: formData.get("note") || undefined,
    saleIds: parseSaleIds(formData),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const d = parsed.data;
  const fromDate = parseDateOnlyToStartOfDay(d.fromDate);
  const toDate = parseDateOnlyToEndOfDay(d.toDate);
  const payDate = parseDateOnlyToStartOfDay(d.payDate);

  if (fromDate > toDate) return { error: "ช่วงวันที่ไม่ถูกต้อง" };

  const config = await getSiteConfig();
  const commissionPercent = roundMoney(config.deliveryCommissionPercent);
  if (commissionPercent <= 0) {
    return { error: "เปอร์เซ็นต์ค่าส่งพนักงานต้องมากกว่า 0" };
  }

  const [expenseCode, deliveryStaff, account] = await Promise.all([
    db.expenseCode.findFirst({
      where: { isDeliveryCommission: true, isActive: true },
      select: { id: true, code: true, name: true },
    }),
    db.user.findFirst({
      where: { id: d.deliveryStaffId },
      select: { id: true, name: true },
    }),
    db.cashBankAccount.findFirst({
      where: { id: d.cashBankAccountId, isActive: true },
      select: { id: true, code: true, name: true },
    }),
  ]);

  if (!expenseCode) return { error: "กรุณาตั้งรหัสค่าใช้จ่ายสำหรับทำจ่ายค่าส่งพนักงานก่อน" };
  if (!deliveryStaff) return { error: "ไม่พบผู้ส่งที่เลือก" };
  if (!account) return { error: "ไม่พบบัญชีที่จ่ายออก" };

  let createdRunId = "";
  let createdRunNo = "";

  for (let attempt = 0; attempt < MAX_DOCNO_RETRIES; attempt += 1) {
    try {
      const runNo = await generateDeliveryCommissionRunNo(payDate);
      const expenseNo = await generateExpenseNo(payDate);

      await dbTx(async (tx) => {
        const selectedSales = await tx.sale.findMany({
          where: {
            id: { in: d.saleIds },
            status: DocStatus.ACTIVE,
            fulfillmentType: FulfillmentType.DELIVERY,
            shippingStatus: ShippingStatus.DELIVERED,
            deliveryStaffId: d.deliveryStaffId,
            saleDate: { gte: fromDate, lte: toDate },
            shippingFee: { gt: 0 },
            deliveryCommissionItems: { none: { activeSaleId: { not: null } } },
          },
          orderBy: [{ saleDate: "asc" }, { saleNo: "asc" }],
          select: {
            id: true,
            saleNo: true,
            saleDate: true,
            customerName: true,
            shippingFee: true,
          },
        });

        if (selectedSales.length === 0) {
          throw new Error("NO_ELIGIBLE_SALES");
        }

        if (selectedSales.length !== d.saleIds.length) {
          throw new Error("SALE_SELECTION_CHANGED");
        }

        const items = selectedSales.map((sale) => {
          const shippingFee = Number(sale.shippingFee);
          return {
            saleId: sale.id,
            saleNo: sale.saleNo,
            saleDate: sale.saleDate,
            customerName: sale.customerName,
            shippingFee,
            commissionPercent,
            commissionAmount: roundMoney((shippingFee * commissionPercent) / 100),
          };
        });
        const shippingFeeTotal = roundMoney(items.reduce((sum, item) => sum + item.shippingFee, 0));
        const commissionTotal = roundMoney(
          items.reduce((sum, item) => sum + item.commissionAmount, 0),
        );

        if (commissionTotal <= 0) {
          throw new Error("INVALID_COMMISSION_TOTAL");
        }

        const expense = await tx.expense.create({
          data: {
            expenseNo,
            expenseDate: payDate,
            userId: session.user.id,
            cashBankAccountId: d.cashBankAccountId,
            totalAmount: commissionTotal,
            subtotalAmount: commissionTotal,
            vatAmount: 0,
            vatRate: 0,
            vatType: VatType.NO_VAT,
            netAmount: commissionTotal,
            note: d.note || `ทำจ่ายค่าส่งพนักงาน ${deliveryStaff.name}`,
            items: {
              create: [
                {
                  expenseCodeId: expenseCode.id,
                  description: `ทำจ่ายค่าส่งพนักงาน ${deliveryStaff.name} (${runNo})`,
                  amount: commissionTotal,
                },
              ],
            },
          },
        });

        const run = await tx.deliveryCommissionRun.create({
          data: {
            runNo,
            payDate,
            fromDate,
            toDate,
            deliveryStaffId: d.deliveryStaffId,
            userId: session.user.id,
            cashBankAccountId: d.cashBankAccountId,
            expenseCodeId: expenseCode.id,
            expenseId: expense.id,
            commissionPercent,
            shippingFeeTotal,
            commissionTotal,
            note: d.note || null,
            items: {
              create: items.map((item) => ({
                saleId: item.saleId,
                activeSaleId: item.saleId,
                saleNo: item.saleNo,
                saleDate: item.saleDate,
                customerName: item.customerName,
                shippingFee: item.shippingFee,
                commissionPercent: item.commissionPercent,
                commissionAmount: item.commissionAmount,
              })),
            },
          },
        });
        createdRunId = run.id;
        createdRunNo = run.runNo;

        await replaceCashBankSourceMovements(tx, CashBankSourceType.EXPENSE, expense.id, [
          {
            accountId: d.cashBankAccountId,
            txnDate: payDate,
            direction: CashBankDirection.OUT,
            amount: commissionTotal,
            referenceNo: expenseNo,
            note: d.note || `ทำจ่ายค่าส่งพนักงาน ${runNo}`,
          },
        ]);
        await rebuildExpenseProfitFacts(tx, expense.id);
      });

      break;
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "NO_ELIGIBLE_SALES") {
          return { error: "ไม่พบเอกสารจัดส่งที่ทำจ่ายได้" };
        }
        if (error.message === "SALE_SELECTION_CHANGED") {
          return {
            error: "มีบางบิลถูกทำจ่ายแล้วระหว่างดำเนินการ กรุณาโหลดรายการใหม่แล้วลองอีกครั้ง",
          };
        }
        if (error.message === "INVALID_COMMISSION_TOTAL") {
          return { error: "ยอดทำจ่ายต้องมากกว่า 0" };
        }
      }

      if (isPrismaKnownError(error) && error.code === "P2002") {
        const targets = getPrismaErrorTargets(error);
        if (targets.includes("activeSaleId")) {
          return {
            error: "มีบางบิลถูกทำจ่ายแล้วระหว่างดำเนินการ กรุณาโหลดรายการใหม่แล้วลองอีกครั้ง",
          };
        }
        if (
          (targets.includes("runNo") || targets.includes("expenseNo")) &&
          attempt < MAX_DOCNO_RETRIES - 1
        ) {
          continue;
        }
      }

      console.error("[createDeliveryCommissionRun]", error);
      return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
    }
  }

  if (!createdRunId || !createdRunNo) {
    return { error: "สร้างเอกสารทำจ่ายไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  const afterSnapshot = await getRunAuditSnapshot(createdRunId);
  if (afterSnapshot) {
    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: AuditAction.CREATE,
      entityType: "DeliveryCommissionRun",
      entityId: afterSnapshot.id,
      entityRef: afterSnapshot.runNo,
      after: afterSnapshot,
    });
  }

  revalidatePath("/admin");
  revalidatePath("/admin/delivery");
  revalidatePath("/admin/delivery/update");
  revalidatePath("/admin/delivery-commissions");
  revalidatePath("/admin/expenses");
  revalidatePath("/admin/cash-bank");
  revalidatePath("/admin/reports");

  return { success: true, runId: createdRunId, runNo: createdRunNo };
}

export async function cancelDeliveryCommissionRun(
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("delivery_commissions.cancel").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const requestContext = await getRequestContext();
  const parsed = cancelSchema.safeParse({
    runId: formData.get("runId"),
    cancelNote: formData.get("cancelNote") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const beforeSnapshot = await getRunAuditSnapshot(parsed.data.runId);
  if (!beforeSnapshot) return { error: "ไม่พบเอกสาร" };
  if (beforeSnapshot.status === DocStatus.CANCELLED) return { error: "เอกสารถูกยกเลิกแล้ว" };

  try {
    await dbTx(async (tx) => {
      if (beforeSnapshot.expenseId) {
        await clearCashBankSourceMovements(tx, CashBankSourceType.EXPENSE, beforeSnapshot.expenseId);
        await tx.expense.update({
          where: { id: beforeSnapshot.expenseId },
          data: {
            status: DocStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelNote: parsed.data.cancelNote,
          },
        });
        await rebuildExpenseProfitFacts(tx, beforeSnapshot.expenseId);
      }

      await tx.deliveryCommissionItem.updateMany({
        where: { runId: parsed.data.runId, activeSaleId: { not: null } },
        data: { activeSaleId: null },
      });

      await tx.deliveryCommissionRun.update({
        where: { id: parsed.data.runId },
        data: {
          status: DocStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelNote: parsed.data.cancelNote,
        },
      });
    });

    const afterSnapshot = await getRunAuditSnapshot(parsed.data.runId);
    if (afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CANCEL,
        entityType: "DeliveryCommissionRun",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.runNo,
        before: diff.before,
        after: diff.after,
        meta: { cancelNote: parsed.data.cancelNote ?? null },
      });
    }

    revalidatePath("/admin");
    revalidatePath("/admin/delivery-commissions");
    revalidatePath("/admin/expenses");
    revalidatePath("/admin/cash-bank");
    revalidatePath("/admin/reports");
    return { success: true };
  } catch (error) {
    console.error("[cancelDeliveryCommissionRun]", error);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
