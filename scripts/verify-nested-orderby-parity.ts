/**
 * Confirms the newly added nested orderBy clauses do not reorder anything users
 * already see.
 *
 * For each document-item relation the report/print layers render, this compares
 * the row order Postgres returns without an orderBy against the order the new
 * `lineNo` / `id` clauses produce. Any difference here is a visible change to a
 * printed document, so it must be reviewed rather than assumed.
 *
 * Read-only. Usage: npm run verify:nested-orderby
 */
import { db } from "../lib/db";

type Case = {
  label: string;
  /** Rows in the order Postgres returns them with no explicit ordering. */
  unordered: () => Promise<Array<{ parent: string; key: string }>>;
  /** Rows in the order the new clause produces. */
  ordered: () => Promise<Array<{ parent: string; key: string }>>;
};

const flatten = <T extends { id: string }>(
  parents: Array<{ id: string; items: T[] }>,
): Array<{ parent: string; key: string }> =>
  parents.flatMap((parent) => parent.items.map((item) => ({ parent: parent.id, key: item.id })));

const cases: Case[] = [
  {
    label: "Sale.items",
    unordered: async () =>
      flatten(await db.sale.findMany({ select: { id: true, items: { select: { id: true } } } })),
    ordered: async () =>
      flatten(
        await db.sale.findMany({
          select: { id: true, items: { orderBy: { lineNo: "asc" }, select: { id: true } } },
        }),
      ),
  },
  {
    label: "Purchase.items",
    unordered: async () =>
      flatten(await db.purchase.findMany({ select: { id: true, items: { select: { id: true } } } })),
    ordered: async () =>
      flatten(
        await db.purchase.findMany({
          select: { id: true, items: { orderBy: { lineNo: "asc" }, select: { id: true } } },
        }),
      ),
  },
  {
    label: "CreditNote.items",
    unordered: async () =>
      flatten(await db.creditNote.findMany({ select: { id: true, items: { select: { id: true } } } })),
    ordered: async () =>
      flatten(
        await db.creditNote.findMany({
          select: { id: true, items: { orderBy: { lineNo: "asc" }, select: { id: true } } },
        }),
      ),
  },
  {
    label: "Expense.items",
    unordered: async () =>
      flatten(await db.expense.findMany({ select: { id: true, items: { select: { id: true } } } })),
    ordered: async () =>
      flatten(
        await db.expense.findMany({
          select: { id: true, items: { orderBy: { lineNo: "asc" }, select: { id: true } } },
        }),
      ),
  },
  {
    label: "Receipt.items",
    unordered: async () =>
      flatten(await db.receipt.findMany({ select: { id: true, items: { select: { id: true } } } })),
    ordered: async () =>
      flatten(
        await db.receipt.findMany({
          select: { id: true, items: { orderBy: { lineNo: "asc" }, select: { id: true } } },
        }),
      ),
  },
];

const main = async (): Promise<void> => {
  console.log("=== nested orderBy parity (does the new clause change what users see?) ===\n");
  let differences = 0;

  for (const testCase of cases) {
    const [before, after] = await Promise.all([testCase.unordered(), testCase.ordered()]);
    const same = JSON.stringify(before) === JSON.stringify(after);
    console.log(`  ${same ? "SAME " : "DIFF "} ${testCase.label.padEnd(20)} rows=${before.length}`);
    if (!same) {
      differences += 1;
      const firstDiff = before.findIndex((row, index) => JSON.stringify(row) !== JSON.stringify(after[index]));
      console.log(`        first difference at row ${firstDiff} (parent ${before[firstDiff]?.parent})`);
    }
  }

  // lotItems are ordered by id, which is what the unordered read already
  // returned in insertion order — compare directly.
  const lotBefore = await db.saleItemLot.findMany({ select: { saleItemId: true, id: true } });
  const lotAfter = await db.saleItemLot.findMany({
    orderBy: { id: "asc" },
    select: { saleItemId: true, id: true },
  });
  const lotGrouped = (rows: Array<{ saleItemId: string; id: string }>) => {
    const map = new Map<string, string[]>();
    for (const row of rows) {
      if (!map.has(row.saleItemId)) map.set(row.saleItemId, []);
      map.get(row.saleItemId)!.push(row.id);
    }
    return map;
  };
  const beforeMap = lotGrouped(lotBefore);
  const afterMap = lotGrouped(lotAfter);
  let lotDiff = 0;
  for (const [parent, ids] of beforeMap) {
    if (JSON.stringify(ids) !== JSON.stringify(afterMap.get(parent))) lotDiff += 1;
  }
  console.log(
    `  ${lotDiff === 0 ? "SAME " : "DIFF "} ${"SaleItem.lotItems".padEnd(20)} rows=${lotBefore.length}${
      lotDiff > 0 ? `  (${lotDiff} parents reordered)` : ""
    }`,
  );
  if (lotDiff > 0) differences += 1;

  console.log(
    differences === 0
      ? "\nNO VISIBLE REORDERING: every document renders in the same row order as before"
      : `\n${differences} relation(s) changed order — review the affected documents`,
  );
};

main()
  .catch((error: unknown) => {
    console.error("verification failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
