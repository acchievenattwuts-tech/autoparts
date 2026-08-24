"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, dbTx } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { generateCashBankTransferNo, generateExpenseNo, generateShopeeSettlementNo } from "@/lib/doc-number";
import { calculateShopeeSettlement, SHOPEE_SETTLEMENT_FEE_OPTIONS } from "@/lib/shopee/manual";
import { parseDateOnlyToDate } from "@/lib/th-date";
import { clearCashBankSourceMovements, replaceCashBankSourceMovements } from "@/lib/cash-bank";
import { rebuildExpenseProfitFacts } from "@/lib/profit-fact";
import { revalidateProfitDashboardCache } from "@/lib/profit-cache";
import { CashBankDirection, CashBankSourceType, CashBankTransferStatus, DocStatus, Prisma, SaleChannel, VatType } from "@/lib/generated/prisma";
import { AuditAction } from "@/lib/generated/prisma";
import { getAuditActorFromSession, getRequestContext, safeWriteAuditLog } from "@/lib/audit-log";

const feeSchema = z.object({
  code: z.enum(SHOPEE_SETTLEMENT_FEE_OPTIONS.map((option) => option.code) as [string, ...string[]]),
  label: z.string().trim().min(1).max(100),
  amount: z.number().positive(),
});
const createSchema = z.object({
  settlementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payoutRef: z.string().trim().min(1).max(100),
  destinationAccountId: z.string().min(1),
  payoutAmount: z.number().positive(),
  saleIds: z.array(z.string().min(1)).min(1).max(200),
  fees: z.array(feeSchema).max(20),
  note: z.string().trim().max(500).optional(),
});

async function requireSettlementCreatePermissions() {
  const sessions = await Promise.all([
    requirePermission("marketplace.manage").catch(() => null),
    requirePermission("expenses.create").catch(() => null),
    requirePermission("cash_bank.transfers.create").catch(() => null),
  ]);
  return sessions.every((session) => session?.user?.id) ? sessions[0] : null;
}

async function ensureFeeCodes(tx: Prisma.TransactionClient, labels: string[]) {
  const names = labels.map((label) => `Shopee — ${label}`);
  const existing = await tx.expenseCode.findMany({ where: { name: { in: names } }, select: { id: true, name: true } });
  const result = new Map(existing.map((item) => [item.name, item.id]));
  if (result.size === names.length) return result;
  const used = await tx.expenseCode.findMany({ where: { code: { startsWith: "SHP" } }, select: { code: true } });
  let next = used.reduce((max, item) => Math.max(max, Number(item.code.slice(3)) || 0), 0) + 1;
  for (const name of names) {
    if (result.has(name)) continue;
    const created = await tx.expenseCode.create({ data: { code: `SHP${String(next++).padStart(3, "0")}`, name, description: "ค่าธรรมเนียม Shopee จากการกระทบยอดแบบคีย์เอง" }, select: { id: true } });
    result.set(name, created.id);
  }
  return result;
}

