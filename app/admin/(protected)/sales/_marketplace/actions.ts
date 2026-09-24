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
import { isUniqueViolationOn, isUniqueViolationOnAny, withDocNumberRetry } from "@/lib/doc-number-retry";
import { ensureExpenseCodesByName } from "@/lib/auto-expense-code";
import {
  getMarketplaceChannelConfig,
  isManualMarketplaceChannel,
  type ManualMarketplaceChannel,
} from "@/lib/marketplace/config";
import {
  buildMarketplacePayoutDifferenceLine,
  calculateMarketplaceSettlement,
  normalizeMarketplaceLineAmount,
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
  DocStatus,
  MarketplaceFeeKind,
  MarketplaceSettlementDocType,
  Prisma,
  SaleChannel,
  VatType,
} from "@/lib/generated/prisma";
import { getAuditActorFromSession, getRequestContext, safeWriteAuditLog } from "@/lib/audit-log";
import {
  buildEligibleSettlementCreditNoteWhere,
  buildEligibleSettlementSaleWhere,
  lockAndRevalidateSettlementDocuments,
  MarketplaceSettlementDocumentsChangedError,
} from "./settlement-document-lock";

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
      return { error: "ลูกค้าเริ่มต้นต้องผูกประเภทลูกค้าและระดับราคาที่เปิดใช้งาน" };
    }
    if (customer.customerType.priceList.channel !== channel) {
      return {
        error: `ระดับราคาของลูกค้าเริ่มต้นต้องเป็นช่องทาง ${getMarketplaceChannelConfig(channel).label}`,
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
}).transform((line) => ({
  ...line,
  amount: normalizeMarketplaceLineAmount(line.kind, line.amount),
}));

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
 *
 * Runs OUTSIDE the settlement transaction (lib/auto-expense-code.ts): two first
 * settlements at the same moment no longer collide on ExpenseCode.code inside it.
 */
async function ensureFeeExpenseCodes(
  channel: ManualMarketplaceChannel,
  labels: string[],
): Promise<Map<string, string>> {
  const config = getMarketplaceChannelConfig(channel);
  const prefix = config.feeExpenseCodePrefix;
  return ensureExpenseCodesByName(
    [...new Set(labels)].map((label) => ({
      name: `${config.label} — ${label}`,
      description: `ค่าธรรมเนียม ${config.label} จากการกระทบยอดแบบคีย์เอง`,
    })),
    async (client, count) => {
      const used = await client.expenseCode.findMany({
        where: { code: { startsWith: prefix } },
        select: { code: true },
      });
      const next =
        used.reduce((max, item) => Math.max(max, Number(item.code.slice(prefix.length)) || 0), 0) + 1;
      return Array.from({ length: count }, (_, index) => `${prefix}${String(next + index).padStart(3, "0")}`);
    },
  );
}

/**
 * คู่ค้าของค่าธรรมเนียม marketplace ใช้ชื่อช่องทางตามที่เจ้าของระบบกำหนด
 * และจงใจไม่เติมรหัส/เลขภาษี/ข้อมูลติดต่อที่ยังไม่ได้รับการยืนยัน
 *
 * Runs OUTSIDE the settlement transaction. The Supplier and its audit row are
 * created in their own short transaction; when a concurrent first settlement
 * created the same Supplier first (P2002 on Supplier.name), its row is re-read
 * and reused instead of failing the settlement.
 */
async function ensureMarketplaceSupplier(
  channel: ManualMarketplaceChannel,
  userId: string,
): Promise<string> {
  const name = getMarketplaceChannelConfig(channel).label;
  const findSupplierId = async (): Promise<string | null> =>
    (await db.supplier.findUnique({ where: { name }, select: { id: true } }))?.id ?? null;

  const existingId = await findSupplierId();
  if (existingId) return existingId;

  try {
    return await dbTx(async (tx) => {
      const created = await tx.supplier.create({
        data: { name },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: AuditAction.CREATE,
          entityType: "Supplier",
          entityId: created.id,
          entityRef: name,
          after: { name },
          meta: { source: "MARKETPLACE_SETTLEMENT" },
        },
      });
      return created.id;
    });
  } catch (error) {
    if (!isUniqueViolationOn(error, "name")) throw error;
    const winnerId = await findSupplierId();
    if (!winnerId) throw error;
    return winnerId;
  }
}

