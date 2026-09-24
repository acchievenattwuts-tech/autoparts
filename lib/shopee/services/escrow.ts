import { db, dbTx } from "@/lib/db";
import { generateExpenseNo } from "@/lib/doc-number";
import { isDatabaseLayerError, isUniqueViolationOn, withDocNumberRetry } from "@/lib/doc-number-retry";
import {
  CashBankDirection,
  CashBankSourceType,
  Prisma,
  SaleChannel,
  VatType,
} from "@/lib/generated/prisma";
import { getMarketplaceHoldingAccountId } from "@/lib/marketplace/queries";
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
      escrowExpense: { select: { id: true, expenseNo: true, status: true } },
    },
  });
  if (!order) return null;
  return buildShopeeFeeExpenseDraftFromOrderImport(
    order,
    await getMarketplaceHoldingAccountId(SaleChannel.SHOPEE),
  );
}

export function buildShopeeFeeExpenseDraftFromOrderImport(
  order: ShopeeFeeExpenseDraftOrderImport,
  /** บัญชีพักเงินของช่องทาง — ย้ายมาอยู่ที่การตั้งค่า marketplace แล้ว */
  settlementAccountId: string | null,
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
  if (!settlementAccountId) {
    blockers.push("ยังไม่ได้ตั้งบัญชีพักเงิน Shopee");
  }
  if (lines.length === 0) {
    blockers.push("ยังไม่มี escrow_detail ใน snapshot ที่รองรับ ต้องรอ sync/live payload ที่ยืนยันแล้ว");
  }

  return {
    orderImportId: order.id,
    orderSn: order.orderSn,
    lines,
    totalAmount,
    settlementAccountId,
    existingExpense: order.escrowExpense,
    blockers,
    lastError: order.escrowLastError,
  };
}

/** Namespaces the advisory-lock key so it never shares a hash input with a doc-number sequence. */
const FEE_EXPENSE_LOCK_KEY_PREFIX = "shopee-fee-expense:";

type ExistingFeeExpense = { id: string; expenseNo: string };

/**
 * Serializes fee-expense creation per Shopee order import until the caller's
 * transaction ends, then re-reads the linked expense under that lock. The draft
 * check before the transaction is only a fast path: two requests for the same
 * order (double click, two tabs, two admins) could both see no expense and both
 * create one — the later link then overwrites escrowExpenseId and the earlier
 * expense stays ACTIVE with its cash/bank OUT movement and profit facts, but
 * unlinked. With the lock, the later request waits, sees the ACTIVE expense and
 * reuses it. An advisory lock (not a row lock) is used so this flow takes no new
 * row lock on ShopeeOrderImport ahead of the Expense/CashBankMovement writes.
 */
async function lockShopeeFeeExpenseOrder(
  tx: ShopeeEscrowTx,
  orderImportId: string,
): Promise<ExistingFeeExpense | null> {
  const lockKey = `${FEE_EXPENSE_LOCK_KEY_PREFIX}${orderImportId}`;
  // $executeRaw, not $queryRaw: pg_advisory_xact_lock() returns void (see lib/doc-number.ts).
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
  const order = await tx.shopeeOrderImport.findUnique({
    where: { id: orderImportId },
    select: { escrowExpense: { select: { id: true, expenseNo: true, status: true } } },
  });
  const existing = order?.escrowExpense;
  if (!existing || existing.status === "CANCELLED") return null;
  return { id: existing.id, expenseNo: existing.expenseNo };
}

/** Every freshly generated expenseNo was taken by a concurrent expense save. */
export const SHOPEE_FEE_EXPENSE_NUMBER_CONFLICT_MESSAGE =
  "เลขที่ค่าใช้จ่ายชนกับรายการที่บันทึกพร้อมกัน ระบบลองออกเลขใหม่แล้วยังไม่สำเร็จ กรุณากดสร้าง Expense ค่า Shopee อีกครั้ง";
export const SHOPEE_FEE_EXPENSE_FAILED_MESSAGE = "สร้าง Expense ค่า Shopee ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

/** Message stored in escrowLastError and shown to the user; Prisma/DB error text stays server-side. */
function toShopeeFeeExpenseErrorMessage(error: unknown): string {
  if (isUniqueViolationOn(error, "expenseNo")) return SHOPEE_FEE_EXPENSE_NUMBER_CONFLICT_MESSAGE;
  if (error instanceof Error && !isDatabaseLayerError(error)) return error.message;
  return SHOPEE_FEE_EXPENSE_FAILED_MESSAGE;
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
  let expenseNo = "";
  let createdExpenseId = "";

  try {
    // expenseNo is "latest + 1" generated outside the transaction, so a concurrent
    // expense save anywhere can take the same number (P2002 on expenseNo). The WHOLE
    // transaction is re-run with a fresh number — per-order lock, re-read, insert and
    // dependent writes — because Postgres aborts the transaction after the failed insert.
    const reusedExpense = await withDocNumberRetry({
      uniqueField: "expenseNo",
      generate: () => generateExpenseNo(expenseDate),
      run: (nextExpenseNo) => {
        expenseNo = nextExpenseNo;
        createdExpenseId = "";
        return dbTx(async (tx): Promise<ExistingFeeExpense | null> => {
          const existingExpense = await lockShopeeFeeExpenseOrder(tx, draft.orderImportId);
          if (existingExpense) return existingExpense;

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
          return null;
        });
      },
    });

    if (reusedExpense) {
      return { ok: true, expenseId: reusedExpense.id, expenseNo: reusedExpense.expenseNo, reused: true };
    }
    return { ok: true, expenseId: createdExpenseId, expenseNo, reused: false };
  } catch (error) {
    const message = toShopeeFeeExpenseErrorMessage(error);
    await db.shopeeOrderImport.update({
      where: { id: params.orderImportId },
      data: { escrowLastError: message },
    }).catch(() => undefined);
    console.error("[shopee] create fee expense failed:", error);
    return { ok: false, error: message };
  }
}
