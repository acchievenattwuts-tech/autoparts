import { CashBankDirection, CashBankSourceType, Prisma,
} from "@/lib/generated/prisma";

type TxClient = Prisma.TransactionClient;

/**
 * A posting rule the user can fix (missing / inactive account, date before the
 * account opening date). The message is written for users, so callers may show it
 * as-is instead of their generic error text.
 */
export class CashBankPostingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CashBankPostingError";
  }
}

export function isCashBankPostingError(error: unknown): error is CashBankPostingError {
  return error instanceof CashBankPostingError || (error instanceof Error && error.name === "CashBankPostingError");
}

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
  CUSTOMER_ADVANCE: 25,
  CUSTOMER_ADVANCE_REFUND: 26,
  PURCHASE: 30,
  SUPPLIER_ADVANCE: 35,
  SUPPLIER_ADVANCE_REFUND: 37,
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

// Account ids already locked by each open transaction, so repeated posting calls
// inside one transaction do not re-issue the lock. Keyed by the tx client object,
// which lives exactly as long as its transaction.
const lockedCashBankAccountIdsByTx = new WeakMap<TxClient, Set<string>>();

/**
 * Serializes every writer of an account's running balance. Must run before reading
 * or rewriting that account's movements; locks are held until the transaction ends.
 *
 * Accounts are locked in one statement in id order (deadlock-safe among themselves)
 * and always after the caller's document-row locks.
 *
 * FOR NO KEY UPDATE, not FOR UPDATE: posting flows insert rows that reference the
 * account (Sale, DocumentPayment, CashBankTransfer, CashBankMovement…) before they
 * post, and each such FK insert holds FOR KEY SHARE on the account row. FOR UPDATE
 * conflicts with FOR KEY SHARE, so two concurrent postings to one account would each
 * wait for the other's FK lock (deadlock). FOR NO KEY UPDATE still conflicts with
 * itself, which is all the running-balance rewrite needs.
 */
export async function lockCashBankAccountsForPosting(
  tx: TxClient,
  accountIds: string[],
): Promise<void> {
  let lockedIds = lockedCashBankAccountIdsByTx.get(tx);
  if (!lockedIds) {
    lockedIds = new Set<string>();
    lockedCashBankAccountIdsByTx.set(tx, lockedIds);
  }
  const alreadyLocked = lockedIds;
  const pendingIds = uniqueIds(accountIds)
    .filter((accountId) => !alreadyLocked.has(accountId))
    .sort();
  if (pendingIds.length === 0) return;

  await tx.$queryRaw(Prisma.sql`
    SELECT id FROM "CashBankAccount"
    WHERE id IN (${Prisma.join(pendingIds)})
    ORDER BY id
    FOR NO KEY UPDATE
  `);
  for (const accountId of pendingIds) alreadyLocked.add(accountId);
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
  const missingId = normalizedIds.find((accountId) => !existingIds.has(accountId),
  );
  if (missingId) {
    throw new CashBankPostingError("ไม่พบบัญชีเงินสด/ธนาคารที่เลือก");
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

  const missingId = normalizedIds.find((accountId) => !accountById.has(accountId),
  );
  if (missingId) {
    throw new CashBankPostingError("ไม่พบบัญชีเงินสด/ธนาคารที่เลือก");
  }

  for (const entry of entries) {
    const account = accountById.get(entry.accountId);
    if (!account) continue;

    const accountLabel = `${account.code} - ${account.name}`;
    if (!account.isActive) {
      throw new CashBankPostingError(`บัญชีเงินสด/ธนาคาร ${accountLabel} ถูกปิดใช้งานแล้ว`);
    }
    if (entry.txnDate < account.openingDate) {
      throw new CashBankPostingError(`วันที่รายการของบัญชี ${accountLabel} ต้องไม่ก่อนวันที่ยอดยกมา`,
      );
    }
  }
}

export async function recalculateCashBankAccount(
  tx: TxClient,
  accountId: string,
): Promise<void> {
  await lockCashBankAccountsForPosting(tx, [accountId]);
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
  // The source's own rows are guarded by the caller's document lock; lock every
  // account they touch (old and new, e.g. a document moved between accounts)
  // before validating, deleting, inserting, or rebalancing.
  await lockCashBankAccountsForPosting(tx, [
    ...oldMovements.map((movement) => movement.accountId),
    ...nextEntries.map((entry) => entry.accountId),
  ]);
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

  await lockCashBankAccountsForPosting(tx, oldMovements.map((movement) => movement.accountId));
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
