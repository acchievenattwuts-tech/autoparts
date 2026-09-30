/**
 * One-off data fix approved by the owner on 2026-09-30 (review of the 2026-09-29 commits).
 *
 * 1. RR26060018 line 1: PurchaseItem.subtotalAmount was written by the old calcItemSubtotal
 *    formula that returned VAT-inclusive pre-VAT amounts 100x too small (fixed in 436289a7).
 *    Only that one column changes; cost, stock, AP and document totals are untouched.
 * 2. Inactive customers that still hold a LINE link: clear lineUserId / lineLinkedAt, the same
 *    fields the admin "unlink LINE" action clears.
 *
 * Dry-run by default. Writes only with --apply, in one transaction, guarded by the values
 * found during the review, with one AuditLog row per changed record.
 * Run: npx tsx --env-file=.env.local prisma/scripts/fix-20260930-vat-subtotal-and-inactive-line-links.ts [--apply]
 */
import { db, dbTx } from "../../lib/db";
import { writeAuditLogTx } from "../../lib/audit-log";
import { calcItemSubtotal } from "../../lib/vat";

const APPLY = process.argv.includes("--apply");
const SCRIPT = "fix-20260930-vat-subtotal-and-inactive-line-links";
const ACTOR = { userName: "System (data fix 2026-09-30)" } as const;

const PURCHASE_NO = "RR26060018";
const PURCHASE_LINE_NO = 1;
const EXPECTED_STORED_SUBTOTAL = 87.85;
const EXPECTED_INACTIVE_LINKED_CUSTOMERS = 2;

const cents = (amount: number): number => Math.round(amount * 100);
const maskLineUserId = (value: string): string => `…${value.slice(-4)}`;

type FixSummary = {
  mode: "DRY_RUN" | "APPLIED";
  purchaseItem: { id: string; purchaseNo: string; lineNo: number; before: number; after: number };
  customers: { id: string; code: string | null; lineUserId: string; lineLinkedAt: string | null }[];
};

async function run(): Promise<FixSummary> {
  return dbTx(async (tx) => {
    const item = await tx.purchaseItem.findFirst({
      where: { lineNo: PURCHASE_LINE_NO, purchase: { purchaseNo: PURCHASE_NO } },
      select: { id: true, lineNo: true, totalAmount: true, subtotalAmount: true,
        purchase: { select: { purchaseNo: true, vatType: true, vatRate: true } } },
    });
    if (!item) throw new Error(`${PURCHASE_NO} line ${PURCHASE_LINE_NO} not found`);
    if (item.purchase.vatType !== "INCLUDING_VAT") throw new Error(`${PURCHASE_NO} is no longer INCLUDING_VAT`);
    const stored = Number(item.subtotalAmount);
    if (cents(stored) !== cents(EXPECTED_STORED_SUBTOTAL)) {
      throw new Error(`${PURCHASE_NO} line ${PURCHASE_LINE_NO} subtotal is ${stored}, expected ${EXPECTED_STORED_SUBTOTAL}; aborting`);
    }
    const corrected = calcItemSubtotal(Number(item.totalAmount), "INCLUDING_VAT", Number(item.purchase.vatRate));

    const customers = await tx.customer.findMany({
      where: { isActive: false, lineUserId: { not: null } },
      select: { id: true, code: true, name: true, lineUserId: true, lineLinkedAt: true },
      orderBy: { id: "asc" },
    });
    if (customers.length !== EXPECTED_INACTIVE_LINKED_CUSTOMERS) {
      throw new Error(`Found ${customers.length} inactive linked customers, approved ${EXPECTED_INACTIVE_LINKED_CUSTOMERS}; aborting`);
    }

    const summary: FixSummary = {
      mode: APPLY ? "APPLIED" : "DRY_RUN",
      purchaseItem: { id: item.id, purchaseNo: PURCHASE_NO, lineNo: item.lineNo, before: stored, after: corrected },
      customers: customers.map((customer) => ({
        id: customer.id, code: customer.code, lineUserId: maskLineUserId(customer.lineUserId ?? ""),
        lineLinkedAt: customer.lineLinkedAt?.toISOString() ?? null,
      })),
    };
    if (!APPLY) return summary;

    // Compare the Decimal column against the exact stored value, not a JS float parameter.
    const updatedItem = await tx.purchaseItem.updateMany({
      where: { id: item.id, subtotalAmount: item.subtotalAmount },
      data: { subtotalAmount: corrected },
    });
    if (updatedItem.count !== 1) throw new Error("PurchaseItem changed concurrently; aborting");
    await writeAuditLogTx(tx, {
      ...ACTOR, action: "UPDATE", entityType: "PurchaseItem", entityId: item.id,
      entityRef: `${PURCHASE_NO} #${item.lineNo}`,
      before: { subtotalAmount: stored }, after: { subtotalAmount: corrected },
      meta: { script: SCRIPT, reason: "calcItemSubtotal INCLUDING_VAT 100x bug (fixed in 436289a7)" },
    });

    for (const customer of customers) {
      const cleared = await tx.customer.updateMany({
        where: { id: customer.id, isActive: false, lineUserId: customer.lineUserId },
        data: { lineUserId: null, lineLinkedAt: null },
      });
      if (cleared.count !== 1) throw new Error(`Customer ${customer.code ?? customer.id} changed concurrently; aborting`);
      await writeAuditLogTx(tx, {
        ...ACTOR, action: "UPDATE", entityType: "Customer", entityId: customer.id,
        entityRef: customer.code ?? customer.name,
        before: { lineUserId: customer.lineUserId, lineLinkedAt: customer.lineLinkedAt },
        after: { lineUserId: null, lineLinkedAt: null },
        meta: { script: SCRIPT, lineUnlinkedByAdmin: true, reason: "inactive customer still linked to LINE" },
      });
    }
    return summary;
  });
}

async function main(): Promise<void> {
  try {
    console.log(JSON.stringify(await run(), null, 2));
  } catch (error) {
    console.error(`[${SCRIPT}]`, error instanceof Error ? error.message : "failed");
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

void main();
