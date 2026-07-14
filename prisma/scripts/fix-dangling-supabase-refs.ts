import { db } from "@/lib/db";
import { AuditAction } from "@/lib/generated/prisma";

/**
 * Phase 4.2 pre-cleanup fix — three columns were missed by the 2026-06-25
 * public-image backfill and still reference Supabase Storage:
 *
 *  - Sale.signerSignatureUrl / Receipt.signerSignatureUrl (48 rows): signer
 *    snapshots rendered on print documents. Every row points at the same
 *    signature file, which already exists in the public Blob store at the
 *    same object path — so this is a pure URL rewrite (no bytes copied).
 *  - PaymentSlip.imageSignedUrl (+ExpiresAt) (3 rows): Supabase signed-URL
 *    cache that expired 2026-06-16..18 and is no longer read or written by
 *    any code (slips are served through the private-Blob stream route) —
 *    cleared to NULL.
 *
 * Safety: dry-run by default; for each distinct legacy URL the target Blob
 * URL must answer HTTP 200 before any row is rewritten; one AuditLog entry.
 *
 * Run:  npx tsx --env-file=.env.local prisma/scripts/fix-dangling-supabase-refs.ts           (dry-run)
 *       npx tsx --env-file=.env.local prisma/scripts/fix-dangling-supabase-refs.ts --apply   (execute)
 */

const SUPABASE_URL_MARKER = "%supabase.co/storage/v1/object%";
/** Everything after this prefix is the object path inside the public Blob store. */
const SUPABASE_PRODUCTS_PUBLIC_PREFIX = "/storage/v1/object/public/products/";
/** Public Blob store host — same store User.signatureUrl already points at. */
const BLOB_PUBLIC_BASE = "https://gjo7yq8dwaho55nx.public.blob.vercel-storage.com/";

type Mode = "dry-run" | "apply";
const getMode = (): Mode => (process.argv.includes("--apply") ? "apply" : "dry-run");

const toBlobUrl = (legacyUrl: string): string | null => {
  const idx = legacyUrl.indexOf(SUPABASE_PRODUCTS_PUBLIC_PREFIX);
  if (idx === -1) return null;
  return BLOB_PUBLIC_BASE + legacyUrl.slice(idx + SUPABASE_PRODUCTS_PUBLIC_PREFIX.length);
};

async function main() {
  const mode = getMode();
  console.log(`\nFix dangling Supabase refs mode: ${mode.toUpperCase()}\n`);

  const legacyUrls = await db.$queryRawUnsafe<{ url: string; sales: bigint; receipts: bigint }[]>(
    `SELECT url,
            count(*) FILTER (WHERE src = 's')::bigint AS sales,
            count(*) FILTER (WHERE src = 'r')::bigint AS receipts
     FROM (
       SELECT 's' AS src, "signerSignatureUrl" AS url FROM "Sale"
       WHERE "signerSignatureUrl" LIKE '${SUPABASE_URL_MARKER}'
       UNION ALL
       SELECT 'r', "signerSignatureUrl" FROM "Receipt"
       WHERE "signerSignatureUrl" LIKE '${SUPABASE_URL_MARKER}'
     ) t GROUP BY url`,
  );

  const mappings: { legacyUrl: string; blobUrl: string; sales: number; receipts: number }[] = [];
  for (const row of legacyUrls) {
    const blobUrl = toBlobUrl(row.url);
    if (!blobUrl) {
      throw new Error(`Cannot map legacy URL to Blob (not a public products-bucket URL): ${row.url}`);
    }
    const head = await fetch(blobUrl, { method: "HEAD" });
    if (head.status !== 200) {
      throw new Error(`Blob target answered ${head.status} (must be 200): ${blobUrl}`);
    }
    mappings.push({ legacyUrl: row.url, blobUrl, sales: Number(row.sales), receipts: Number(row.receipts) });
    console.log(`Signature mapping OK (${row.sales} sale / ${row.receipts} receipt rows):`);
    console.log(`  ${row.url}\n  → ${blobUrl}`);
  }

  const staleSlips = await db.paymentSlip.count({
    where: { imageSignedUrl: { contains: "supabase.co/storage/v1/object" } },
  });
  console.log(`\nStale PaymentSlip.imageSignedUrl cache rows: ${staleSlips}`);

  if (mode === "dry-run") {
    console.log("\nDry-run complete. Nothing changed. Re-run with --apply to rewrite.\n");
    return;
  }

  let saleRows = 0;
  let receiptRows = 0;
  for (const m of mappings) {
    const sale = await db.sale.updateMany({
      where: { signerSignatureUrl: m.legacyUrl },
      data: { signerSignatureUrl: m.blobUrl },
    });
    const receipt = await db.receipt.updateMany({
      where: { signerSignatureUrl: m.legacyUrl },
      data: { signerSignatureUrl: m.blobUrl },
    });
    saleRows += sale.count;
    receiptRows += receipt.count;
  }

  const slips = await db.paymentSlip.updateMany({
    where: { imageSignedUrl: { contains: "supabase.co/storage/v1/object" } },
    data: { imageSignedUrl: null, imageSignedUrlExpiresAt: null },
  });

  await db.auditLog.create({
    data: {
      userId: null,
      userName: "system-cleanup",
      userRole: "SYSTEM",
      action: AuditAction.UPDATE,
      entityType: "ImageStorageMigration",
      entityRef: "fix-dangling-supabase-refs",
      meta: {
        phase: "phase-4-cleanup-prefix",
        signatureMappings: mappings.map((m) => ({ from: m.legacyUrl, to: m.blobUrl })),
        saleRowsRewritten: saleRows,
        receiptRowsRewritten: receiptRows,
        paymentSlipCacheCleared: slips.count,
      },
    },
  });

  console.log(`\nRewritten: Sale ${saleRows}, Receipt ${receiptRows}. PaymentSlip cache cleared: ${slips.count}.`);
  console.log("\nDone.\n");
}

main()
  .catch((error) => {
    console.error("Fix failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
