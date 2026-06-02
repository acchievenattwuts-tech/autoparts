import { db, dbTx } from "@/lib/db";
import { generateExpenseNo } from "@/lib/doc-number";
import { CashBankDirection, CashBankSourceType, Prisma, VatType } from "@/lib/generated/prisma";
import { replaceCashBankSourceMovements } from "@/lib/cash-bank";
import { rebuildExpenseProfitFacts } from "@/lib/profit-fact";
import {
  extractShopeeEscrowFeeLines,
  type ShopeeEscrowFeeKind,
  type ShopeeEscrowFeeLine,
} from "@/lib/shopee/escrow-utils";

type ShopeeEscrowTx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

const EXPENSE_CODE_NAMES: Record<ShopeeEscrowFeeKind, string> = {
  COMMISSION: "Shopee commission fee",
  SERVICE: "Shopee service fee",
  VOUCHER: "Shopee seller voucher",
};

const EXPENSE_CODE_DESCRIPTIONS: Record<ShopeeEscrowFeeKind, string> = {
  COMMISSION: "Auto category for Shopee commission fee from escrow detail",
  SERVICE: "Auto category for Shopee service fee from escrow detail",
  VOUCHER: "Auto category for Shopee seller voucher/discount from escrow detail",
};

export type ShopeeFeeExpenseDraft = {
  orderImportId: string;
  orderSn: string;
  lines: ShopeeEscrowFeeLine[];
  totalAmount: number;
  settlementAccountId: string | null;
  existingExpense: { id: string; expenseNo: string; status: string } | null;
  blockers: string[];
  lastError: string | null;
};

export type ShopeeFeeExpenseDraftOrderImport = {
  id: string;
  orderSn: string;
  saleId: string | null;
  rawPayload: Prisma.JsonValue | null;
  escrowLastError: string | null;
  shop: { settlementCashBankAccountId: string | null };
  escrowExpense: { id: string; expenseNo: string; status: string } | null;
};

