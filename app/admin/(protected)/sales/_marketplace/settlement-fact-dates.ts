import { ProfitSourceType, type Prisma } from "@/lib/generated/prisma";

/**
 * Owner decision S2: cancelling a marketplace settlement deactivates the profit facts of its fee
 * Expense (EXPENSE, sourceId = expenseId) and of its platform income (OTHER_INCOME, sourceId =
 * settlement id) wherever they are dated — the settlement date, or (P2 = B) the dates of sales whose
 * month was still open when the settlement was recorded. The cancel's month lock covers those dates
 * too, so a sale month declared after recording needs the override like any other locked cancel.
 *
 * The stored facts are read (not re-planned), so the check follows exactly what the cancel changes.
 * Read-only: the cancel action calls it inside its transaction under the settlement row lock, the
 * history page for its lock preview.
 */

export type SettlementFactOwner = { id: string; expenseId: string | null };

type FactDateReader = Pick<Prisma.TransactionClient, "factProfit">;

/** Distinct business dates of the ACTIVE fee / income facts, per settlement id (one query). */
export async function loadSettlementFactDates(
  client: FactDateReader,
  settlements: readonly SettlementFactOwner[],
): Promise<Map<string, Date[]>> {
  const datesBySettlement = new Map<string, Date[]>();
  if (settlements.length === 0) return datesBySettlement;
  const settlementIdByExpenseId = new Map(
    settlements.flatMap((settlement): Array<[string, string]> =>
      settlement.expenseId ? [[settlement.expenseId, settlement.id]] : [],
    ),
  );
  const sources: Prisma.FactProfitWhereInput[] = [
    { sourceType: ProfitSourceType.OTHER_INCOME, sourceId: { in: settlements.map((settlement) => settlement.id) } },
  ];
  if (settlementIdByExpenseId.size > 0) {
    sources.push({ sourceType: ProfitSourceType.EXPENSE, sourceId: { in: [...settlementIdByExpenseId.keys()] } });
  }
  try {
    const rows = await client.factProfit.findMany({
      where: { isActive: true, OR: sources },
      select: { sourceType: true, sourceId: true, businessDate: true },
      distinct: ["sourceType", "sourceId", "businessDate"],
    });
    for (const row of rows) {
      const settlementId =
        row.sourceType === ProfitSourceType.EXPENSE ? settlementIdByExpenseId.get(row.sourceId) : row.sourceId;
      if (!settlementId) continue;
      datesBySettlement.set(settlementId, [...(datesBySettlement.get(settlementId) ?? []), row.businessDate]);
    }
    return datesBySettlement;
  } catch (error) {
    throw new Error("Failed to load marketplace settlement profit fact dates", { cause: error });
  }
}
