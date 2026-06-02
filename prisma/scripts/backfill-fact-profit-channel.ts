import { db } from "@/lib/db";
import { ProfitSourceType, SaleChannel } from "@/lib/generated/prisma";

/**
 * One-time backfill for FactProfit.channel (M2).
 *
 * Lightweight: it only sets the new `channel` column on existing SALE profit
 * facts (no row recreation / no versionNo bump) by matching sourceId to the
 * sale's channel. Idempotent — safe to re-run.
 */

const CHUNK = 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function main() {
  let total = 0;
  for (const channel of [SaleChannel.STORE, SaleChannel.SHOPEE]) {
    const sales = await db.sale.findMany({ where: { channel }, select: { id: true } });
    const ids = sales.map((s) => s.id);
    for (const idChunk of chunk(ids, CHUNK)) {
      const result = await db.factProfit.updateMany({
        where: { sourceType: ProfitSourceType.SALE, sourceId: { in: idChunk } },
        data: { channel },
      });
      total += result.count;
    }
    console.log(`channel ${channel}: ${ids.length} sales`);
  }
  console.log(`Backfilled FactProfit.channel on ${total} rows.`);
}

main()
  .catch((error) => {
    console.error("[backfill-fact-profit-channel]", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
