import { CashBankDirection, CashBankSourceType, Prisma } from "@/lib/generated/prisma";

type TxClient = Prisma.TransactionClient;

type CashBankEntryInput = {
  accountId: string;
  txnDate: Date;
  direction: CashBankDirection;
  amount: number;
  referenceNo: string;
  note?: string | null;
  sorder?: number;
};

const DEFAULT_SOURCE_ORDER: Record<CashBankSourceType, number> = {
  SALE: 10,
  RECEIPT: 20,
  PURCHASE: 30,
  SUPPLIER_ADVANCE: 35,
  SUPPLIER_PAYMENT: 36,
  EXPENSE: 40,
  CN_SALE: 50,
  CN_PURCHASE: 55,
  PARTNER_PAYOUT: 58,
  TRANSFER: 60,
  ADJUSTMENT: 70,
};

function uniqueIds(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

async function updateCashBankRunningBalances(
  tx: TxClient,
  accountId: string,
  startingBalance: Prisma.Decimal | number,
  startDate?: Date,
): Promise<void> {
  await tx.$executeRaw`
    WITH ordered AS (
      SELECT
        m.id,
        ${startingBalance}::numeric
          + SUM(
            CASE
              WHEN m.direction = 'IN' THEN m.amount
              ELSE -m.amount
            END
          ) OVER (
            ORDER BY m."txnDate" ASC, m.sorder ASC, m."createdAt" ASC, m.id ASC
          ) AS next_balance
      FROM "CashBankMovement" m
      WHERE m."accountId" = ${accountId}
        AND (${startDate ?? null}::timestamptz IS NULL OR m."txnDate" >= ${startDate ?? null}::timestamptz)
    )
    UPDATE "CashBankMovement" AS m
    SET "balanceAfter" = ordered.next_balance
    FROM ordered
    WHERE m.id = ordered.id
      AND m."balanceAfter" IS DISTINCT FROM ordered.next_balance
  `;
}

export async function assertCashBankAccountsExist(
  tx: TxClient,
  accountIds: string[],
): Promise<void> {
  const normalizedIds = uniqueIds(accountIds);
  if (normalizedIds.length === 0) return;

  const existingAccounts = await tx.cashBankAccount.findMany({
    where: { id: { in: normalizedIds } },
    select: { id: true },
  });
  const existingIds = new Set(existingAccounts.map((account) => account.id));
  const missingId = normalizedIds.find((accountId) => !existingIds.has(accountId));
  if (missingId) {
    throw new Error("ไม่พบบัญชีเงินสด/ธนาคารที่เลือก");
  }
}

async function assertCashBankAccountsCanPost(
  tx: TxClient,
  entries: CashBankEntryInput[],
): Promise<void> {
  const normalizedIds = uniqueIds(entries.map((entry) => entry.accountId));
  if (normalizedIds.length === 0) return;

  const accounts = await tx.cashBankAccount.findMany({
    where: { id: { in: normalizedIds } },
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
      openingDate: true,
    },
  });
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  const missingId = normalizedIds.find((accountId) => !accountById.has(accountId));
  if (missingId) {
    throw new Error("ไม่พบบัญชีเงินสด/ธนาคารที่เลือก");
  }

  for (const entry of entries) {
    const account = accountById.get(entry.accountId);
    if (!account) continue;

    const accountLabel = `${account.code} - ${account.name}`;
    if (!account.isActive) {
      throw new Error(`บัญชีเงินสด/ธนาคาร ${accountLabel} ถูกปิดใช้งานแล้ว`);
    }
    if (entry.txnDate < account.openingDate) {
      throw new Error(`วันที่รายการของบัญชี ${accountLabel} ต้องไม่ก่อนวันที่ยอดยกมา`);
    }
  }
}

export async function recalculateCashBankAccount(
  tx: TxClient,
  accountId: string,
): Promise<void> {
  const account = await tx.cashBankAccount.findUnique({
    where: { id: accountId },
    select: { openingBalance: true },
  });
  if (!account) return;

  await updateCashBankRunningBalances(tx, accountId, account.openingBalance);
}

async function recalculateCashBankAccountFrom(
  tx: TxClient,
  accountId: string,
  startDate: Date,
): Promise<void> {
  const account = await tx.cashBankAccount.findUnique({
    where: { id: accountId },
    select: { openingBalance: true },
  });
  if (!account) return;

  const previousMovement = await tx.cashBankMovement.findFirst({
    where: {
      accountId,
      txnDate: { lt: startDate },
    },
    orderBy: [
      { txnDate: "desc" },
      { sorder: "desc" },
      { createdAt: "desc" },
      { id: "desc" },
    ],
    select: { balanceAfter: true },
  });

  const runningBalance = previousMovement?.balanceAfter ?? account.openingBalance;
  await updateCashBankRunningBalances(tx, accountId, runningBalance, startDate);
}

export async function replaceCashBankSourceMovements(
  tx: TxClient,
  sourceType: CashBankSourceType,
  sourceId: string,
  entries: CashBankEntryInput[],
): Promise<void> {
  const oldMovements = await tx.cashBankMovement.findMany({
    where: { sourceType, sourceId },
    select: { accountId: true, txnDate: true },
  });

  const nextEntries = entries.filter((entry) => entry.amount > 0);
  await assertCashBankAccountsCanPost(tx, nextEntries);

  await tx.cashBankMovement.deleteMany({
    where: { sourceType, sourceId },
  });

  if (nextEntries.length > 0) {
    await tx.cashBankMovement.createMany({
      data: nextEntries.map((entry) => ({
        accountId: entry.accountId,
        txnDate: entry.txnDate,
        sorder: entry.sorder ?? DEFAULT_SOURCE_ORDER[sourceType],
        direction: entry.direction,
        amount: entry.amount,
        balanceAfter: 0,
        sourceType,
        sourceId,
        referenceNo: entry.referenceNo,
        note: entry.note ?? null,
      })),
    });
  }

  const dirtyStartByAccount = new Map<string, Date>();
  for (const movement of oldMovements) {
    const previous = dirtyStartByAccount.get(movement.accountId);
    if (!previous || movement.txnDate < previous) {
      dirtyStartByAccount.set(movement.accountId, movement.txnDate);
    }
  }
  for (const entry of nextEntries) {
    const previous = dirtyStartByAccount.get(entry.accountId);
    if (!previous || entry.txnDate < previous) {
      dirtyStartByAccount.set(entry.accountId, entry.txnDate);
    }
  }

  for (const [accountId, startDate] of dirtyStartByAccount) {
    await recalculateCashBankAccountFrom(tx, accountId, startDate);
  }
}

export async function clearCashBankSourceMovements(
  tx: TxClient,
  sourceType: CashBankSourceType,
  sourceId: string,
): Promise<void> {
  const oldMovements = await tx.cashBankMovement.findMany({
    where: { sourceType, sourceId },
    select: { accountId: true, txnDate: true },
  });

  if (oldMovements.length === 0) return;

  await tx.cashBankMovement.deleteMany({
    where: { sourceType, sourceId },
  });

  const dirtyStartByAccount = new Map<string, Date>();
  for (const movement of oldMovements) {
    const previous = dirtyStartByAccount.get(movement.accountId);
    if (!previous || movement.txnDate < previous) {
      dirtyStartByAccount.set(movement.accountId, movement.txnDate);
    }
  }

  for (const [accountId, startDate] of dirtyStartByAccount) {
    await recalculateCashBankAccountFrom(tx, accountId, startDate);
  }
}
