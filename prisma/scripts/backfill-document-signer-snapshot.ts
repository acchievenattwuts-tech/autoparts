/**
 * One-off backfill: fill signerName / signerSignatureUrl / signedAt on documents
 * that only gained those columns in 2026-09-10.
 *
 *   SalesQuotation        ← updatedByName + User(updatedById).signatureUrl, signedAt = quotationDate
 *   CustomerAdvance       ← User(userId).name / .signatureUrl,              signedAt = advanceDate
 *   CustomerAdvanceRefund ← User(userId).name / .signatureUrl,              signedAt = refundDate
 *
 * SalesQuotation keeps its own `updatedByName` as the signer name because that
 * string is already the frozen name printed on the document — the current
 * User.name may have been edited since.
 *
 * Idempotent: only touches rows where BOTH signerName and signerSignatureUrl
 * are still NULL. A signer with no signature on file ends up with a name and a
 * NULL url, which is the correct final state, so re-running skips it.
 *
 * Dry-run by default. Pass --apply to write.
 *
 *   npm run backfill:document-signer
 *   npm run backfill:document-signer -- --apply
 */
import { db } from "../../lib/db";

const APPLY = process.argv.includes("--apply");

type Target = {
  label: string;
  table: string;
  /** SQL expression for the signer name, relative to aliases d (document) and u (user) */
  nameExpr: string;
  userIdColumn: string;
  dateColumn: string;
};

const TARGETS: Target[] = [
  { label: "SalesQuotation", table: "SalesQuotation", nameExpr: `d."updatedByName"`, userIdColumn: "updatedById", dateColumn: "quotationDate" },
  { label: "CustomerAdvance", table: "CustomerAdvance", nameExpr: `u."name"`, userIdColumn: "userId", dateColumn: "advanceDate" },
  { label: "CustomerAdvanceRefund", table: "CustomerAdvanceRefund", nameExpr: `u."name"`, userIdColumn: "userId", dateColumn: "refundDate" },
];

const pendingWhere = (target: Target) =>
  `d."signerName" IS NULL AND d."signerSignatureUrl" IS NULL AND u."id" = d."${target.userIdColumn}"`;

async function report(target: Target) {
  const rows = await db.$queryRawUnsafe<Array<{ total: bigint; with_signature: bigint }>>(`
    SELECT count(*) AS total,
           count(u."signatureUrl") AS with_signature
    FROM "${target.table}" d
    JOIN "User" u ON ${pendingWhere(target)}
  `);
  const total = Number(rows[0]?.total ?? 0);
  const withSignature = Number(rows[0]?.with_signature ?? 0);
  console.log(
    `[backfill] ${target.label}: ${total} row(s) pending — ${withSignature} will get a signature image, ${total - withSignature} name only`,
  );
  return total;
}

async function apply(target: Target) {
  const updated = await db.$executeRawUnsafe(`
    UPDATE "${target.table}" AS d
    SET "signerName" = ${target.nameExpr},
        "signerSignatureUrl" = u."signatureUrl",
        "signedAt" = d."${target.dateColumn}"
    FROM "User" AS u
    WHERE ${pendingWhere(target)}
  `);
  console.log(`[backfill] ${target.label}: updated ${updated} row(s)`);
}

async function main() {
  console.log(`[backfill] mode: ${APPLY ? "APPLY" : "DRY RUN (pass --apply to write)"}`);
  let pending = 0;
  for (const target of TARGETS) pending += await report(target);

  if (!APPLY) {
    console.log(`[backfill] dry run complete — ${pending} row(s) would change`);
    return;
  }

  for (const target of TARGETS) await apply(target);

  console.log("[backfill] re-check after apply:");
  for (const target of TARGETS) await report(target);
}

main()
  .catch((error) => {
    console.error("[backfill] FAILED", error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
