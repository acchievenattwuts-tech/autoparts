"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbTx } from "@/lib/db";
import { generateCashBankAdjustmentNo, generateCashBankTransferNo } from "@/lib/doc-number";
import {
  CashBankAccountType,
  CashBankAdjustmentStatus,
  CashBankDirection,
  CashBankSourceType,
  CashBankTransferStatus,
} from "@/lib/generated/prisma";
import { requirePermission } from "@/lib/require-auth";
import {
  clearCashBankSourceMovements,
  recalculateCashBankAccount,
  replaceCashBankSourceMovements,
} from "@/lib/cash-bank";
import { getPrimaryTransferRuleViolation, type PrimaryTransferRuleCode } from "@/lib/cash-bank-primary-transfer";

const parseBoolean = (value: FormDataEntryValue | null): boolean => value === "true" || value === "on";

const accountSchema = z.object({
  code: z.string().trim().min(1, "กรุณาระบุรหัสบัญชี").max(30),
  name: z.string().trim().min(1, "กรุณาระบุชื่อบัญชี").max(120),
  type: z.nativeEnum(CashBankAccountType),
  bankName: z.string().trim().max(120).optional(),
  accountNo: z.string().trim().max(50).optional(),
  promptPayId: z.string().trim().max(50).optional(),
  isPrimaryTransferAccount: z.boolean(),
  openingBalance: z.coerce.number().min(0, "ยอดยกมาต้องไม่ต่ำกว่า 0"),
  openingDate: z.string().min(1, "กรุณาระบุวันที่ยอดยกมา"),
  isActive: z.boolean(),
});

const transferSchema = z.object({
  transferDate: z.string().min(1, "กรุณาระบุวันที่โอน"),
  fromAccountId: z.string().min(1, "กรุณาเลือกบัญชีต้นทาง"),
  toAccountId: z.string().min(1, "กรุณาเลือกบัญชีปลายทาง"),
  amount: z.coerce.number().positive("จำนวนเงินต้องมากกว่า 0"),
  note: z.string().trim().max(500).optional(),
});

const adjustmentSchema = z.object({
  adjustDate: z.string().min(1, "กรุณาระบุวันที่ปรับยอด"),
  accountId: z.string().min(1, "กรุณาเลือกบัญชี"),
  direction: z.nativeEnum(CashBankDirection),
  amount: z.coerce.number().positive("จำนวนเงินต้องมากกว่า 0"),
  reason: z.string().trim().min(1, "กรุณาระบุเหตุผล"),
  note: z.string().trim().max(500).optional(),
});

const DEFAULT_CASH_BANK_ACCOUNTS: Array<{
  code: string;
  name: string;
  type: CashBankAccountType;
  bankName?: string;
}> = [
  { code: "CASH-MAIN", name: "เงินสดหน้าร้าน", type: CashBankAccountType.CASH },
  { code: "BANK-KBANK", name: "ธนาคารกสิกรไทย", type: CashBankAccountType.BANK, bankName: "Kasikornbank" },
  { code: "BANK-KTB", name: "ธนาคารกรุงไทย", type: CashBankAccountType.BANK, bankName: "Krung Thai Bank" },
];

function revalidateCashBankViews(): void {
  revalidatePath("/admin/cash-bank");
  revalidatePath("/admin/cash-bank/ledger");
  revalidatePath("/admin/cash-bank/transfers");
  revalidatePath("/admin/cash-bank/adjustments");
  revalidatePath("/admin/delivery");
  revalidatePath("/admin/sales");
  revalidatePath("/admin/reports/cash-bank-ledger");
  revalidatePath("/admin/reports/cash-bank-transfers");
  revalidatePath("/admin/reports/cash-bank-adjustments");
  revalidatePath("/admin/reports/payments");
  revalidatePath("/admin/reports/receipts");
  revalidatePath("/admin/reports/summary");
  revalidatePath("/admin/reports/print");
}

function validateCashBankAccountInput(data: z.infer<typeof accountSchema>): string | null {
  if (data.type === CashBankAccountType.BANK) {
    if (!data.bankName?.trim()) return "กรุณาระบุชื่อธนาคารสำหรับบัญชีประเภทธนาคาร";
    if (!data.accountNo?.trim()) return "กรุณาระบุเลขที่บัญชีสำหรับบัญชีประเภทธนาคาร";
  }

  if (Number.isNaN(new Date(data.openingDate).getTime())) {
    return "วันที่ยอดยกมาไม่ถูกต้อง";
  }

  return null;
}

