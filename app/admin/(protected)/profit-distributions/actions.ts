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
import { generateProfitDistributionNo } from "@/lib/doc-number";
import {
  AuditAction,
  CashBankDirection,
  CashBankSourceType,
  DocStatus,
  PartnerLedgerType,
} from "@/lib/generated/prisma";
import {
  notifyProfitDistributionCancelled,
  notifyProfitDistributionDeclared,
} from "@/lib/notifications";
import {
  clearPartnerLedgerSourceEntries,
  PARTNER_LEDGER_SORDER,
  PARTNER_LEDGER_SOURCE_PROFIT_DISTRIBUTION,
  replacePartnerLedgerSourceEntries,
  type PartnerLedgerEntryInput,
} from "@/lib/partner-ledger";
import {
  AMOUNT_TOLERANCE,
  computeCarryForward,
  formatPeriodLabel,
  getPeriodBounds,
  getPeriodKey,
  getPeriodProfitSummary,
  isClosedPeriod,
  roundMoney,
  SHARE_PERCENT_TOLERANCE,
} from "@/lib/profit-distribution";
import { requirePermission } from "@/lib/require-auth";
import { getThailandDateKey, parseDateOnlyToStartOfDay } from "@/lib/th-date";

const MAX_DOCNO_RETRIES = 3;
const MAX_PARTNERS_PER_RUN = 20;

const itemSchema = z.object({
  partnerProfileId: z.string().min(1),
  sharePercent: z.number().min(0).max(100),
  shareAmount: z.number().min(0),
  note: z.string().max(200).optional(),
});

const createSchema = z.object({
  periodKey: z.string().regex(/^\d{4}-\d{2}$/, "งวดไม่ถูกต้อง"),
  payDate: z.string().min(1, "กรุณาระบุวันที่โอนเงิน"),
  cashBankAccountId: z.string().min(1, "กรุณาเลือกบัญชีที่จ่ายออก"),
  distributedAmount: z.number().positive("ยอดที่แบ่งต้องมากกว่า 0"),
  note: z.string().max(500).optional(),
  items: z
    .array(itemSchema)
    .min(1, "ต้องมีผู้ร่วมทุนอย่างน้อย 1 คน")
    .max(MAX_PARTNERS_PER_RUN, `ระบุผู้ร่วมทุนได้ไม่เกิน ${MAX_PARTNERS_PER_RUN} คนต่อรอบ`),
});

const cancelSchema = z.object({
  distributionId: z.string().min(1),
  cancelNote: z.string().max(200).optional(),
});

const partnerSchema = z.object({
  userId: z.string().min(1, "กรุณาเลือกผู้ใช้"),
  defaultSharePercent: z.number().min(0).max(100),
  bankName: z.string().max(100).optional(),
  bankAccountNo: z.string().max(50).optional(),
  joinedAt: z.string().min(1, "กรุณาระบุวันที่เริ่มร่วมทุน"),
  note: z.string().max(300).optional(),
  isActive: z.boolean(),
});

type ActionResult = {
  success?: boolean;
  error?: string;
  distributionId?: string;
  distributionNo?: string;
};

function isUniqueConstraintError(error: unknown, target: string): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  if ((error as { code: string }).code !== "P2002") return false;

  const meta = (error as { meta?: { target?: string[] | string } }).meta;
  const rawTarget = meta?.target;
  const targets = Array.isArray(rawTarget) ? rawTarget : rawTarget ? [rawTarget] : [];
  return targets.some((value) => value.includes(target));
}

function parseNumber(value: FormDataEntryValue | null): number {
  if (typeof value !== "string") return Number.NaN;
  return Number(value.replace(/,/g, "").trim());
}

