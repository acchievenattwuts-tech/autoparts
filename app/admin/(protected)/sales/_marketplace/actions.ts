"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, dbTx } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import {
  generateCashBankAdjustmentNo,
  generateCashBankTransferNo,
  generateExpenseNo,
  generateMarketplaceSettlementNo,
} from "@/lib/doc-number";
import {
  getMarketplaceChannelConfig,
  isManualMarketplaceChannel,
  type ManualMarketplaceChannel,
} from "@/lib/marketplace/config";
import {
  calculateMarketplaceSettlement,
  round2,
  SETTLEMENT_TOLERANCE,
} from "@/lib/marketplace/settlement-math";
import { parseDateOnlyToDate } from "@/lib/th-date";
import { clearCashBankSourceMovements, replaceCashBankSourceMovements } from "@/lib/cash-bank";
import { rebuildMarketplaceSettlementProfitFacts } from "@/lib/profit-fact";
import { revalidateProfitDashboardCache } from "@/lib/profit-cache";
import {
  notifyMarketplaceSettlementCancelled,
  notifyMarketplaceSettlementRecorded,
} from "@/lib/notifications";
import {
  AuditAction,
  CashBankAdjustmentStatus,
  CashBankDirection,
  CashBankSourceType,
  CashBankTransferStatus,
  CNSettlementType,
  DocStatus,
  MarketplaceFeeKind,
  MarketplaceSettlementDocType,
  Prisma,
  SaleChannel,
  VatType,
} from "@/lib/generated/prisma";
import { getAuditActorFromSession, getRequestContext, safeWriteAuditLog } from "@/lib/audit-log";

const channelSchema = z
  .nativeEnum(SaleChannel)
  .refine(isManualMarketplaceChannel, { message: "ช่องทางขายไม่รองรับการคีย์เอง" });

/** ตัวแทน session ที่ผ่านเงื่อนไขเสมอ ใช้เมื่อรอบนั้นไม่ต้องสร้างใบปรับยอดเงิน */
const SESSION_NOT_REQUIRED = { user: { id: "n/a" } } as const;

function revalidateChannelPaths(channel: ManualMarketplaceChannel): void {
  const { slug } = getMarketplaceChannelConfig(channel);
  revalidatePath("/admin");
  revalidatePath("/admin/sales");
  revalidatePath(`/admin/sales/${slug}/settlements`);
  revalidatePath("/admin/marketplace/settlements");
  revalidatePath("/admin/reports/marketplace");
}

// ─────────────────────────────────────────────────────────────
// ตั้งค่าช่องทาง
// ─────────────────────────────────────────────────────────────

const setupSchema = z.object({
  channel: channelSchema,
  settlementCashBankAccountId: z.string().min(1),
  defaultCustomerId: z.string().min(1),
});