/** Supplier + fee ExpenseCodes a fee Expense needs; created on first use, outside the settlement transaction. */
async function ensureSettlementFeeMasterRows(
  channel: ManualMarketplaceChannel,
  feeLabels: string[],
  userId: string,
): Promise<{ supplierId: string; codeIds: Map<string, string> }> {
  const supplierId = await ensureMarketplaceSupplier(channel, userId);
  const codeIds = await ensureFeeExpenseCodes(channel, feeLabels);
  return { supplierId, codeIds };
}

/**
 * Unique columns filled with numbers generated for each save attempt. A P2002 on
 * one of these means a concurrent save took the same number, so the attempt is
 * retried with fresh numbers. Business uniques ([channel, payoutRef],
 * activeSaleId, activeCreditNoteId) are deliberately not listed.
 */
const SETTLEMENT_DOC_NUMBER_FIELDS = ["settlementNo", "expenseNo", "transferNo", "adjustNo"] as const;
const SETTLEMENT_DOC_NUMBER_CONFLICT_MESSAGE =
  "เลขที่เอกสารชนกับรายการที่บันทึกพร้อมกัน ระบบลองออกเลขใหม่แล้วยังไม่สำเร็จ กรุณาบันทึกอีกครั้ง";

type SettlementDocNumbers = {
  settlementNo: string;
  transferNo: string;
  expenseNo: string | null;
  adjustNo: string | null;
};

async function generateSettlementDocNumbers(
  settlementDocPrefix: string,
  docDate: Date,
  needsExpense: boolean,
  needsAdjustment: boolean,
): Promise<SettlementDocNumbers> {
  const [settlementNo, transferNo, expenseNo, adjustNo] = await Promise.all([
    generateMarketplaceSettlementNo(settlementDocPrefix, docDate),
    generateCashBankTransferNo(docDate),
    needsExpense ? generateExpenseNo(docDate) : Promise.resolve(null),
    needsAdjustment ? generateCashBankAdjustmentNo(docDate) : Promise.resolve(null),
  ]);
  return { settlementNo, transferNo, expenseNo, adjustNo };
}