export async function createShopeeSettlement(payload: unknown) {
  const session = await requireSettlementCreatePermissions();
  if (!session?.user?.id) return { error: "ต้องมีสิทธิ์ Shopee, เพิ่มค่าใช้จ่าย และโอนเงินระหว่างบัญชี" };
  const parsed = createSchema.safeParse(payload);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const input = parsed.data;
  const shop = await db.shopeeShop.findFirst({ where: { manualMode: true }, orderBy: { createdAt: "asc" }, select: { id: true, settlementCashBankAccountId: true } });
  if (!shop?.settlementCashBankAccountId) return { error: "ยังไม่ได้ตั้งค่าบัญชีพักเงิน Shopee" };
  if (shop.settlementCashBankAccountId === input.destinationAccountId) return { error: "บัญชีปลายทางต้องไม่ใช่บัญชีพักเงิน Shopee" };

  const sales = await db.sale.findMany({
    where: { id: { in: [...new Set(input.saleIds)] }, channel: SaleChannel.SHOPEE, status: DocStatus.ACTIVE, shopeeSettlementLines: { none: { activeSaleId: { not: null } } } },
    select: { id: true, saleNo: true, netAmount: true, cashBankAccountId: true },
  });
  if (sales.length !== new Set(input.saleIds).size) return { error: "มีใบขายบางรายการไม่พร้อมกระทบยอดหรือถูกเลือกไปแล้ว กรุณาโหลดหน้าใหม่" };
  if (sales.some((sale) => sale.cashBankAccountId !== shop.settlementCashBankAccountId)) return { error: "บัญชีพักเงินของใบขายไม่ตรงกับการตั้งค่าปัจจุบัน" };
  const salesAmount = sales.reduce((sum, sale) => sum + Number(sale.netAmount), 0);
  const calculation = calculateShopeeSettlement(salesAmount, input.fees.map((fee) => fee.amount), input.payoutAmount);
  if (Math.abs(calculation.difference) > 0.005) return { error: `ยอดรับจริงไม่ตรงกัน ผลต่าง ${calculation.difference.toFixed(2)} บาท` };

  const docDate = parseDateOnlyToDate(input.settlementDate);
  const [settlementNo, transferNo, expenseNo] = await Promise.all([
    generateShopeeSettlementNo(docDate), generateCashBankTransferNo(docDate), calculation.feeAmount > 0 ? generateExpenseNo(docDate) : Promise.resolve(null),
  ]);
  try {
    let createdSettlementId = "";
    await dbTx(async (tx) => {
      const destination = await tx.cashBankAccount.findFirst({ where: { id: input.destinationAccountId, isActive: true, type: "BANK" }, select: { id: true } });
      if (!destination) throw new Error("DESTINATION_NOT_FOUND");
      let expenseId: string | null = null;
      if (calculation.feeAmount > 0) {
        const codeIds = await ensureFeeCodes(tx, input.fees.map((fee) => fee.label));
        const expense = await tx.expense.create({ data: {
          expenseNo: expenseNo!, expenseDate: docDate, userId: session.user!.id!, cashBankAccountId: shop.settlementCashBankAccountId,
          channel: SaleChannel.SHOPEE, totalAmount: calculation.feeAmount, subtotalAmount: calculation.feeAmount,
          netAmount: calculation.feeAmount, vatType: VatType.NO_VAT, vatRate: 0, vatAmount: 0,
          note: `ค่าธรรมเนียม Shopee รอบ ${settlementNo}`,
          items: { create: input.fees.map((fee, index) => ({ lineNo: index + 1, expenseCodeId: codeIds.get(`Shopee — ${fee.label}`)!, description: `${fee.label} (${input.payoutRef})`, amount: fee.amount })) },
        } });
        expenseId = expense.id;
        await replaceCashBankSourceMovements(tx, CashBankSourceType.EXPENSE, expense.id, [{ accountId: shop.settlementCashBankAccountId!, txnDate: docDate, direction: CashBankDirection.OUT, amount: calculation.feeAmount, referenceNo: expenseNo!, note: `Shopee fees ${settlementNo}` }]);
        await rebuildExpenseProfitFacts(tx, expense.id);
      }
      const transfer = await tx.cashBankTransfer.create({ data: { transferNo, transferDate: docDate, fromAccountId: shop.settlementCashBankAccountId!, toAccountId: input.destinationAccountId, amount: calculation.expectedPayout, note: `Shopee payout ${input.payoutRef}`, userId: session.user!.id! } });
      await replaceCashBankSourceMovements(tx, CashBankSourceType.TRANSFER, transfer.id, [
        { accountId: shop.settlementCashBankAccountId!, txnDate: docDate, direction: CashBankDirection.OUT, amount: calculation.expectedPayout, referenceNo: transferNo, note: `Shopee payout ${input.payoutRef}` },
        { accountId: input.destinationAccountId, txnDate: docDate, direction: CashBankDirection.IN, amount: calculation.expectedPayout, referenceNo: transferNo, note: `Shopee payout ${input.payoutRef}` },
      ]);
      const created = await tx.shopeeSettlement.create({ data: {
        settlementNo, payoutRef: input.payoutRef, settlementDate: docDate, shopRecordId: shop.id,
        sourceAccountId: shop.settlementCashBankAccountId!, destinationAccountId: input.destinationAccountId,
        salesAmount: calculation.salesAmount, feeAmount: calculation.feeAmount, payoutAmount: calculation.expectedPayout,
        expenseId, cashBankTransferId: transfer.id, note: input.note || null, userId: session.user!.id!,
        sales: { create: sales.map((sale) => ({ saleId: sale.id, activeSaleId: sale.id, saleAmount: sale.netAmount })) },
        fees: { create: input.fees.map((fee, index) => ({ lineNo: index + 1, feeCode: fee.code, label: fee.label, amount: fee.amount })) },
      } });
      createdSettlementId = created.id;
    });
    await safeWriteAuditLog({ ...getAuditActorFromSession(session), ...(await getRequestContext()), action: AuditAction.CREATE, entityType: "ShopeeSettlement", entityId: createdSettlementId, entityRef: settlementNo, after: { payoutRef: input.payoutRef, salesAmount: calculation.salesAmount, feeAmount: calculation.feeAmount, payoutAmount: calculation.expectedPayout, saleIds: sales.map((sale) => sale.id) } });
    revalidateProfitDashboardCache();
    revalidatePath("/admin"); revalidatePath("/admin/sales"); revalidatePath("/admin/sales/shopee/settlements"); revalidatePath("/admin/reports/shopee");
    return { success: true, settlementNo };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { error: "เลขอ้างอิงรับเงินนี้ถูกบันทึกแล้ว หรือมีรายการถูกกระทบยอดซ้ำ" };
    return { error: error instanceof Error && error.message === "DESTINATION_NOT_FOUND" ? "ไม่พบบัญชีปลายทางที่ใช้งานอยู่" : "บันทึกการกระทบยอดไม่สำเร็จ" };
  }
}