export async function saveMarketplaceChannelSetting(formData: FormData) {
  const session = await requirePermission("marketplace.manage").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = setupSchema.safeParse({
    channel: formData.get("channel"),
    settlementCashBankAccountId: formData.get("settlementCashBankAccountId"),
    defaultCustomerId: formData.get("defaultCustomerId"),
  });
  if (!parsed.success) return { error: "กรุณาเลือกบัญชีพักเงินและลูกค้าเริ่มต้น" };
  const { settlementCashBankAccountId, defaultCustomerId } = parsed.data;
  const channel = parsed.data.channel as ManualMarketplaceChannel;

  try {
    const [account, customer, conflicting] = await Promise.all([
      db.cashBankAccount.findFirst({
        where: { id: settlementCashBankAccountId, isActive: true },
        select: { id: true },
      }),
      db.customer.findFirst({
        where: { id: defaultCustomerId, isActive: true },
        select: {
          id: true,
          customerType: {
            select: {
              isActive: true,
              priceList: { select: { isActive: true, channel: true, name: true } },
            },
          },
        },
      }),
      db.marketplaceChannelSetting.findFirst({
        where: { settlementCashBankAccountId, channel: { not: channel } },
        select: { channel: true },
      }),
    ]);
    if (!account) return { error: "ไม่พบบัญชีพักเงินที่ใช้งานอยู่" };
    if (!customer) return { error: "ไม่พบลูกค้าเริ่มต้นที่ใช้งานอยู่" };
    if (!customer.customerType?.isActive || !customer.customerType.priceList?.isActive) {
      return { error: "ลูกค้าเริ่มต้นต้องผูกประเภทลูกค้าและ Price List ที่เปิดใช้งาน" };
    }
    if (customer.customerType.priceList.channel !== channel) {
      return {
        error: `Price List ของลูกค้าเริ่มต้นต้องเป็นช่องทาง ${getMarketplaceChannelConfig(channel).label}`,
      };
    }
    // ถ้าสองช่องทางใช้บัญชีพักเงินใบเดียวกัน ยอดค้างรับจะแยกกันไม่ออก และการกระทบยอด
    // ของช่องทางหนึ่งจะดูดยอดของอีกช่องทางไปด้วย
    if (conflicting) {
      const label = isManualMarketplaceChannel(conflicting.channel)
        ? getMarketplaceChannelConfig(conflicting.channel).label
        : conflicting.channel;
      return { error: `บัญชีพักเงินนี้ถูกใช้กับช่องทาง ${label} แล้ว กรุณาเลือกบัญชีอื่น` };
    }

    const saved = await db.marketplaceChannelSetting.upsert({
      where: { channel },
      create: { channel, settlementCashBankAccountId, defaultCustomerId, isActive: true },
      update: { settlementCashBankAccountId, defaultCustomerId, isActive: true },
      select: { id: true },
    });

    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...(await getRequestContext()),
      action: AuditAction.UPDATE,
      entityType: "MarketplaceChannelSetting",
      entityId: saved.id,
      entityRef: channel,
      after: { channel, settlementCashBankAccountId, defaultCustomerId },
    });

    revalidateChannelPaths(channel);
    revalidatePath(`/admin/sales/${getMarketplaceChannelConfig(channel).slug}/new`);
    return { success: true };
  } catch (error) {
    console.error("[marketplace] CHANNEL_SETTING_SAVE_FAILED", error);
    return { error: "บันทึกการตั้งค่าไม่สำเร็จ" };
  }
}

// ─────────────────────────────────────────────────────────────
// รอบรับเงิน
// ─────────────────────────────────────────────────────────────

const feeLineSchema = z.object({
  code: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(100),
  kind: z.nativeEnum(MarketplaceFeeKind),
  /** ยอดมีเครื่องหมาย: ลบ = ถูกหักจากยอดโอน, บวก = แพลตฟอร์มจ่ายเพิ่ม */
  amount: z
    .number()
    .refine((value) => Math.abs(value) >= 0.01, { message: "ยอดของแต่ละรายการต้องไม่เป็นศูนย์" }),
});

const createSettlementSchema = z.object({
  channel: channelSchema,
  settlementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payoutRef: z.string().trim().min(1).max(100),
  destinationAccountId: z.string().min(1),
  payoutAmount: z.number().positive(),
  saleIds: z.array(z.string().min(1)).max(300).default([]),
  creditNoteIds: z.array(z.string().min(1)).max(300).default([]),
  lines: z.array(feeLineSchema).max(40).default([]),
  note: z.string().trim().max(500).optional(),
});

/** รอบรับเงินสร้างเอกสารการเงินหลายใบ จึงต้องมีสิทธิ์ครบทุกใบที่จะถูกสร้าง */
async function requireSettlementPermissions(needsAdjustment: boolean) {
  const sessions = await Promise.all([
    requirePermission("marketplace.manage").catch(() => null),
    requirePermission("expenses.create").catch(() => null),
    requirePermission("cash_bank.transfers.create").catch(() => null),
    needsAdjustment
      ? requirePermission("cash_bank.adjustments.create").catch(() => null)
      : Promise.resolve(SESSION_NOT_REQUIRED),
  ]);
  return sessions.every((session) => session?.user?.id) ? sessions[0] : null;
}

/**
 * สร้าง/หา ExpenseCode ของค่าธรรมเนียมช่องทาง เพื่อให้รายงานค่าใช้จ่ายแยกประเภทได้
 * โดยผู้ใช้ไม่ต้องไปสร้างรหัสเองล่วงหน้า
 */
