import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { AuditAction, CreditNoteType } from "@/lib/generated/prisma";

async function main(): Promise<void> {
  const { db } = await import("@/lib/db");
  try {
    const rows = await db.creditNoteItem.findMany({
      where: {
        saleItemId: null,
        productId: { not: null },
        creditNote: { type: CreditNoteType.RETURN, saleId: { not: null } },
      },
      select: {
        id: true,
        productId: true,
        creditNote: { select: { id: true, cnNo: true, saleId: true } },
      },
    });
    const saleIds = [
      ...new Set(
        rows
          .map((row) => row.creditNote.saleId)
          .filter((id): id is string => !!id),
      ),
    ];
    const sales = await db.sale.findMany({
      where: { id: { in: saleIds } },
      select: { id: true, items: { select: { id: true, productId: true } } },
    });
    const candidatesBySaleAndProduct = new Map(
      sales.flatMap((sale) => {
        const byProduct = new Map<string, string[]>();
        for (const item of sale.items) {
          const candidates = byProduct.get(item.productId) ?? [];
          candidates.push(item.id);
          byProduct.set(item.productId, candidates);
        }
        return [...byProduct].map(
          ([productId, candidates]) =>
            [`${sale.id}::${productId}`, candidates] as const,
        );
      }),
    );

    let updated = 0;
    let ambiguous = 0;
    let unmatched = 0;
    for (const row of rows) {
      const saleId = row.creditNote.saleId;
      if (!saleId || !row.productId) continue;
      const candidates =
        candidatesBySaleAndProduct.get(`${saleId}::${row.productId}`) ?? [];
      if (candidates.length === 0) {
        unmatched += 1;
        continue;
      }
      if (candidates.length > 1) {
        ambiguous += 1;
        continue;
      }

      const saleItemId = candidates[0];
      await db.$transaction(async (tx) => {
        const result = await tx.creditNoteItem.updateMany({
          where: { id: row.id, saleItemId: null },
          data: { saleItemId },
        });
        if (result.count === 0) return;
        await tx.auditLog.create({
          data: {
            action: AuditAction.UPDATE,
            entityType: "CreditNoteItem",
            entityId: row.id,
            entityRef: row.creditNote.cnNo,
            before: { saleItemId: null },
            after: { saleItemId },
            meta: {
              source: "backfill-credit-note-sale-item",
              creditNoteId: row.creditNote.id,
              saleId,
            },
          },
        });
        updated += 1;
      });
    }

    console.log(
      JSON.stringify({ scanned: rows.length, updated, ambiguous, unmatched }),
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("[backfill-credit-note-sale-item]", error);
  process.exitCode = 1;
});