function parseItems(formData: FormData): unknown {
  const raw = formData.get("items");
  if (typeof raw !== "string") return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function getDistributionAuditSnapshot(distributionId: string) {
  return db.profitDistribution.findUnique({
    where: { id: distributionId },
    include: {
      cashBankAccount: { select: { code: true, name: true, type: true } },
      user: { select: { id: true, name: true } },
      items: {
        orderBy: { lineNo: "asc" },
        select: {
          partnerName: true,
          partnerUserId: true,
          sharePercent: true,
          shareAmount: true,
          note: true,
        },
      },
    },
  });
}

function revalidateDistributionPaths(): void {
  // NOTE: no revalidateProfitDashboardCache() here on purpose. A profit
  // distribution never writes to FactProfit, so net profit — for this month or
  // any other — cannot have changed. Only cash movement is affected.
  revalidatePath("/admin/profit-distributions");
  revalidatePath("/admin/cash-bank");
  revalidatePath("/admin/cash-bank/ledger");
}

/**
 * Declares one month's profit distribution and pays it out in full.
 *
 * All money figures are recomputed on the server; the client only proposes how
 * the distributable amount is split. The period being declared drives every
 * profit report, while `payDate` drives the cash movement — which is why
 * back-keying July on 1 August cannot disturb August's net profit.
 */
export async function createProfitDistribution(formData: FormData): Promise<ActionResult> {
  const session = await requirePermission("profit_distributions.create").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const requestContext = await getRequestContext();
  const parsed = createSchema.safeParse({
    periodKey: formData.get("periodKey"),
    payDate: formData.get("payDate"),
    cashBankAccountId: formData.get("cashBankAccountId"),
    distributedAmount: parseNumber(formData.get("distributedAmount")),
    note: formData.get("note") || undefined,
    items: parseItems(formData),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const input = parsed.data;
  const [periodYear, periodMonth] = input.periodKey.split("-").map(Number);
  const periodLabel = formatPeriodLabel(periodYear, periodMonth);

  if (periodMonth < 1 || periodMonth > 12) return { error: "งวดไม่ถูกต้อง" };
  if (!isClosedPeriod(periodYear, periodMonth)) {
    return { error: "ประกาศแบ่งกำไรได้เฉพาะเดือนที่จบไปแล้ว เพราะกำไรของเดือนที่ยังไม่จบยังไม่นิ่ง" };
  }

  const { start: periodStart, end: periodEnd } = getPeriodBounds(periodYear, periodMonth);
  const payDate = parseDateOnlyToStartOfDay(input.payDate);
  const todayStart = parseDateOnlyToStartOfDay(getThailandDateKey());

  if (payDate < periodStart) {
    return { error: "วันที่โอนเงินต้องไม่ก่อนวันเริ่มงวดที่แบ่ง" };
  }
  if (payDate > todayStart) {
    return { error: "วันที่โอนเงินต้องไม่เป็นวันในอนาคต" };
  }

  const existingActive = await db.profitDistribution.findUnique({
    where: { activePeriodKey: getPeriodKey(periodYear, periodMonth) },
    select: { distributionNo: true },
  });
  if (existingActive) {
    return { error: `งวด ${periodLabel} มีเอกสาร ${existingActive.distributionNo} อยู่แล้ว` };
  }

  // Recompute every money figure server-side — the client is never trusted.
  const [summary, carryForward] = await Promise.all([
    getPeriodProfitSummary(periodYear, periodMonth),
    computeCarryForward(periodYear, periodMonth),
  ]);
  const snapshotNetProfit = roundMoney(summary.netProfitAmount);
  const distributableBase = roundMoney(snapshotNetProfit + carryForward.amount);

  if (distributableBase <= 0) {
    return {
      error: `งวด ${periodLabel} ไม่มีกำไรให้แบ่ง (ฐานที่แบ่งได้ ${distributableBase.toLocaleString("th-TH")} บาท) ยอดนี้จะถูกยกไปหักในเดือนถัดไปโดยอัตโนมัติ`,
    };
  }

  const distributedAmount = roundMoney(input.distributedAmount);
  if (distributedAmount > distributableBase + AMOUNT_TOLERANCE) {
    return { error: "ยอดที่แบ่งต้องไม่เกินฐานที่แบ่งได้" };
  }
  const retainedAmount = roundMoney(distributableBase - distributedAmount);

  const percentTotal = roundMoney(input.items.reduce((sum, item) => sum + item.sharePercent, 0));
  if (Math.abs(percentTotal - 100) > SHARE_PERCENT_TOLERANCE) {
    return { error: `สัดส่วนรวมต้องเท่ากับ 100% (ตอนนี้ ${percentTotal}%)` };
  }

  const amountTotal = roundMoney(input.items.reduce((sum, item) => sum + item.shareAmount, 0));
  if (Math.abs(amountTotal - distributedAmount) > AMOUNT_TOLERANCE) {
    return { error: "ยอดรวมของผู้ร่วมทุนไม่ตรงกับยอดที่แบ่ง" };
  }

  const partnerProfileIds = [...new Set(input.items.map((item) => item.partnerProfileId))];
  if (partnerProfileIds.length !== input.items.length) {
    return { error: "มีผู้ร่วมทุนซ้ำกันในรายการ" };
  }

  const [partners, account] = await Promise.all([
    db.partnerProfile.findMany({
      where: { id: { in: partnerProfileIds }, isActive: true },
      select: { id: true, userId: true, user: { select: { name: true, isActive: true } } },
    }),
    db.cashBankAccount.findUnique({
      where: { id: input.cashBankAccountId },
      select: { id: true, isActive: true },
    }),
  ]);

  if (!account?.isActive) return { error: "ไม่พบบัญชีเงินสด/ธนาคารที่เลือก หรือบัญชีถูกปิดใช้งาน" };

  const partnerById = new Map(partners.map((partner) => [partner.id, partner]));
  const missingPartner = partnerProfileIds.find((id) => !partnerById.get(id)?.user.isActive);
  if (missingPartner) return { error: "มีผู้ร่วมทุนที่ถูกปิดใช้งานอยู่ในรายการ" };

  try {
    const created = await dbTx(async (tx) => {
      let distributionNo = "";
      let distributionId = "";

      for (let attempt = 0; attempt < MAX_DOCNO_RETRIES; attempt += 1) {
        distributionNo = await generateProfitDistributionNo();
        try {
          const row = await tx.profitDistribution.create({
            data: {
              distributionNo,
              periodYear,
              periodMonth,
              activePeriodKey: getPeriodKey(periodYear, periodMonth),
              periodStart,
              periodEnd,
              payDate,
              cashBankAccountId: input.cashBankAccountId,
              userId: session.user.id,
              snapshotSalesAmount: roundMoney(summary.salesAmountExVat),
              snapshotCostAmount: roundMoney(summary.costAmount),
              snapshotExpenseAmount: roundMoney(summary.expenseAmount),
              snapshotGrossProfit: roundMoney(summary.grossProfit),
              snapshotNetProfit,
              carryForwardAmount: carryForward.amount,
              distributableBase,
              distributedAmount,
              retainedAmount,
              note: input.note ?? null,
              status: DocStatus.ACTIVE,
            },
            select: { id: true },
          });
          distributionId = row.id;
          break;
        } catch (error) {
          if (isUniqueConstraintError(error, "activePeriodKey")) {
            throw new Error("PERIOD_TAKEN");
          }
          if (!isUniqueConstraintError(error, "distributionNo")) throw error;
          if (attempt === MAX_DOCNO_RETRIES - 1) throw error;
        }
      }

      if (!distributionId) throw new Error("DOC_NO_EXHAUSTED");

      await tx.profitDistributionItem.createMany({
        data: input.items.map((item, index) => {
          const partner = partnerById.get(item.partnerProfileId);
          return {
            distributionId,
            lineNo: index + 1,
            partnerProfileId: item.partnerProfileId,
            partnerUserId: partner?.userId ?? "",
            partnerName: partner?.user.name ?? "",
            sharePercent: item.sharePercent,
            shareAmount: roundMoney(item.shareAmount),
            note: item.note ?? null,
          };
        }),
      });

      // Two ledger rows per partner: the entitlement, then the payout that
      // settles it. Balances net to zero while everything is paid in full, but
      // the history is what proves each partner's cumulative stake.
      const ledgerEntries: PartnerLedgerEntryInput[] = input.items.flatMap((item) => [
        {
          partnerProfileId: item.partnerProfileId,
          entryDate: payDate,
          sorder: PARTNER_LEDGER_SORDER.PROFIT_SHARE,
          type: PartnerLedgerType.PROFIT_SHARE,
          amount: roundMoney(item.shareAmount),
          referenceNo: distributionNo,
          note: `ส่วนแบ่งกำไรงวด ${periodLabel}`,
        },
        {
          partnerProfileId: item.partnerProfileId,
          entryDate: payDate,
          sorder: PARTNER_LEDGER_SORDER.PAYOUT,
          type: PartnerLedgerType.PAYOUT,
          amount: -roundMoney(item.shareAmount),
          referenceNo: distributionNo,
          note: `รับเงินส่วนแบ่งกำไรงวด ${periodLabel}`,
        },
      ]);

      await replacePartnerLedgerSourceEntries(
        tx,
        PARTNER_LEDGER_SOURCE_PROFIT_DISTRIBUTION,
        distributionId,
        ledgerEntries,
      );

      await replaceCashBankSourceMovements(
        tx,
        CashBankSourceType.PARTNER_PAYOUT,
        distributionId,
        [
          {
            accountId: input.cashBankAccountId,
            txnDate: payDate,
            direction: CashBankDirection.OUT,
            amount: distributedAmount,
            referenceNo: distributionNo,
            note: `แบ่งกำไรผู้ร่วมทุนงวด ${periodLabel}`,
          },
        ],
      );

      return { distributionId, distributionNo };
    });

    const afterSnapshot = await getDistributionAuditSnapshot(created.distributionId);
    const diff = diffEntity(null, afterSnapshot);
    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: AuditAction.CREATE,
      entityType: "ProfitDistribution",
      entityId: created.distributionId,
      entityRef: created.distributionNo,
      before: diff.before,
      after: diff.after,
      meta: {
        periodKey: getPeriodKey(periodYear, periodMonth),
        carryForwardRows: carryForward.rows.length,
      },
    });

    try {
      await notifyProfitDistributionDeclared({
        distributionId: created.distributionId,
        distributionNo: created.distributionNo,
        periodLabel,
      });
    } catch (error) {
      console.error("[createProfitDistribution] notify failed", error);
    }

    revalidateDistributionPaths();
    return {
      success: true,
      distributionId: created.distributionId,
      distributionNo: created.distributionNo,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "PERIOD_TAKEN") {
      return { error: `งวด ${periodLabel} เพิ่งถูกประกาศไปแล้ว กรุณารีเฟรชหน้าจอ` };
    }
    console.error("[createProfitDistribution]", error);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

/**
 * Cancels a distribution: reverses the cash movement, wipes the partner ledger
 * rows, and frees the period so it can be declared again. FactProfit is never
 * touched because it was never written to.
 */
export async function cancelProfitDistribution(formData: FormData): Promise<ActionResult> {
  const session = await requirePermission("profit_distributions.cancel").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const requestContext = await getRequestContext();
  const parsed = cancelSchema.safeParse({
    distributionId: formData.get("distributionId"),
    cancelNote: formData.get("cancelNote") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const beforeSnapshot = await getDistributionAuditSnapshot(parsed.data.distributionId);
  if (!beforeSnapshot) return { error: "ไม่พบเอกสาร" };
  if (beforeSnapshot.status === DocStatus.CANCELLED) return { error: "เอกสารถูกยกเลิกแล้ว" };

  const periodLabel = formatPeriodLabel(beforeSnapshot.periodYear, beforeSnapshot.periodMonth);

  try {
    await dbTx(async (tx) => {
      await clearCashBankSourceMovements(
        tx,
        CashBankSourceType.PARTNER_PAYOUT,
        beforeSnapshot.id,
      );
      await clearPartnerLedgerSourceEntries(
        tx,
        PARTNER_LEDGER_SOURCE_PROFIT_DISTRIBUTION,
        beforeSnapshot.id,
      );
      await tx.profitDistribution.update({
        where: { id: beforeSnapshot.id },
        data: {
          status: DocStatus.CANCELLED,
          // Releases the period so it can be declared again.
          activePeriodKey: null,
          cancelledAt: new Date(),
          cancelNote: parsed.data.cancelNote ?? null,
        },
      });
    });

    const afterSnapshot = await getDistributionAuditSnapshot(beforeSnapshot.id);
    const diff = diffEntity(beforeSnapshot, afterSnapshot);
    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: AuditAction.CANCEL,
      entityType: "ProfitDistribution",
      entityId: beforeSnapshot.id,
      entityRef: beforeSnapshot.distributionNo,
      before: diff.before,
      after: diff.after,
      meta: { cancelNote: parsed.data.cancelNote ?? null },
    });

    try {
      await notifyProfitDistributionCancelled({
        distributionId: beforeSnapshot.id,
        distributionNo: beforeSnapshot.distributionNo,
        periodLabel,
      });
    } catch (error) {
      console.error("[cancelProfitDistribution] notify failed", error);
    }

    revalidateDistributionPaths();
    return { success: true };
  } catch (error) {
    console.error("[cancelProfitDistribution]", error);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

/**
 * Creates or updates a partner profile and flips the owning user to
 * `userType = PARTNER`. Permissions are untouched — being a partner is a
 * business classification, not an access level.
 */
export async function savePartnerProfile(formData: FormData): Promise<ActionResult> {
  const session = await requirePermission("profit_distributions.partners.manage").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const requestContext = await getRequestContext();
  const parsed = partnerSchema.safeParse({
    userId: formData.get("userId"),
    defaultSharePercent: parseNumber(formData.get("defaultSharePercent")),
    bankName: formData.get("bankName") || undefined,
    bankAccountNo: formData.get("bankAccountNo") || undefined,
    joinedAt: formData.get("joinedAt"),
    note: formData.get("note") || undefined,
    isActive: formData.get("isActive") === "1",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const input = parsed.data;
  const targetUser = await db.user.findUnique({
    where: { id: input.userId },
    select: { id: true, name: true },
  });
  if (!targetUser) return { error: "ไม่พบผู้ใช้ที่เลือก" };

  const beforeSnapshot = await db.partnerProfile.findUnique({
    where: { userId: input.userId },
    include: { user: { select: { name: true, userType: true } } },
  });

  try {
    await dbTx(async (tx) => {
      await tx.partnerProfile.upsert({
        where: { userId: input.userId },
        create: {
          userId: input.userId,
          defaultSharePercent: input.defaultSharePercent,
          bankName: input.bankName ?? null,
          bankAccountNo: input.bankAccountNo ?? null,
          joinedAt: parseDateOnlyToStartOfDay(input.joinedAt),
          note: input.note ?? null,
          isActive: input.isActive,
        },
        update: {
          defaultSharePercent: input.defaultSharePercent,
          bankName: input.bankName ?? null,
          bankAccountNo: input.bankAccountNo ?? null,
          joinedAt: parseDateOnlyToStartOfDay(input.joinedAt),
          note: input.note ?? null,
          isActive: input.isActive,
        },
      });

      await tx.user.update({
        where: { id: input.userId },
        data: { userType: "PARTNER" },
      });
    });

    const afterSnapshot = await db.partnerProfile.findUnique({
      where: { userId: input.userId },
      include: { user: { select: { name: true, userType: true } } },
    });
    const diff = diffEntity(beforeSnapshot, afterSnapshot);
    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: beforeSnapshot ? AuditAction.UPDATE : AuditAction.CREATE,
      entityType: "PartnerProfile",
      entityId: afterSnapshot?.id ?? null,
      entityRef: targetUser.name,
      before: diff.before,
      after: diff.after,
    });

    revalidatePath("/admin/profit-distributions");
    revalidatePath("/admin/profit-distributions/partners");
    return { success: true };
  } catch (error) {
    console.error("[savePartnerProfile]", error);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