async function ensureFeeExpenseCodes(
  tx: Prisma.TransactionClient,
  channel: ManualMarketplaceChannel,
  labels: string[],
): Promise<Map<string, string>> {
  const config = getMarketplaceChannelConfig(channel);
  const names = [...new Set(labels)].map((label) => `${config.label} — ${label}`);
  const existing = await tx.expenseCode.findMany({
    where: { name: { in: names } },
    select: { id: true, name: true },
  });
  const result = new Map(existing.map((item) => [item.name, item.id]));
  if (result.size === names.length) return result;

  const used = await tx.expenseCode.findMany({
    where: { code: { startsWith: config.feeExpenseCodePrefix } },
    select: { code: true },
  });
  let next =
    used.reduce(
      (max, item) => Math.max(max, Number(item.code.slice(config.feeExpenseCodePrefix.length)) || 0),
      0,
    ) + 1;

  for (const name of names) {
    if (result.has(name)) continue;
    const created = await tx.expenseCode.create({
      data: {
        code: `${config.feeExpenseCodePrefix}${String(next).padStart(3, "0")}`,
        name,
        description: `ค่าธรรมเนียม ${config.label} จากการกระทบยอดแบบคีย์เอง`,
      },
      select: { id: true },
    });
    next += 1;
    result.set(name, created.id);
  }
  return result;
}

