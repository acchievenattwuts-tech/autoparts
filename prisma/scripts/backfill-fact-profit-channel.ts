import { db } from "@/lib/db";
import { ProfitSourceType, SaleChannel } from "@/lib/generated/prisma";

/**
 * Backfill for FactProfit.channel.
 *
 * Lightweight: it only sets the `channel` column on existing profit facts (no row
 * recreation / no versionNo bump) by matching each fact back to its source document.
 * Idempotent — safe to re-run.
 *
 * Covers all three source types:
 *  - SALE        → Sale.channel
 *  - SALE_RETURN → CreditNote.channel (itself copied from the source sale)
 *  - EXPENSE     → Expense.channel (only channel-tagged expenses; shop-wide
 *                  expenses keep channel = null on purpose so per-channel reports
 *                  never absorb rent/salary/utilities)
 *
 * Without the SALE_RETURN pass, per-channel gross profit is overstated by the full
 * refunded amount, because returns are stored as negative rows that would never
 * match the channel filter.
 */

const CHUNK = 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function tagFacts(
  sourceType: ProfitSourceType,
  channel: SaleChannel,
  ids: string[],
): Promise<number> {
  let total = 0;
  for (const idChunk of chunk(ids, CHUNK)) {
    const result = await db.factProfit.updateMany({
      where: { sourceType, sourceId: { in: idChunk } },
      data: { channel },
    });
    total += result.count;
  }
  return total;
}

/**
 * ใบลดหนี้ที่ออกก่อนมีคอลัมน์ channel ยังเป็น null — เติมจากใบขายต้นทางก่อน
 * เพราะขั้นตอน tag FactProfit ด้านล่างอ่านค่าจากใบลดหนี้เป็นหลัก
 */
async function backfillCreditNoteChannel(): Promise<number> {
  const creditNotes = await db.creditNote.findMany({
    where: { channel: null, saleId: { not: null } },
    select: { id: true, sale: { select: { channel: true } } },
  });

  let updated = 0;
  for (const creditNote of creditNotes) {
    if (!creditNote.sale) continue;
    await db.creditNote.update({
      where: { id: creditNote.id },
      data: { channel: creditNote.sale.channel },
    });
    updated += 1;
  }
  return updated;
}

async function main() {
  let total = 0;

  const taggedCreditNotes = await backfillCreditNoteChannel();
  console.log(`CreditNote.channel filled from source sale: ${taggedCreditNotes} rows`);

  for (const channel of Object.values(SaleChannel)) {
    const [sales, creditNotes, expenses] = await Promise.all([
      db.sale.findMany({ where: { channel }, select: { id: true } }),
      db.creditNote.findMany({ where: { channel }, select: { id: true } }),
      db.expense.findMany({ where: { channel }, select: { id: true } }),
    ]);

    const saleRows = await tagFacts(ProfitSourceType.SALE, channel, sales.map((row) => row.id));
    const returnRows = await tagFacts(
      ProfitSourceType.SALE_RETURN,
      channel,
      creditNotes.map((row) => row.id),
    );
    const expenseRows = await tagFacts(
      ProfitSourceType.EXPENSE,
      channel,
      expenses.map((row) => row.id),
    );

    total += saleRows + returnRows + expenseRows;
    console.log(
      `channel ${channel}: ${sales.length} sales (${saleRows} rows), ` +
        `${creditNotes.length} credit notes (${returnRows} rows), ` +
        `${expenses.length} expenses (${expenseRows} rows)`,
    );
  }

  // ใบลดหนี้ที่ไม่ได้อ้างใบขาย (channel = null) เป็นรายการหน้าร้านทั้งหมด
  // แต่จงใจไม่แตะ เพื่อไม่ให้เดาช่องทางแทนข้อมูลจริง
  const untaggedReturns = await db.factProfit.count({
    where: { sourceType: ProfitSourceType.SALE_RETURN, channel: null, isActive: true },
  });
  console.log(`Backfilled FactProfit.channel on ${total} rows.`);
  console.log(
    `SALE_RETURN facts still without a channel: ${untaggedReturns} ` +
      "(credit notes with no source sale — left as-is on purpose)",
  );
}

main()
  .catch((error) => {
    console.error("[backfill-fact-profit-channel]", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
