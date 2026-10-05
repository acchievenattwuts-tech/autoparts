/**
 * One-off data fix approved by the owner on 2026-10-05 (credit-note lot work).
 *
 * P0028 holds a LotBalance row "ST0126706501-nqa4jiko" with qtyOnHand 0 and no ProductLot.
 * It is most likely left over from the old credit-note edit page, which stripped only the
 * "RET-" prefix of a RET- lot and kept the line-id suffix (fixed 2026-10-05). The row
 * changes no total and never shows in lot pickers (they list qtyOnHand > 0).
 *
 * Deletes only that row, and only while it is still zero, still has no ProductLot and no
 * lot table (sale, purchase, purchase return, credit note, stock movement, claim) names it.
 * Dry-run by default; writes only with --apply, in one transaction, with an AuditLog row.
 * Run: npx tsx --env-file=.env.local prisma/scripts/fix-20261005-orphan-lot-balance.ts [--apply]
 */
import { db, dbTx } from "../../lib/db";
import { writeAuditLogTx } from "../../lib/audit-log";

const APPLY = process.argv.includes("--apply");
const SCRIPT = "fix-20261005-orphan-lot-balance";
const ACTOR = { userName: "System (data fix 2026-10-05)" } as const;

const PRODUCT_CODE = "P0028";
const LOT_NO = "ST0126706501-nqa4jiko";
const QTY_TOLERANCE = 0.0001;

type Target = { id: string; productId: string; qtyOnHand: number };

async function findTarget(client: Pick<typeof db, "product" | "lotBalance">): Promise<Target> {
  const product = await client.product.findUnique({ where: { code: PRODUCT_CODE }, select: { id: true } });
  if (!product) throw new Error(`Product ${PRODUCT_CODE} not found`);
  const row = await client.lotBalance.findUnique({
    where: { productId_lotNo: { productId: product.id, lotNo: LOT_NO } },
    select: { id: true, productId: true, qtyOnHand: true },
  });
  if (!row) throw new Error(`LotBalance ${PRODUCT_CODE} / ${LOT_NO} not found (already removed?)`);
  return { id: row.id, productId: row.productId, qtyOnHand: Number(row.qtyOnHand) };
}

/** Every place that could still name the lot; all must be zero before the row goes. */
async function countReferences(
  client: Pick<
    typeof db,
    | "productLot"
    | "saleItemLot"
    | "purchaseItemLot"
    | "purchaseReturnItemLot"
    | "creditNoteItemLot"
    | "stockMovementLot"
    | "warrantyClaimLot"
  >,
  productId: string,
): Promise<Record<string, number>> {
  // Sequential: inside the transaction one client must not queue parallel queries.
  return {
    productLot: await client.productLot.count({ where: { productId, lotNo: LOT_NO } }),
    saleItemLot: await client.saleItemLot.count({ where: { lotNo: LOT_NO, saleItem: { productId } } }),
    purchaseItemLot: await client.purchaseItemLot.count({ where: { lotNo: LOT_NO, purchaseItem: { productId } } }),
    purchaseReturnItemLot: await client.purchaseReturnItemLot.count({
      where: { lotNo: LOT_NO, purchaseReturnItem: { productId } },
    }),
    creditNoteItemLot: await client.creditNoteItemLot.count({ where: { lotNo: LOT_NO, creditNoteItem: { productId } } }),
    stockMovementLot: await client.stockMovementLot.count({ where: { lotNo: LOT_NO, stockCard: { productId } } }),
    // WarrantyClaimLot has no product column; any row with this unique-looking lot number blocks.
    warrantyClaimLot: await client.warrantyClaimLot.count({ where: { lotNo: LOT_NO } }),
  };
}

function assertDeletable(target: Target, references: Record<string, number>): void {
  if (Math.abs(target.qtyOnHand) > QTY_TOLERANCE) {
    throw new Error(`qtyOnHand is ${target.qtyOnHand}, expected 0; aborting`);
  }
  const used = Object.entries(references).filter(([, count]) => count > 0);
  if (used.length > 0) {
    throw new Error(`Lot is still referenced (${used.map(([table, count]) => `${table}=${count}`).join(", ")}); aborting`);
  }
}

async function main(): Promise<void> {
  const target = await findTarget(db);
  const references = await countReferences(db, target.productId);
  console.log(`${APPLY ? "APPLY" : "DRY-RUN"} ${SCRIPT}`);
  console.log(`Target LotBalance ${target.id}: ${PRODUCT_CODE} / ${LOT_NO}, qtyOnHand ${target.qtyOnHand}`);
  console.table(references);
  assertDeletable(target, references);

  if (!APPLY) {
    console.log("Checks passed. Would delete 1 LotBalance row. Re-run with --apply to delete.");
    return;
  }

  await dbTx(async (tx) => {
    // Re-check under the product lock so a concurrent document cannot start using the lot.
    await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${target.productId} FOR UPDATE`;
    const locked = await findTarget(tx);
    assertDeletable(locked, await countReferences(tx, locked.productId));
    const deleted = await tx.lotBalance.deleteMany({ where: { id: locked.id, qtyOnHand: 0 } });
    if (deleted.count !== 1) throw new Error(`Expected to delete 1 row, deleted ${deleted.count}; rolled back`);
    await writeAuditLogTx(tx, {
      ...ACTOR,
      action: "DELETE",
      entityType: "LotBalance",
      entityId: locked.id,
      entityRef: `${PRODUCT_CODE} / ${LOT_NO}`,
      before: { productCode: PRODUCT_CODE, lotNo: LOT_NO, qtyOnHand: locked.qtyOnHand },
      after: null,
      meta: {
        script: SCRIPT,
        reason: "orphan zero LotBalance without ProductLot, left by the old credit-note edit page RET- lot naming bug",
      },
    });
  });
  console.log("Deleted 1 LotBalance row and wrote 1 AuditLog row.");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