async function validatePrimaryTransferAccountAvailability(
  tx: Parameters<Parameters<typeof dbTx>[0]>[0],
  data: z.infer<typeof accountSchema>,
  accountId?: string,
): Promise<string | null> {
  if (!data.isPrimaryTransferAccount) return null;

  const currentPrimary = await tx.cashBankAccount.findFirst({
    where: {
      isPrimaryTransferAccount: true,
      ...(accountId ? { id: { not: accountId } } : {}),
    },
    select: { code: true, name: true },
  });

  const violation = getPrimaryTransferRuleViolation({
    type: data.type,
    isActive: data.isActive,
    isPrimaryTransferAccount: data.isPrimaryTransferAccount,
    promptPayId: data.promptPayId,
    hasAnotherPrimary: Boolean(currentPrimary),
  });

  if (violation) {
    return getPrimaryTransferRuleMessage(violation, currentPrimary ?? null);
  }

  return null;
}


function getPrimaryTransferRuleMessage(
  violation: PrimaryTransferRuleCode,
  existingPrimary: { code: string; name: string } | null,
): string {
  switch (violation) {
    case "PRIMARY_REQUIRES_BANK":
      return "เธเธฑเธเธเธตเธซเธฅเธฑเธเธฃเธฑเธเนเธญเธเธ•เนเธญเธเน€เธเนเธเธเธฑเธเธเธตเธเธฃเธฐเน€เธ เธ—เธเธเธฒเธเธฒเธฃ";
    case "PRIMARY_REQUIRES_ACTIVE":
      return "เธเธฑเธเธเธตเธซเธฅเธฑเธเธฃเธฑเธเนเธญเธเธ•เนเธญเธเธญเธขเธนเนเนเธเธชเธ–เธฒเธเธฐเนเธเนเธเธฒเธ";
    case "PRIMARY_REQUIRES_PROMPTPAY":
      return "เธเธฑเธเธเธตเธซเธฅเธฑเธเธฃเธฑเธเนเธญเธเธ•เนเธญเธเธฃเธฐเธเธธ PromptPay ID เน€เธเธทเนเธญเธชเธฃเนเธฒเธ QR เธชเธณเธซเธฃเธฑเธเธเธณเธฃเธฐเน€เธเธดเธ";
    case "PRIMARY_ALREADY_EXISTS":
      return existingPrimary
        ? `เธกเธตเธเธฑเธเธเธตเธซเธฅเธฑเธเธฃเธฑเธเนเธญเธเธญเธขเธนเนเนเธฅเนเธง (${existingPrimary.code} - ${existingPrimary.name}) เธเธฃเธธเธ“เธฒเน€เธญเธฒเธ•เธดเนเธเธญเธญเธเธเธฒเธเธเธฑเธเธเธตเน€เธ”เธดเธกเธเนเธญเธ`
        : "เธกเธตเธเธฑเธเธเธตเธซเธฅเธฑเธเธฃเธฑเธเนเธญเธเธญเธขเธนเนเนเธฅเนเธง เธเธฃเธธเธ“เธฒเน€เธญเธฒเธ•เธดเนเธเธญเธญเธเธเธฒเธเธเธฑเธเธเธตเน€เธ”เธดเธกเธเนเธญเธ";
  }
}

export async function seedDefaultCashBankAccounts() {
  try {
    await requirePermission("cash_bank.manage");

    const openingDate = new Date();
    openingDate.setHours(0, 0, 0, 0);

    const summary = await dbTx(async (tx) => {
      let created = 0;
      let skipped = 0;

      for (const account of DEFAULT_CASH_BANK_ACCOUNTS) {
        const existing = await tx.cashBankAccount.findFirst({
          where: {
            OR: [{ code: account.code }, { name: account.name }],
          },
          select: { id: true },
        });

        if (existing) {
          skipped += 1;
          continue;
        }

        await tx.cashBankAccount.create({
          data: {
            code: account.code,
            name: account.name,
            type: account.type,
            bankName: account.type === CashBankAccountType.BANK ? account.bankName ?? null : null,
            accountNo: null,
            openingBalance: 0,
            openingDate,
            isActive: true,
          },
        });
        created += 1;
      }

      return { created, skipped };
    });

    revalidateCashBankViews();

    return {
      success: true,
      message:
        summary.created > 0
          ? `สร้างบัญชีตั้งต้น ${summary.created} รายการ${summary.skipped > 0 ? ` และข้ามบัญชีที่มีอยู่แล้ว ${summary.skipped} รายการ` : ""}`
          : "มีบัญชีตั้งต้นครบแล้ว ไม่จำเป็นต้องสร้างเพิ่ม",
    };
  } catch (error) {
    console.error("seedDefaultCashBankAccounts", error);
    return { error: "ไม่สามารถสร้างบัญชีตั้งต้นได้" };
  }
}