export async function createMarketplaceSettlement(payload: unknown) {
  const parsed = createSettlementSchema.safeParse(payload);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const input = parsed.data;
  const channel = input.channel as ManualMarketplaceChannel;
  const config = getMarketplaceChannelConfig(channel);

  const marketplaceSession = await requirePermission("marketplace.manage").catch(() => null);
  if (!marketplaceSession?.user?.id) return { error: "ไม่มีสิทธิ์จัดการช่องทางขาย" };

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

  // Fast path only — the authoritative check runs under row locks inside the transaction.
  const [sales, creditNotes] = await Promise.all([
    db.sale.findMany({
      where: buildEligibleSettlementSaleWhere(channel, holdingAccountId, saleIds),
      select: { id: true, saleNo: true, saleDate: true, netAmount: true },
    }),
    db.creditNote.findMany({
      where: buildEligibleSettlementCreditNoteWhere(channel, holdingAccountId, creditNoteIds),
      select: { id: true, cnNo: true, cnDate: true, totalAmount: true },
    }),
  ]);
  if (sales.length !== saleIds.length || creditNotes.length !== creditNoteIds.length) {
    return { error: "มีเอกสารบางรายการไม่พร้อมกระทบยอดหรือถูกเลือกไปแล้ว กรุณาโหลดหน้าใหม่" };
  }

  const actualPayout = round2(input.payoutAmount);
  const baseCalculation = calculateMarketplaceSettlement({
    saleAmounts: sales.map((sale) => Number(sale.netAmount)),
    returnAmounts: creditNotes.map((creditNote) => Number(creditNote.totalAmount)),
    feeLines: input.lines,
    payoutAmount: actualPayout,
  });
  const payoutDifferenceLine = buildMarketplacePayoutDifferenceLine(baseCalculation.difference);
  const payoutDifference = payoutDifferenceLine?.amount ?? 0;
  const settlementFeeLines = payoutDifferenceLine
    ? [...input.lines, payoutDifferenceLine]
    : input.lines;
  const calculation = calculateMarketplaceSettlement({
    saleAmounts: sales.map((sale) => Number(sale.netAmount)),
    returnAmounts: creditNotes.map((creditNote) => Number(creditNote.totalAmount)),
    feeLines: settlementFeeLines,
    payoutAmount: actualPayout,
  });
  if (!calculation.isBalanced) {
    return { error: "ไม่สามารถสร้างรายการส่วนต่างยอดโอนจริงให้ยอดสมดุลได้" };
  }
  if (actualPayout <= SETTLEMENT_TOLERANCE) {
    return { error: "ยอดเงินเข้าจริงต้องมากกว่า 0 บาท จึงจะบันทึกการโอนเงินได้" };
  }

  const hasIncomeLine = settlementFeeLines.some((line) => line.amount > 0);
  const session = await requireSettlementPermissions(hasIncomeLine);
  if (!session?.user?.id) {
    return { error: "ต้องมีสิทธิ์จัดการช่องทางขาย เพิ่มค่าใช้จ่าย โอนเงิน และปรับยอดเงิน" };
  }

  const docDate = parseDateOnlyToDate(input.settlementDate);
  const deductionLines = settlementFeeLines.filter((line) => line.amount < 0);
  const incomeLines = settlementFeeLines.filter((line) => line.amount > 0);

  // The Supplier / fee ExpenseCodes the fee Expense references are found or created
  // BEFORE the settlement transaction, so a concurrent first settlement can no longer
  // abort it with a P2002 on Supplier.name / ExpenseCode.code. Set iff there is a fee.
  let feeMasterRows: { supplierId: string; codeIds: Map<string, string> } | null = null;
  if (calculation.feeAmount > 0) {
    try {
      feeMasterRows = await ensureSettlementFeeMasterRows(
        channel,
        deductionLines.map((line) => line.label),
        session.user!.id!,
      );
    } catch (error) {
      console.error("[marketplace] SETTLEMENT_MASTER_ROWS_FAILED", error);
      return { error: "บันทึกการกระทบยอดไม่สำเร็จ" };
    }
  }

  try {
    let createdSettlementId = "";
    let settlementNo = "";
    // Every number is "latest + 1" read outside the transaction, so a concurrent save
    // can take the same one (P2002 on its column). Postgres aborts the transaction
    // after the failed insert, so the WHOLE transaction — row locks, re-checks and all
    // writes — is re-run with a fresh set of numbers.
    await withDocNumberRetry({
      uniqueField: SETTLEMENT_DOC_NUMBER_FIELDS,
      generate: () =>
        generateSettlementDocNumbers(
          config.settlementDocPrefix,
          docDate,
          calculation.feeAmount > 0,
          calculation.incomeAmount > 0,
        ),
      run: (docNumbers) => {
        const { transferNo, expenseNo, adjustNo } = docNumbers;
        settlementNo = docNumbers.settlementNo;
        createdSettlementId = "";
        return dbTx(async (tx) => {
          // Lock CreditNote → Sale rows and re-check eligibility before any write.
          await lockAndRevalidateSettlementDocuments(tx, { channel, holdingAccountId, sales, creditNotes });

          const destination = await tx.cashBankAccount.findFirst({
            where: { id: input.destinationAccountId, isActive: true, type: "BANK" },
            select: { id: true },
          });
          if (!destination) throw new Error("DESTINATION_NOT_FOUND");

          let expenseId: string | null = null;
          if (feeMasterRows) {
            const { supplierId, codeIds } = feeMasterRows;
            const expense = await tx.expense.create({
              data: {
                expenseNo: expenseNo as string,
                expenseDate: docDate,
                userId: session.user!.id!,
                supplierId,
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
              amount: actualPayout,
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
              amount: actualPayout,
              referenceNo: transferNo,
              note: `${config.label} payout ${input.payoutRef}`,
            },
            {
              accountId: input.destinationAccountId,
              txnDate: docDate,
              direction: CashBankDirection.IN,
              amount: actualPayout,
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
              payoutAmount: actualPayout,
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
                create: settlementFeeLines.map((line, index) => ({
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
      },
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
        payoutAmount: actualPayout,
        payoutDifference,
        saleIds: sales.map((sale) => sale.id),
        creditNoteIds: creditNotes.map((creditNote) => creditNote.id),
      },
    });

    try {
      await notifyMarketplaceSettlementRecorded({
        settlementId: createdSettlementId,
        settlementNo,
        channelLabel: config.label,
        payoutAmount: actualPayout.toLocaleString("th-TH", {
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
    revalidatePath("/admin/master/suppliers");
    revalidatePath("/admin/cash-bank");
    return { success: true, settlementNo, payoutDifference };
  } catch (error) {
    if (error instanceof MarketplaceSettlementDocumentsChangedError) return { error: error.message };
    if (isUniqueViolationOnAny(error, SETTLEMENT_DOC_NUMBER_FIELDS)) {
      console.error("[marketplace] SETTLEMENT_DOC_NUMBER_CONFLICT", error);
      return { error: SETTLEMENT_DOC_NUMBER_CONFLICT_MESSAGE };
    }
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

const SETTLEMENT_NOT_FOUND_MESSAGE = "ไม่พบรอบรับเงิน";
const SETTLEMENT_ALREADY_CANCELLED_MESSAGE = "รอบรับเงินนี้ถูกยกเลิกไปแล้ว";

/** Raised inside the cancel transaction when the settlement is gone or no longer ACTIVE. */
class MarketplaceSettlementNotActiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketplaceSettlementNotActiveError";
  }
}

type LockedMarketplaceSettlement = {
  expenseId: string | null;
  cashBankTransferId: string;
  cashBankAdjustmentId: string | null;
};

/**
 * Locks the settlement row for the rest of the transaction, re-checks that it
 * is still ACTIVE, and returns the generated document ids read under the lock.
 * The status check before the transaction is only a fast path: two cancel
 * requests could both pass it and then both clear the transfer/expense/
 * adjustment cash-bank movements and cancel those documents twice. With the row
 * locked, the second request waits, sees CANCELLED, and stops before any write.
 *
 * Lock order: MarketplaceSettlement FIRST, then (via the writes that follow)
 * CashBankMovement → CashBankTransfer → Expense → CashBankAdjustment →
 * MarketplaceSettlementLine → FactProfit. createMarketplaceSettlement only
 * inserts a new row, and the Expense / CashBankAdjustment mutation guards only
 * READ the settlement. cancelExpense / updateExpense lock Expense first; if this
 * cancel is in flight they still see the settlement ACTIVE (not committed yet)
 * and throw before touching CashBankMovement, so the two never wait on each
 * other in opposite order.
 */
async function lockActiveMarketplaceSettlement(
  tx: Prisma.TransactionClient,
  settlementId: string,
): Promise<LockedMarketplaceSettlement> {
  const rows = await tx.$queryRaw<({ status: string } & LockedMarketplaceSettlement)[]>(Prisma.sql`
    SELECT "status"::text AS "status", "expenseId", "cashBankTransferId", "cashBankAdjustmentId"
    FROM "MarketplaceSettlement"
    WHERE id = ${settlementId}
    FOR UPDATE
  `);
  if (rows.length === 0) throw new MarketplaceSettlementNotActiveError(SETTLEMENT_NOT_FOUND_MESSAGE);
  if (rows[0].status !== DocStatus.ACTIVE) {
    throw new MarketplaceSettlementNotActiveError(SETTLEMENT_ALREADY_CANCELLED_MESSAGE);
  }
  const { expenseId, cashBankTransferId, cashBankAdjustmentId } = rows[0];
  return { expenseId, cashBankTransferId, cashBankAdjustmentId };
}

async function cancelLockedMarketplaceSettlement(
  tx: Prisma.TransactionClient,
  settlementId: string,
  note: string,
): Promise<void> {
  const settlement = await lockActiveMarketplaceSettlement(tx, settlementId);
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
  // Fast path only — the authoritative status check runs under the row lock below.
  if (!before) return { error: SETTLEMENT_NOT_FOUND_MESSAGE };
  if (before.status === DocStatus.CANCELLED) return { error: SETTLEMENT_ALREADY_CANCELLED_MESSAGE };
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
    await dbTx((tx) => cancelLockedMarketplaceSettlement(tx, settlementId, note));

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
    if (error instanceof MarketplaceSettlementNotActiveError) return { error: error.message };
    console.error("[marketplace] SETTLEMENT_CANCEL_FAILED", error);
    return { error: "ยกเลิกรอบรับเงินไม่สำเร็จ" };
  }
}
