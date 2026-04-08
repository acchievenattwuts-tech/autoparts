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

  const movements = await tx.cashBankMovement.findMany({
    where: {
      accountId,
      txnDate: { gte: startDate },
    },
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

  let runningBalance = previousMovement
    ? Number(previousMovement.balanceAfter)
    : Number(account.openingBalance);

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
    select: { accountId: true, txnDate: true },
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