export type CreateShopeeFeeExpenseResult =
  | { ok: true; expenseId: string; expenseNo: string; reused: boolean }
  | { ok: false; error: string };

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function nextCode(prefix: string, existingCodes: string[]): string {
  const regex = new RegExp(`^${prefix}(\\d+)$`);
  let max = 0;
  for (const code of existingCodes) {
    const match = code.match(regex);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

async function ensureShopeeExpenseCodes(
  tx: ShopeeEscrowTx,
  kinds: ShopeeEscrowFeeKind[],
): Promise<Map<ShopeeEscrowFeeKind, string>> {
  const uniqueKinds = Array.from(new Set(kinds));
  const names = uniqueKinds.map((kind) => EXPENSE_CODE_NAMES[kind]);
  const existing = await tx.expenseCode.findMany({
    where: { name: { in: names } },
    select: { id: true, code: true, name: true },
  });
  const byName = new Map(existing.map((code) => [code.name, code]));
  const allCodes = await tx.expenseCode.findMany({ select: { code: true } });
  const usedCodes = allCodes.map((code) => code.code);
  const result = new Map<ShopeeEscrowFeeKind, string>();

  for (const kind of uniqueKinds) {
    const name = EXPENSE_CODE_NAMES[kind];
    const existingCode = byName.get(name);
    if (existingCode) {
      result.set(kind, existingCode.id);
      continue;
    }

    const code = nextCode("E", usedCodes);
    usedCodes.push(code);
    const created = await tx.expenseCode.create({
      data: {
        code,
        name,
        description: EXPENSE_CODE_DESCRIPTIONS[kind],
      },
      select: { id: true },
    });
    result.set(kind, created.id);
  }

  return result;
}

export async function buildShopeeFeeExpenseDraft(orderImportId: string): Promise<ShopeeFeeExpenseDraft | null> {
  const order = await db.shopeeOrderImport.findUnique({
    where: { id: orderImportId },
    select: {
      id: true,
      orderSn: true,
      saleId: true,
      rawPayload: true,
      escrowLastError: true,
      shop: { select: { settlementCashBankAccountId: true } },
      escrowExpense: { select: { id: true, expenseNo: true, status: true } },
    },
  });
  if (!order) return null;
  return buildShopeeFeeExpenseDraftFromOrderImport(order);
}

export function buildShopeeFeeExpenseDraftFromOrderImport(
  order: ShopeeFeeExpenseDraftOrderImport,
): ShopeeFeeExpenseDraft {
  const lines = extractShopeeEscrowFeeLines(order.rawPayload);
  const totalAmount = roundMoney(lines.reduce((sum, line) => sum + line.amount, 0));
  const blockers: string[] = [];

  if (order.escrowExpense && order.escrowExpense.status !== "CANCELLED") {
    blockers.push("สร้าง Expense ค่า Shopee ไปแล้ว");
  }
  if (!order.saleId) {
    blockers.push("ต้องสร้างบิลขายจาก Shopee order ก่อน");
  }
  if (!order.shop.settlementCashBankAccountId) {
    blockers.push("ยังไม่ได้ตั้งบัญชี Shopee พักเงิน");
  }
  if (lines.length === 0) {
    blockers.push("ยังไม่มี escrow_detail ใน snapshot ที่รองรับ ต้องรอ sync/live payload ที่ยืนยันแล้ว");
  }

  return {
    orderImportId: order.id,
    orderSn: order.orderSn,
    lines,
    totalAmount,
    settlementAccountId: order.shop.settlementCashBankAccountId,
    existingExpense: order.escrowExpense,
    blockers,
    lastError: order.escrowLastError,
  };
}

export async function createShopeeFeeExpense(params: {
  orderImportId: string;
  userId: string;
}): Promise<CreateShopeeFeeExpenseResult> {
  const draft = await buildShopeeFeeExpenseDraft(params.orderImportId);
  if (!draft) return { ok: false, error: "ไม่พบ Shopee order" };

  if (draft.existingExpense && draft.existingExpense.status !== "CANCELLED") {
    return {
      ok: true,
      expenseId: draft.existingExpense.id,
      expenseNo: draft.existingExpense.expenseNo,
      reused: true,
    };
  }

  const blockingError = draft.blockers.find((blocker) => blocker !== "สร้าง Expense ค่า Shopee ไปแล้ว");
  if (blockingError) {
    await db.shopeeOrderImport.update({
      where: { id: params.orderImportId },
      data: { escrowLastError: blockingError },
    }).catch(() => undefined);
    return { ok: false, error: blockingError };
  }

  const expenseDate = new Date();
  const expenseNo = await generateExpenseNo(expenseDate);
  let createdExpenseId = "";

  try {
    await dbTx(async (tx) => {
      const expenseCodeIds = await ensureShopeeExpenseCodes(tx, draft.lines.map((line) => line.kind));
      const totalAmount = roundMoney(draft.totalAmount);

      const expense = await tx.expense.create({
        data: {
          expenseNo,
          expenseDate,
          userId: params.userId,
          cashBankAccountId: draft.settlementAccountId,
          totalAmount: new Prisma.Decimal(totalAmount),
          subtotalAmount: new Prisma.Decimal(totalAmount),
          vatType: VatType.NO_VAT,
          vatRate: new Prisma.Decimal(0),
          vatAmount: new Prisma.Decimal(0),
          netAmount: new Prisma.Decimal(totalAmount),
          note: `Shopee fees order ${draft.orderSn}`,
          items: {
            create: draft.lines.map((line, index) => {
              const expenseCodeId = expenseCodeIds.get(line.kind);
              if (!expenseCodeId) throw new Error(`missing expense code for ${line.kind}`);
              return {
                lineNo: index + 1,
                expenseCodeId,
                description: `${line.label} (${draft.orderSn})`,
                amount: new Prisma.Decimal(roundMoney(line.amount)),
              };
            }),
          },
        },
      });
      createdExpenseId = expense.id;

      await replaceCashBankSourceMovements(tx, CashBankSourceType.EXPENSE, expense.id, [{
        accountId: draft.settlementAccountId!,
        txnDate: expenseDate,
        direction: CashBankDirection.OUT,
        amount: totalAmount,
        referenceNo: expenseNo,
        note: `Shopee fees ${draft.orderSn}`,
      }]);

      await rebuildExpenseProfitFacts(tx, expense.id);

      await tx.shopeeOrderImport.update({
        where: { id: draft.orderImportId },
        data: {
          escrowExpenseId: expense.id,
          escrowSyncedAt: new Date(),
          escrowLastError: null,
        },
      });
    });

    return { ok: true, expenseId: createdExpenseId, expenseNo, reused: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "สร้าง Expense ค่า Shopee ไม่สำเร็จ";
    await db.shopeeOrderImport.update({
      where: { id: params.orderImportId },
      data: { escrowLastError: message },
    }).catch(() => undefined);
    console.error("[shopee] create fee expense failed:", message);
    return { ok: false, error: message };
  }
}