export async function createMarketplaceSettlement(payload: unknown) {
  const parsed = createSettlementSchema.safeParse(payload);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const input = parsed.data;
  const channel = input.channel as ManualMarketplaceChannel;
  const config = getMarketplaceChannelConfig(channel);

  const hasIncomeLine = input.lines.some((line) => line.amount > 0);
  const session = await requireSettlementPermissions(hasIncomeLine);
  if (!session?.user?.id) {
    return { error: "ต้องมีสิทธิ์จัดการช่องทางขาย เพิ่มค่าใช้จ่าย โอนเงิน และปรับยอดเงิน" };
  }

  const setting = await db.marketplaceChannelSetting.findFirst({
    where: { channel, isActive: true },
    select: { id: true, settlementCashBankAccountId: true },
  });
  if (!setting) return { error: `ยังไม่ได้ตั้งค่าบัญชีพักเงินของ ${config.label}` };
  const holdingAccountId = setting.settlementCashBankAccountId;
  if (holdingAccountId === input.destinationAccountId) {
    return { error: "บัญชีปลายทางต้องไม่ใช่บัญชีพักเงินของช่องทางนี้" };
  }

  const saleIds = [...new Set(input.saleIds)];
  const creditNoteIds = [...new Set(input.creditNoteIds)];
  if (saleIds.length === 0 && creditNoteIds.length === 0) {
    return { error: "กรุณาเลือกใบขายหรือใบลดหนี้อย่างน้อย 1 รายการ" };
  }

  const [sales, creditNotes] = await Promise.all([
    db.sale.findMany({
      where: {
        id: { in: saleIds },
        channel,
        status: DocStatus.ACTIVE,
        cashBankAccountId: holdingAccountId,
        marketplaceSettlementLines: { none: { activeSaleId: { not: null } } },
      },
      select: { id: true, saleNo: true, saleDate: true, netAmount: true },
    }),
    db.creditNote.findMany({
      where: {
        id: { in: creditNoteIds },
        channel,
        status: DocStatus.ACTIVE,
        settlementType: CNSettlementType.CASH_REFUND,
        cashBankAccountId: holdingAccountId,
        marketplaceSettlementLines: { none: { activeCreditNoteId: { not: null } } },
      },
      select: { id: true, cnNo: true, cnDate: true, totalAmount: true },
    }),
  ]);
  if (sales.length !== saleIds.length || creditNotes.length !== creditNoteIds.length) {
    return { error: "มีเอกสารบางรายการไม่พร้อมกระทบยอดหรือถูกเลือกไปแล้ว กรุณาโหลดหน้าใหม่" };
  }

  const calculation = calculateMarketplaceSettlement({
    saleAmounts: sales.map((sale) => Number(sale.netAmount)),
    returnAmounts: creditNotes.map((creditNote) => Number(creditNote.totalAmount)),
    feeLines: input.lines,
    payoutAmount: input.payoutAmount,
  });
  if (!calculation.isBalanced) {
    return {
      error: `ยอดเงินเข้าจริงไม่ตรงกับที่คำนวณได้ ผลต่าง ${calculation.difference.toFixed(2)} บาท`,
    };
  }
  if (calculation.expectedPayout <= SETTLEMENT_TOLERANCE) {
    return { error: "ยอดที่ควรได้รับต้องมากกว่า 0 บาท จึงจะบันทึกการโอนเงินได้" };
  }

  const docDate = parseDateOnlyToDate(input.settlementDate);
  const [settlementNo, transferNo, expenseNo, adjustNo] = await Promise.all([
    generateMarketplaceSettlementNo(config.settlementDocPrefix, docDate),
    generateCashBankTransferNo(docDate),
    calculation.feeAmount > 0 ? generateExpenseNo(docDate) : Promise.resolve(null),
    calculation.incomeAmount > 0 ? generateCashBankAdjustmentNo(docDate) : Promise.resolve(null),
  ]);

  const deductionLines = input.lines.filter((line) => line.amount < 0);
  const incomeLines = input.lines.filter((line) => line.amount > 0);

  try {
    let createdSettlementId = "";
    await dbTx(async (tx) => {
      const destination = await tx.cashBankAccount.findFirst({
        where: { id: input.destinationAccountId, isActive: true, type: "BANK" },
        select: { id: true },
      });
      if (!destination) throw new Error("DESTINATION_NOT_FOUND");

      let expenseId: string | null = null;
      if (calculation.feeAmount > 0) {
        const codeIds = await ensureFeeExpenseCodes(
          tx,
          channel,
          deductionLines.map((line) => line.label),
        );
        const expense = await tx.expense.create({
          data: {
            expenseNo: expenseNo as string,
            expenseDate: docDate,
            userId: session.user!.id!,
            cashBankAccountId: holdingAccountId,
            channel,
            totalAmount: calculation.feeAmount,
            subtotalAmount: calculation.feeAmount,
            netAmount: calculation.feeAmount,
            vatType: VatType.NO_VAT,
            vatRate: 0,
            vatAmount: 0,
            note: `ค่าธรรมเนียม ${config.label} รอบ ${settlementNo}`,
            items: {
              create: deductionLines.map((line, index) => ({
                lineNo: index + 1,
                expenseCodeId: codeIds.get(`${config.label} — ${line.label}`) as string,
                description: `${line.label} (${input.payoutRef})`,
                amount: Math.abs(line.amount),
              })),
            },
          },
          select: { id: true },
        });
        expenseId = expense.id;
        await replaceCashBankSourceMovements(tx, CashBankSourceType.EXPENSE, expense.id, [
          {
            accountId: holdingAccountId,
            txnDate: docDate,
            direction: CashBankDirection.OUT,
            amount: calculation.feeAmount,
            referenceNo: expenseNo as string,
            note: `${config.label} fees ${settlementNo}`,
          },
        ]);
        // ไม่เรียก rebuildExpenseProfitFacts เพราะรอบรับเงินเป็นผู้เขียน FactProfit ของ
        // ใบนี้เอง โดยลงวันที่ตามใบขายแต่ละใบแทนวันที่ของใบค่าใช้จ่าย
      }

      let adjustmentId: string | null = null;
      if (calculation.incomeAmount > 0) {
        const adjustment = await tx.cashBankAdjustment.create({
          data: {
            adjustNo: adjustNo as string,
            adjustDate: docDate,
            accountId: holdingAccountId,
            direction: CashBankDirection.IN,
            amount: calculation.incomeAmount,
            reason: `รายรับพิเศษ ${config.label} รอบ ${settlementNo}`,
            note: incomeLines.map((line) => `${line.label} ${line.amount.toFixed(2)}`).join(", "),
            userId: session.user!.id!,
          },
          select: { id: true },
        });
        adjustmentId = adjustment.id;
        await replaceCashBankSourceMovements(tx, CashBankSourceType.ADJUSTMENT, adjustment.id, [
          {
            accountId: holdingAccountId,
            txnDate: docDate,
            direction: CashBankDirection.IN,
            amount: calculation.incomeAmount,
            referenceNo: adjustNo as string,
            note: `${config.label} income ${settlementNo}`,
          },
        ]);
      }

      const transfer = await tx.cashBankTransfer.create({
        data: {
          transferNo,
          transferDate: docDate,
          fromAccountId: holdingAccountId,
          toAccountId: input.destinationAccountId,
          amount: calculation.expectedPayout,
          note: `${config.label} payout ${input.payoutRef}`,
          userId: session.user!.id!,
        },
        select: { id: true },
      });
      await replaceCashBankSourceMovements(tx, CashBankSourceType.TRANSFER, transfer.id, [
        {
          accountId: holdingAccountId,
          txnDate: docDate,
          direction: CashBankDirection.OUT,
          amount: calculation.expectedPayout,
          referenceNo: transferNo,
          note: `${config.label} payout ${input.payoutRef}`,
        },
        {
          accountId: input.destinationAccountId,
          txnDate: docDate,
          direction: CashBankDirection.IN,
          amount: calculation.expectedPayout,
          referenceNo: transferNo,
          note: `${config.label} payout ${input.payoutRef}`,
        },
      ]);

      const created = await tx.marketplaceSettlement.create({
        data: {
          settlementNo,
          channel,
          payoutRef: input.payoutRef,
          settlementDate: docDate,
          channelSettingId: setting.id,
          sourceAccountId: holdingAccountId,
          destinationAccountId: input.destinationAccountId,
          salesAmount: calculation.salesAmount,
          returnAmount: calculation.returnAmount,
          feeAmount: calculation.feeAmount,
          incomeAmount: calculation.incomeAmount,
          payoutAmount: calculation.expectedPayout,
          expenseId,
          cashBankAdjustmentId: adjustmentId,
          cashBankTransferId: transfer.id,
          note: input.note || null,
          userId: session.user!.id!,
          lines: {
            create: [
              ...sales.map((sale) => ({
                docType: MarketplaceSettlementDocType.SALE,
                saleId: sale.id,
                activeSaleId: sale.id,
                docNo: sale.saleNo,
                docDate: sale.saleDate,
                amount: round2(Number(sale.netAmount)),
              })),
              ...creditNotes.map((creditNote) => ({
                docType: MarketplaceSettlementDocType.CREDIT_NOTE,
                creditNoteId: creditNote.id,
                activeCreditNoteId: creditNote.id,
                docNo: creditNote.cnNo,
                docDate: creditNote.cnDate,
                amount: round2(-Number(creditNote.totalAmount)),
              })),
            ],
          },
          fees: {
            create: input.lines.map((line, index) => ({
              lineNo: index + 1,
              kind: line.kind,
              feeCode: line.code,
              label: line.label,
              amount: round2(line.amount),
            })),
          },
        },
        select: { id: true },
      });
      createdSettlementId = created.id;

      await rebuildMarketplaceSettlementProfitFacts(tx, created.id);
    });

    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...(await getRequestContext()),
      action: AuditAction.CREATE,
      entityType: "MarketplaceSettlement",
      entityId: createdSettlementId,
      entityRef: settlementNo,
      after: {
        channel,
        payoutRef: input.payoutRef,
        salesAmount: calculation.salesAmount,
        returnAmount: calculation.returnAmount,
        feeAmount: calculation.feeAmount,
        incomeAmount: calculation.incomeAmount,
        payoutAmount: calculation.expectedPayout,
        saleIds: sales.map((sale) => sale.id),
        creditNoteIds: creditNotes.map((creditNote) => creditNote.id),
      },
    });

    try {
      await notifyMarketplaceSettlementRecorded({
        settlementId: createdSettlementId,
        settlementNo,
        channelLabel: config.label,
        payoutAmount: calculation.expectedPayout.toLocaleString("th-TH", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
        feeAmount: calculation.feeAmount.toLocaleString("th-TH", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
      });
    } catch (notifyError) {
      console.error("[marketplace] SETTLEMENT_NOTIFY_FAILED", notifyError);
    }

    revalidateProfitDashboardCache();
    revalidateChannelPaths(channel);
    revalidatePath("/admin/credit-notes");
    revalidatePath("/admin/expenses");
    revalidatePath("/admin/cash-bank");
    return { success: true, settlementNo };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "เลขอ้างอิงการรับเงินนี้ถูกบันทึกแล้ว หรือมีเอกสารถูกกระทบยอดซ้ำ" };
    }
    if (error instanceof Error && error.message === "DESTINATION_NOT_FOUND") {
      return { error: "ไม่พบบัญชีธนาคารปลายทางที่ใช้งานอยู่" };
    }
    console.error("[marketplace] SETTLEMENT_CREATE_FAILED", error);
    return { error: "บันทึกการกระทบยอดไม่สำเร็จ" };
  }
}