export async function cancelShopeeSettlement(settlementId: string, cancelNote: string) {
  const permissions = await Promise.all([
    requirePermission("marketplace.manage").catch(() => null), requirePermission("expenses.cancel").catch(() => null), requirePermission("cash_bank.transfers.cancel").catch(() => null),
  ]);
  if (!permissions.every((item) => item?.user?.id)) return { error: "ไม่มีสิทธิ์ยกเลิกการกระทบยอด" };
  if (!cancelNote.trim()) return { error: "กรุณาระบุเหตุผลที่ยกเลิก" };
  try {
    const before = await db.shopeeSettlement.findUnique({ where: { id: settlementId }, select: { settlementNo: true, status: true, payoutRef: true } });
    await dbTx(async (tx) => {
      const settlement = await tx.shopeeSettlement.findUnique({ where: { id: settlementId }, select: { status: true, expenseId: true, cashBankTransferId: true } });
      if (!settlement || settlement.status === DocStatus.CANCELLED) throw new Error("NOT_ACTIVE");
      await clearCashBankSourceMovements(tx, CashBankSourceType.TRANSFER, settlement.cashBankTransferId);
      await tx.cashBankTransfer.update({ where: { id: settlement.cashBankTransferId }, data: { status: CashBankTransferStatus.CANCELLED, cancelledAt: new Date(), cancelNote: cancelNote.trim() } });
      if (settlement.expenseId) {
        await clearCashBankSourceMovements(tx, CashBankSourceType.EXPENSE, settlement.expenseId);
        await tx.expense.update({ where: { id: settlement.expenseId }, data: { status: DocStatus.CANCELLED, cancelledAt: new Date(), cancelNote: cancelNote.trim() } });
        await rebuildExpenseProfitFacts(tx, settlement.expenseId);
      }
      await tx.shopeeSettlementSale.updateMany({ where: { settlementId }, data: { activeSaleId: null } });
      await tx.shopeeSettlement.update({ where: { id: settlementId }, data: { status: DocStatus.CANCELLED, cancelledAt: new Date(), cancelNote: cancelNote.trim() } });
    });
    if (before) await safeWriteAuditLog({ ...getAuditActorFromSession(permissions[0]!), ...(await getRequestContext()), action: AuditAction.CANCEL, entityType: "ShopeeSettlement", entityId: settlementId, entityRef: before.settlementNo, before, after: { ...before, status: "CANCELLED" }, meta: { cancelNote: cancelNote.trim() } });
    revalidateProfitDashboardCache(); revalidatePath("/admin/sales/shopee/settlements"); revalidatePath("/admin/reports/shopee");
    return { success: true };
  } catch { return { error: "ยกเลิกการกระทบยอดไม่สำเร็จ" }; }
}
