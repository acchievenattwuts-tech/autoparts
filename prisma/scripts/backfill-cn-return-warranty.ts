/**
 * One-off backfill (owner request 2026-10-03): apply the RETURN credit note warranty cut
 * (lib/credit-note-warranty.ts) to credit notes saved before that rule shipped.
 *
 * Uses syncCreditNoteReturnWarranties — the exact logic createCreditNote now runs — on every
 * ACTIVE RETURN credit note with a source sale, oldest first. Idempotent: the sync restores
 * what a CN cut and cuts again, so a re-run changes nothing.
 *
 * A credit note whose returned unit has an in-progress claim (DRAFT / SENT_TO_SUPPLIER) is
 * reported and skipped; the rest still apply (one transaction per credit note).
 *
 * Dry-run by default: everything runs in ONE transaction that is rolled back, so the report
 * shows the cumulative result exactly. Pass --apply to write.
 *
 *   npx tsx prisma/scripts/backfill-cn-return-warranty.ts
 *   npx tsx prisma/scripts/backfill-cn-return-warranty.ts --apply
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { AuditAction, CreditNoteType, DocStatus, type Prisma } from "@/lib/generated/prisma";
import {
  CreditNoteWarrantyClaimBlockedError,
  syncCreditNoteReturnWarranties,
  type CreditNoteWarrantySyncResult,
} from "@/lib/credit-note-warranty";

const APPLY = process.argv.includes("--apply");
const SCRIPT_SOURCE = "backfill-cn-return-warranty";
const TRANSACTION_TIMEOUT_MS = 120_000;

class DryRunRollback extends Error {}

type CreditNoteRow = { id: string; cnNo: string };
type Outcome =
  | { cn: CreditNoteRow; kind: "changed"; result: CreditNoteWarrantySyncResult }
  | { cn: CreditNoteRow; kind: "unchanged" }
  | { cn: CreditNoteRow; kind: "blocked"; claimNos: string[] };

const syncOne = async (tx: Prisma.TransactionClient, cn: CreditNoteRow): Promise<Outcome> => {
  try {
    const result = await syncCreditNoteReturnWarranties(tx, cn.id);
    // The sync restores then re-cuts; re-cutting the same set (a re-run) is no change.
    const changed = result.cancelledWarrantyIds.join(",") !== [...result.restoredWarrantyIds].sort().join(",");
    if (!changed) return { cn, kind: "unchanged" };
    if (APPLY) {
      await tx.auditLog.create({
        data: {
          action: AuditAction.UPDATE,
          entityType: "CreditNote",
          entityId: cn.id,
          entityRef: cn.cnNo,
          meta: { source: SCRIPT_SOURCE, warranties: result },
        },
      });
    }
    return { cn, kind: "changed", result };
  } catch (error) {
    if (error instanceof CreditNoteWarrantyClaimBlockedError) return { cn, kind: "blocked", claimNos: error.claimNos };
    throw error;
  }
};

const report = (outcomes: readonly Outcome[]): void => {
  for (const outcome of outcomes) {
    if (outcome.kind === "changed") {
      console.log(
        `[${SCRIPT_SOURCE}] ${outcome.cn.cnNo}: cut ${outcome.result.cancelledWarrantyIds.length} warranty(ies)` +
          (outcome.result.restoredWarrantyIds.length > 0 ? `, restored ${outcome.result.restoredWarrantyIds.length}` : "") +
          ` — ${outcome.result.cancelledWarrantyIds.join(", ")}`,
      );
    } else if (outcome.kind === "blocked") {
      console.log(`[${SCRIPT_SOURCE}] ${outcome.cn.cnNo}: SKIPPED — in-progress claim(s) ${outcome.claimNos.join(", ")}`);
    } else {
      console.log(`[${SCRIPT_SOURCE}] ${outcome.cn.cnNo}: no warranty to cut`);
    }
  }
  const cut = outcomes.reduce((sum, o) => sum + (o.kind === "changed" ? o.result.cancelledWarrantyIds.length : 0), 0);
  const blocked = outcomes.filter((o) => o.kind === "blocked").length;
  console.log(
    `[${SCRIPT_SOURCE}] ${APPLY ? "APPLIED" : "DRY-RUN (rolled back)"}: ${outcomes.length} credit note(s), ` +
      `${cut} warranty(ies) cut, ${blocked} skipped for in-progress claims.`,
  );
};

async function main(): Promise<void> {
  const { db, dbTx } = await import("@/lib/db");
  try {
    const creditNotes = await db.creditNote.findMany({
      where: { status: DocStatus.ACTIVE, type: CreditNoteType.RETURN, saleId: { not: null } },
      orderBy: [{ cnDate: "asc" }, { createdAt: "asc" }],
      select: { id: true, cnNo: true },
    });

    const outcomes: Outcome[] = [];
    if (APPLY) {
      for (const cn of creditNotes) {
        outcomes.push(await dbTx((tx) => syncOne(tx, cn), { timeout: TRANSACTION_TIMEOUT_MS }));
      }
    } else {
      try {
        await dbTx(async (tx) => {
          for (const cn of creditNotes) outcomes.push(await syncOne(tx, cn));
          throw new DryRunRollback();
        }, { timeout: TRANSACTION_TIMEOUT_MS });
      } catch (error) {
        if (!(error instanceof DryRunRollback)) throw error;
      }
    }
    report(outcomes);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(`[${SCRIPT_SOURCE}] failed:`, error);
  process.exit(1);
});