export async function createCashBankAccount(formData: FormData) {
  try {
    await requirePermission("cash_bank.manage");

    const parsed = accountSchema.safeParse({
      code: formData.get("code"),
      name: formData.get("name"),
      type: formData.get("type"),
      bankName: formData.get("bankName") || undefined,
      accountNo: formData.get("accountNo") || undefined,
      promptPayId: formData.get("promptPayId") || undefined,
      isPrimaryTransferAccount: parseBoolean(formData.get("isPrimaryTransferAccount")),
      openingBalance: formData.get("openingBalance") || 0,
      openingDate: formData.get("openingDate"),
      isActive: parseBoolean(formData.get("isActive")),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const validationError = validateCashBankAccountInput(parsed.data);
    if (validationError) return { error: validationError };

    const data = parsed.data;
    await dbTx(async (tx) => {
      const primaryValidationError = await validatePrimaryTransferAccountAvailability(tx, data);
      if (primaryValidationError) {
        throw new Error(primaryValidationError);
      }

      await tx.cashBankAccount.create({
        data: {
          code: data.code,
          name: data.name,
          type: data.type,
          bankName: data.type === CashBankAccountType.BANK ? data.bankName || null : null,
          accountNo: data.type === CashBankAccountType.BANK ? data.accountNo || null : null,
          promptPayId: data.type === CashBankAccountType.BANK ? data.promptPayId || null : null,
          isPrimaryTransferAccount: data.isPrimaryTransferAccount,
          openingBalance: data.openingBalance,
          openingDate: new Date(data.openingDate),
          isActive: data.isActive,
        },
      });
    });

    revalidateCashBankViews();
    return { success: true };
  } catch (error) {
    console.error("createCashBankAccount", error);
    if (error instanceof Error && error.message) {
      return { error: error.message };
    }
    return { error: "ไม่สามารถสร้างบัญชีเงินได้" };
  }
}

export async function updateCashBankAccount(accountId: string, formData: FormData) {
  try {
    await requirePermission("cash_bank.manage");

    const parsed = accountSchema.safeParse({
      code: formData.get("code"),
      name: formData.get("name"),
      type: formData.get("type"),
      bankName: formData.get("bankName") || undefined,
      accountNo: formData.get("accountNo") || undefined,
      promptPayId: formData.get("promptPayId") || undefined,
      isPrimaryTransferAccount: parseBoolean(formData.get("isPrimaryTransferAccount")),
      openingBalance: formData.get("openingBalance") || 0,
      openingDate: formData.get("openingDate"),
      isActive: parseBoolean(formData.get("isActive")),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const validationError = validateCashBankAccountInput(parsed.data);
    if (validationError) return { error: validationError };

    const data = parsed.data;
    await dbTx(async (tx) => {
      const primaryValidationError = await validatePrimaryTransferAccountAvailability(tx, data, accountId);
      if (primaryValidationError) {
        throw new Error(primaryValidationError);
      }

      await tx.cashBankAccount.update({
        where: { id: accountId },
        data: {
          code: data.code,
          name: data.name,
          type: data.type,
          bankName: data.type === CashBankAccountType.BANK ? data.bankName || null : null,
          accountNo: data.type === CashBankAccountType.BANK ? data.accountNo || null : null,
          promptPayId: data.type === CashBankAccountType.BANK ? data.promptPayId || null : null,
          isPrimaryTransferAccount: data.isPrimaryTransferAccount,
          openingBalance: data.openingBalance,
          openingDate: new Date(data.openingDate),
          isActive: data.isActive,
        },
      });
      await recalculateCashBankAccount(tx, accountId);
    });

    revalidateCashBankViews();
    return { success: true };
  } catch (error) {
    console.error("updateCashBankAccount", error);
    if (error instanceof Error && error.message) {
      return { error: error.message };
    }
    return { error: "ไม่สามารถแก้ไขบัญชีเงินได้" };
  }
}

export async function createCashBankTransfer(formData: FormData) {
  try {
    const session = await requirePermission("cash_bank.transfers.create");

    const parsed = transferSchema.safeParse({
      transferDate: formData.get("transferDate"),
      fromAccountId: formData.get("fromAccountId"),
      toAccountId: formData.get("toAccountId"),
      amount: formData.get("amount") || 0,
      note: formData.get("note") || undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    if (parsed.data.fromAccountId === parsed.data.toAccountId) {
      return { error: "บัญชีต้นทางและปลายทางต้องไม่ซ้ำกัน" };
    }

    const docDate = new Date(parsed.data.transferDate);
    if (Number.isNaN(docDate.getTime())) {
      return { error: "วันที่โอนไม่ถูกต้อง" };
    }

    const transferNo = await generateCashBankTransferNo(docDate);

    await dbTx(async (tx) => {
      const transfer = await tx.cashBankTransfer.create({
        data: {
          transferNo,
          transferDate: docDate,
          fromAccountId: parsed.data.fromAccountId,
          toAccountId: parsed.data.toAccountId,
          amount: parsed.data.amount,
          note: parsed.data.note || null,
          userId: session.user.id!,
        },
      });

      await replaceCashBankSourceMovements(tx, CashBankSourceType.TRANSFER, transfer.id, [
        {
          accountId: parsed.data.fromAccountId,
          txnDate: docDate,
          direction: CashBankDirection.OUT,
          amount: parsed.data.amount,
          referenceNo: transferNo,
          note: parsed.data.note,
        },
        {
          accountId: parsed.data.toAccountId,
          txnDate: docDate,
          direction: CashBankDirection.IN,
          amount: parsed.data.amount,
          referenceNo: transferNo,
          note: parsed.data.note,
        },
      ]);
    });

    revalidateCashBankViews();
    return { success: true };
  } catch (error) {
    console.error("createCashBankTransfer", error);
    return { error: "ไม่สามารถบันทึกการโอนเงินได้" };
  }
}

export async function cancelCashBankTransfer(transferId: string, formData: FormData) {
  try {
    await requirePermission("cash_bank.transfers.cancel");

    const cancelNote = String(formData.get("cancelNote") || "").trim();
    if (!cancelNote) return { error: "กรุณาระบุเหตุผลที่ยกเลิกรายการโอนเงิน" };

    await dbTx(async (tx) => {
      const transfer = await tx.cashBankTransfer.findUnique({
        where: { id: transferId },
        select: { id: true, status: true },
      });
      if (!transfer || transfer.status === CashBankTransferStatus.CANCELLED) {
        throw new Error("TRANSFER_NOT_FOUND");
      }

      await clearCashBankSourceMovements(tx, CashBankSourceType.TRANSFER, transferId);
      await tx.cashBankTransfer.update({
        where: { id: transferId },
        data: {
          status: CashBankTransferStatus.CANCELLED,
          cancelNote,
          cancelledAt: new Date(),
        },
      });
    });

    revalidateCashBankViews();
    return { success: true };
  } catch (error) {
    console.error("cancelCashBankTransfer", error);
    return { error: "ไม่สามารถยกเลิกการโอนเงินได้" };
  }
}

export async function createCashBankAdjustment(formData: FormData) {
  try {
    const session = await requirePermission("cash_bank.adjustments.create");

    const parsed = adjustmentSchema.safeParse({
      adjustDate: formData.get("adjustDate"),
      accountId: formData.get("accountId"),
      direction: formData.get("direction"),
      amount: formData.get("amount") || 0,
      reason: formData.get("reason"),
      note: formData.get("note") || undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const docDate = new Date(parsed.data.adjustDate);
    if (Number.isNaN(docDate.getTime())) {
      return { error: "วันที่ปรับยอดไม่ถูกต้อง" };
    }

    const adjustNo = await generateCashBankAdjustmentNo(docDate);

    await dbTx(async (tx) => {
      const adjustment = await tx.cashBankAdjustment.create({
        data: {
          adjustNo,
          adjustDate: docDate,
          accountId: parsed.data.accountId,
          direction: parsed.data.direction,
          amount: parsed.data.amount,
          reason: parsed.data.reason,
          note: parsed.data.note || null,
          userId: session.user.id!,
        },
      });

      await replaceCashBankSourceMovements(tx, CashBankSourceType.ADJUSTMENT, adjustment.id, [
        {
          accountId: parsed.data.accountId,
          txnDate: docDate,
          direction: parsed.data.direction,
          amount: parsed.data.amount,
          referenceNo: adjustNo,
          note: [parsed.data.reason, parsed.data.note].filter(Boolean).join(" | "),
        },
      ]);
    });

    revalidateCashBankViews();
    return { success: true };
  } catch (error) {
    console.error("createCashBankAdjustment", error);
    return { error: "ไม่สามารถบันทึกการปรับยอดได้" };
  }
}

export async function updateCashBankAdjustment(adjustmentId: string, formData: FormData) {
  try {
    await requirePermission("cash_bank.adjustments.update");

    const parsed = adjustmentSchema.safeParse({
      adjustDate: formData.get("adjustDate"),
      accountId: formData.get("accountId"),
      direction: formData.get("direction"),
      amount: formData.get("amount") || 0,
      reason: formData.get("reason"),
      note: formData.get("note") || undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const docDate = new Date(parsed.data.adjustDate);
    if (Number.isNaN(docDate.getTime())) {
      return { error: "วันที่ปรับยอดไม่ถูกต้อง" };
    }

    await dbTx(async (tx) => {
      const existing = await tx.cashBankAdjustment.findUnique({
        where: { id: adjustmentId },
        select: { id: true, status: true, adjustNo: true },
      });
      if (!existing || existing.status === CashBankAdjustmentStatus.CANCELLED) {
        throw new Error("ADJUSTMENT_NOT_FOUND");
      }

      await tx.cashBankAdjustment.update({
        where: { id: adjustmentId },
        data: {
          adjustDate: docDate,
          accountId: parsed.data.accountId,
          direction: parsed.data.direction,
          amount: parsed.data.amount,
          reason: parsed.data.reason,
          note: parsed.data.note || null,
        },
      });

      await replaceCashBankSourceMovements(tx, CashBankSourceType.ADJUSTMENT, adjustmentId, [
        {
          accountId: parsed.data.accountId,
          txnDate: docDate,
          direction: parsed.data.direction,
          amount: parsed.data.amount,
          referenceNo: existing.adjustNo,
          note: [parsed.data.reason, parsed.data.note].filter(Boolean).join(" | "),
        },
      ]);
    });

    revalidateCashBankViews();
    return { success: true };
  } catch (error) {
    console.error("updateCashBankAdjustment", error);
    return { error: "ไม่สามารถแก้ไขการปรับยอดได้" };
  }
}

export async function cancelCashBankAdjustment(adjustmentId: string, formData: FormData) {
  try {
    await requirePermission("cash_bank.adjustments.cancel");

    const cancelNote = String(formData.get("cancelNote") || "").trim();
    if (!cancelNote) return { error: "กรุณาระบุเหตุผลที่ยกเลิกรายการปรับยอด" };

    await dbTx(async (tx) => {
      const adjustment = await tx.cashBankAdjustment.findUnique({
        where: { id: adjustmentId },
        select: { id: true, status: true },
      });
      if (!adjustment || adjustment.status === CashBankAdjustmentStatus.CANCELLED) {
        throw new Error("ADJUSTMENT_NOT_FOUND");
      }

      await clearCashBankSourceMovements(tx, CashBankSourceType.ADJUSTMENT, adjustmentId);
      await tx.cashBankAdjustment.update({
        where: { id: adjustmentId },
        data: {
          status: CashBankAdjustmentStatus.CANCELLED,
          cancelNote,
          cancelledAt: new Date(),
        },
      });
    });

    revalidateCashBankViews();
    return { success: true };
  } catch (error) {
    console.error("cancelCashBankAdjustment", error);
    return { error: "ไม่สามารถยกเลิกการปรับยอดได้" };
  }
}
