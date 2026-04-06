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
  EXPENSE: 40,
  CN_SALE: 50,
  TRANSFER: 60,
  ADJUSTMENT: 70,
};

function uniqueIds(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function toSignedAmount(direction: CashBankDirection, amount: Prisma.Decimal | number): number {
  const numericAmount = Number(amount);
  return direction === CashBankDirection.IN ? numericAmount : -numericAmount;
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

export async function recalculateCashBankAccount(
  tx: TxClient,
  accountId: string,
): Promise<void> {
  const account = await tx.cashBankAccount.findUnique({
    where: { id: accountId },
    select: { openingBalance: true },
  });
  if (!account) return;

  const movements = await tx.cashBankMovement.findMany({
    where: { accountId },
    orderBy: [
      { txnDate: "asc" },
      { sorder: "asc" },
      { createdAt: "asc" },
      { id: "asc" },
    ],
    select: {
      id: true,
      direction: true,
      amount: true,
      balanceAfter: true,
    },
  });

  let runningBalance = Number(account.openingBalance);
  for (const movement of movements) {
    runningBalance += toSignedAmount(movement.direction, movement.amount);
    if (Number(movement.balanceAfter) === runningBalance) continue;

    await tx.cashBankMovement.update({
      where: { id: movement.id },
      data: { balanceAfter: runningBalance },
    });
  }
}

export async function replaceCashBankSourceMovements(
  tx: TxClient,
  sourceType: CashBankSourceType,
  sourceId: string,
  entries: CashBankEntryInput[],
): Promise<void> {
  const oldMovements = await tx.cashBankMovement.findMany({
    where: { sourceType, sourceId },
    select: { accountId: true },
  });

  const nextEntries = entries.filter((entry) => entry.amount > 0);
  await assertCashBankAccountsExist(
    tx,
    nextEntries.map((entry) => entry.accountId),
  );

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

  const affectedAccountIds = uniqueIds([
    ...oldMovements.map((movement) => movement.accountId),
    ...nextEntries.map((entry) => entry.accountId),
  ]);

  for (const accountId of affectedAccountIds) {
    await recalculateCashBankAccount(tx, accountId);
  }
}

export async function clearCashBankSourceMovements(
  tx: TxClient,
  sourceType: CashBankSourceType,
  sourceId: string,
): Promise<void> {
  const oldMovements = await tx.cashBankMovement.findMany({
    where: { sourceType, sourceId },
    select: { accountId: true },
  });

  if (oldMovements.length === 0) return;

  await tx.cashBankMovement.deleteMany({
    where: { sourceType, sourceId },
  });

  const affectedAccountIds = uniqueIds(oldMovements.map((movement) => movement.accountId));
  for (const accountId of affectedAccountIds) {
    await recalculateCashBankAccount(tx, accountId);
  }
}
