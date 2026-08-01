import { Prisma } from "@/lib/generated/prisma";
import type { PartnerLedgerType } from "@/lib/generated/prisma";

type TxClient = Prisma.TransactionClient;

/**
 * Partner capital ledger — the running record of each partner's stake.
 *
 * Mirrors the CashBankMovement pattern: rows carry a `balanceAfter` that is
 * recomputed from the earliest touched date whenever entries are added or
 * removed, so cancelling an old document never leaves stale balances behind.
 *
 * `amount` is signed: positive increases the partner's capital
 * (CONTRIBUTION / PROFIT_SHARE), negative decreases it (PAYOUT).
 */

export const PARTNER_LEDGER_SOURCE_PROFIT_DISTRIBUTION = "PROFIT_DISTRIBUTION";

/** Ordering within the same day: the profit share must land before the payout. */
export const PARTNER_LEDGER_SORDER = {
  PROFIT_SHARE: 10,
  PAYOUT: 20,
} as const;

export type PartnerLedgerEntryInput = {
  partnerProfileId: string;
  entryDate: Date;
  sorder: number;
  type: PartnerLedgerType;
  /** Signed amount — positive increases capital, negative decreases it. */
  amount: number;
  referenceNo: string;
  note?: string | null;
};

async function updatePartnerRunningBalances(
  tx: TxClient,
  partnerProfileId: string,
  startingBalance: Prisma.Decimal | number,
  startDate?: Date,
): Promise<void> {
  await tx.$executeRaw`
    WITH ordered AS (
      SELECT
        l.id,
        ${startingBalance}::numeric
          + SUM(l.amount) OVER (
            ORDER BY l."entryDate" ASC, l.sorder ASC, l."createdAt" ASC, l.id ASC
          ) AS next_balance
      FROM "PartnerLedger" l
      WHERE l."partnerProfileId" = ${partnerProfileId}
        AND (${startDate ?? null}::timestamptz IS NULL OR l."entryDate" >= ${startDate ?? null}::timestamptz)
    )
    UPDATE "PartnerLedger" AS l
    SET "balanceAfter" = ordered.next_balance
    FROM ordered
    WHERE l.id = ordered.id
      AND l."balanceAfter" IS DISTINCT FROM ordered.next_balance
  `;
}

async function recalculatePartnerLedgerFrom(
  tx: TxClient,
  partnerProfileId: string,
  startDate: Date,
): Promise<void> {
  const previousEntry = await tx.partnerLedger.findFirst({
    where: { partnerProfileId, entryDate: { lt: startDate } },
    orderBy: [
      { entryDate: "desc" },
      { sorder: "desc" },
      { createdAt: "desc" },
      { id: "desc" },
    ],
    select: { balanceAfter: true },
  });

  await updatePartnerRunningBalances(
    tx,
    partnerProfileId,
    previousEntry?.balanceAfter ?? 0,
    startDate,
  );
}

/** Recompute a partner's entire ledger from an opening balance of zero. */
export async function recalculatePartnerLedger(
  tx: TxClient,
  partnerProfileId: string,
): Promise<void> {
  await updatePartnerRunningBalances(tx, partnerProfileId, 0);
}

/**
 * Replaces every ledger row belonging to one source document, then repairs the
 * running balance of each affected partner from the earliest touched date.
 */
export async function replacePartnerLedgerSourceEntries(
  tx: TxClient,
  sourceType: string,
  sourceId: string,
  entries: PartnerLedgerEntryInput[],
): Promise<void> {
  const oldEntries = await tx.partnerLedger.findMany({
    where: { sourceType, sourceId },
    select: { partnerProfileId: true, entryDate: true },
  });

  await tx.partnerLedger.deleteMany({ where: { sourceType, sourceId } });

  const nextEntries = entries.filter((entry) => entry.amount !== 0);
  if (nextEntries.length > 0) {
    await tx.partnerLedger.createMany({
      data: nextEntries.map((entry) => ({
        partnerProfileId: entry.partnerProfileId,
        entryDate: entry.entryDate,
        sorder: entry.sorder,
        type: entry.type,
        amount: entry.amount,
        balanceAfter: 0,
        sourceType,
        sourceId,
        referenceNo: entry.referenceNo,
        note: entry.note ?? null,
      })),
    });
  }

  const dirtyStartByPartner = new Map<string, Date>();
  for (const entry of oldEntries) {
    const previous = dirtyStartByPartner.get(entry.partnerProfileId);
    if (!previous || entry.entryDate < previous) {
      dirtyStartByPartner.set(entry.partnerProfileId, entry.entryDate);
    }
  }
  for (const entry of nextEntries) {
    const previous = dirtyStartByPartner.get(entry.partnerProfileId);
    if (!previous || entry.entryDate < previous) {
      dirtyStartByPartner.set(entry.partnerProfileId, entry.entryDate);
    }
  }

  for (const [partnerProfileId, startDate] of dirtyStartByPartner) {
    await recalculatePartnerLedgerFrom(tx, partnerProfileId, startDate);
  }
}

/** Removes every ledger row of one source document (used when cancelling). */
export async function clearPartnerLedgerSourceEntries(
  tx: TxClient,
  sourceType: string,
  sourceId: string,
): Promise<void> {
  await replacePartnerLedgerSourceEntries(tx, sourceType, sourceId, []);
}