export async function cancelMarketplaceSettlement(settlementId: string, cancelNote: string) {
  const note = cancelNote.trim();
  if (!note) return { error: "กรุณาระบุเหตุผลที่ยกเลิก" };

  const before = await db.marketplaceSettlement.findUnique({
    where: { id: settlementId },
    select: {
      settlementNo: true,
      status: true,
      channel: true,
      payoutRef: true,
      cashBankAdjustmentId: true,
    },
  });
  if (!before) return { error: "ไม่พบรอบรับเงิน" };
  if (before.status === DocStatus.CANCELLED) return { error: "รอบรับเงินนี้ถูกยกเลิกไปแล้ว" };
  if (!isManualMarketplaceChannel(before.channel)) return { error: "ช่องทางขายไม่รองรับ" };
  const channel = before.channel;
  const config = getMarketplaceChannelConfig(channel);

  const permissions = await Promise.all([
    requirePermission("marketplace.manage").catch(() => null),
    requirePermission("expenses.cancel").catch(() => null),
    requirePermission("cash_bank.transfers.cancel").catch(() => null),
    before.cashBankAdjustmentId
      ? requirePermission("cash_bank.adjustments.cancel").catch(() => null)
      : Promise.resolve(SESSION_NOT_REQUIRED),
  ]);
  if (!permissions.every((item) => item?.user?.id)) {
    return {
      error: "ไม่มีสิทธิ์ยกเลิกรอบรับเงิน (ต้องมีสิทธิ์ยกเลิกค่าใช้จ่าย โอนเงิน และปรับยอดเงิน)",
    };
  }
  const session = permissions[0];
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์ยกเลิกรอบรับเงิน" };

  try {
    await dbTx(async (tx) => {
      const settlement = await tx.marketplaceSettlement.findUnique({
        where: { id: settlementId },
        select: {
          status: true,
          expenseId: true,
          cashBankTransferId: true,
          cashBankAdjustmentId: true,
        },
      });
      if (!settlement || settlement.status !== DocStatus.ACTIVE) throw new Error("NOT_ACTIVE");
      const cancelledAt = new Date();

      await clearCashBankSourceMovements(
        tx,
        CashBankSourceType.TRANSFER,
        settlement.cashBankTransferId,
      );
      await tx.cashBankTransfer.update({
        where: { id: settlement.cashBankTransferId },
        data: { status: CashBankTransferStatus.CANCELLED, cancelledAt, cancelNote: note },
      });

      if (settlement.expenseId) {
        await clearCashBankSourceMovements(tx, CashBankSourceType.EXPENSE, settlement.expenseId);
        await tx.expense.update({
          where: { id: settlement.expenseId },
          data: { status: DocStatus.CANCELLED, cancelledAt, cancelNote: note },
        });
      }

      if (settlement.cashBankAdjustmentId) {
        await clearCashBankSourceMovements(
          tx,
          CashBankSourceType.ADJUSTMENT,
          settlement.cashBankAdjustmentId,
        );
        await tx.cashBankAdjustment.update({
          where: { id: settlement.cashBankAdjustmentId },
          data: { status: CashBankAdjustmentStatus.CANCELLED, cancelledAt, cancelNote: note },
        });
      }

      // ปลดล็อกเอกสารให้กลับมาเลือกกระทบยอดรอบใหม่ได้ โดยยังเก็บประวัติว่าเคยอยู่รอบไหน
      await tx.marketplaceSettlementLine.updateMany({
        where: { settlementId },
        data: { activeSaleId: null, activeCreditNoteId: null },
      });
      await tx.marketplaceSettlement.update({
        where: { id: settlementId },
        data: { status: DocStatus.CANCELLED, cancelledAt, cancelNote: note },
      });

      await rebuildMarketplaceSettlementProfitFacts(tx, settlementId);
    });

    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...(await getRequestContext()),
      action: AuditAction.CANCEL,
      entityType: "MarketplaceSettlement",
      entityId: settlementId,
      entityRef: before.settlementNo,
      before,
      after: { ...before, status: DocStatus.CANCELLED },
      meta: { cancelNote: note },
    });

    try {
      await notifyMarketplaceSettlementCancelled({
        settlementId,
        settlementNo: before.settlementNo,
        channelLabel: config.label,
        cancelNote: note,
      });
    } catch (notifyError) {
      console.error("[marketplace] SETTLEMENT_CANCEL_NOTIFY_FAILED", notifyError);
    }

    revalidateProfitDashboardCache();
    revalidateChannelPaths(channel);
    revalidatePath("/admin/credit-notes");
    revalidatePath("/admin/expenses");
    revalidatePath("/admin/cash-bank");
    return { success: true };
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_ACTIVE") {
      return { error: "รอบรับเงินนี้ถูกยกเลิกไปแล้ว" };
    }
    console.error("[marketplace] SETTLEMENT_CANCEL_FAILED", error);
    return { error: "ยกเลิกรอบรับเงินไม่สำเร็จ" };
  }
}
