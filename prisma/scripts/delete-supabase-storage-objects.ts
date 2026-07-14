import { writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { get } from "@vercel/blob";
import { db } from "@/lib/db";
import { AuditAction } from "@/lib/generated/prisma";

/**
 * Phase 4 cleanup — permanently delete the migrated objects from the old
 * Supabase Storage buckets (`products`, `line-chat`, `payment-slips`).
 *
 * All live reads/writes moved to Vercel Blob (public backfill 2026-06-25,
 * payment slips 2026-07). The Supabase copies are dead weight (~417MB).
 * Bucket `purchase-ocr` is still in active use and is NEVER touched.
 *
 * Preflight gates (run in BOTH modes; --apply aborts if any gate fails):
 *  1. No text column in the public schema still references a Supabase
 *     storage object URL (`%supabase.co/storage/v1/object%`).
 *  2. Every PaymentSlip.imageUrl path exists in the private Blob store
 *     (slips are path-addressed, so gate 1 cannot see them).
 *
 * Safety: dry-run by default; writes a manifest JSON (gitignored) listing
 * every object before deletion; deletes in small batches; idempotent
 * (re-run finds 0 objects); writes one AuditLog entry on --apply.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (--apply)
 * and BLOB_SLIPS_READ_WRITE_TOKEN (slip preflight, both modes).
 *
 * Run:  npm run cleanup:supabase-storage             (dry-run)
 *       npm run cleanup:supabase-storage -- --apply  (execute)
 */

const TARGET_BUCKETS = ["products", "line-chat", "payment-slips"] as const;
const PROTECTED_BUCKET = "purchase-ocr";
const DELETE_BATCH_SIZE = 100;
const SUPABASE_STORAGE_URL_MARKER = "%supabase.co/storage/v1/object%";

type Mode = "dry-run" | "apply";
const getMode = (): Mode => (process.argv.includes("--apply") ? "apply" : "dry-run");

interface StorageObjectRow {
  bucket_id: string;
  name: string;
  size: bigint | number | null;
}

interface DbReferenceHit {
  table: string;
  column: string;
  rows: number;
}

const formatMb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)}MB`;

/** Gate 1 — no public-schema text column may still hold a Supabase storage URL. */
async function findDanglingDbReferences(): Promise<DbReferenceHit[]> {
  const columns = await db.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND data_type IN ('text', 'character varying')
     ORDER BY table_name, column_name`,
  );

  const byTable = new Map<string, string[]>();
  for (const col of columns) {
    const list = byTable.get(col.table_name) ?? [];
    list.push(col.column_name);
    byTable.set(col.table_name, list);
  }

  const hits: DbReferenceHit[] = [];
  for (const [table, cols] of byTable) {
    const anyColMatches = cols.map((c) => `"${c}" LIKE '${SUPABASE_STORAGE_URL_MARKER}'`).join(" OR ");
    const [tableHit] = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM "${table}" WHERE ${anyColMatches}`,
    );
    if (Number(tableHit?.n ?? 0) === 0) continue;

    for (const col of cols) {
      const [colHit] = await db.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*)::bigint AS n FROM "${table}" WHERE "${col}" LIKE '${SUPABASE_STORAGE_URL_MARKER}'`,
      );
      const rows = Number(colHit?.n ?? 0);
      if (rows > 0) hits.push({ table, column: col, rows });
    }
  }
  return hits;
}

/** Gate 2 — every slip path must exist in the private Blob store (reads are Blob-only now). */
async function findSlipsMissingFromBlob(): Promise<{ id: string; path: string }[]> {
  const slipToken = process.env.BLOB_SLIPS_READ_WRITE_TOKEN;
  if (!slipToken) {
    throw new Error("BLOB_SLIPS_READ_WRITE_TOKEN is required to verify payment slips before deletion.");
  }

  const slips = await db.paymentSlip.findMany({
    where: { imageUrl: { not: null } },
    select: { id: true, imageUrl: true },
  });

  const missing: { id: string; path: string }[] = [];
  for (const slip of slips) {
    if (!slip.imageUrl) continue;
    const existing = await get(slip.imageUrl, { access: "private", token: slipToken }).catch(() => null);
    if (!existing || existing.statusCode !== 200) {
      missing.push({ id: slip.id, path: slip.imageUrl });
    }
  }
  console.log(`Payment slips checked against private Blob store: ${slips.length} (missing: ${missing.length})`);
  return missing;
}

async function loadManifest(): Promise<StorageObjectRow[]> {
  return db.$queryRawUnsafe<StorageObjectRow[]>(
    `SELECT bucket_id, name, COALESCE((metadata->>'size')::bigint, 0) AS size
     FROM storage.objects
     WHERE bucket_id IN ('products', 'line-chat', 'payment-slips')
     ORDER BY bucket_id, name`,
  );
}

const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

async function main() {
  const mode = getMode();
  if ((TARGET_BUCKETS as readonly string[]).includes(PROTECTED_BUCKET)) {
    throw new Error(`Bucket "${PROTECTED_BUCKET}" must never be a deletion target.`);
  }
  console.log(`\nSupabase Storage cleanup (buckets: ${TARGET_BUCKETS.join(", ")}) mode: ${mode.toUpperCase()}\n`);

  const [dbHits, missingSlips, manifest] = [
    await findDanglingDbReferences(),
    await findSlipsMissingFromBlob(),
    await loadManifest(),
  ];

  if (dbHits.length > 0) {
    console.error("\nABORT — database rows still reference Supabase storage URLs:");
    for (const hit of dbHits) console.error(`  ${hit.table}.${hit.column}: ${hit.rows} row(s)`);
    process.exitCode = 1;
    return;
  }
  console.log("DB scan: no text column references a Supabase storage URL.");

  if (missingSlips.length > 0) {
    console.error("\nABORT — payment slips missing from the private Blob store:");
    for (const slip of missingSlips.slice(0, 50)) console.error(`  ${slip.id}: ${slip.path}`);
    process.exitCode = 1;
    return;
  }

  const perBucket = new Map<string, { count: number; bytes: number }>();
  for (const bucket of TARGET_BUCKETS) perBucket.set(bucket, { count: 0, bytes: 0 });
  for (const row of manifest) {
    const agg = perBucket.get(row.bucket_id);
    if (!agg) continue;
    agg.count += 1;
    agg.bytes += Number(row.size ?? 0);
  }

  console.log("\nObjects found in Supabase Storage:");
  let totalCount = 0;
  let totalBytes = 0;
  for (const bucket of TARGET_BUCKETS) {
    const agg = perBucket.get(bucket)!;
    totalCount += agg.count;
    totalBytes += agg.bytes;
    console.log(`  ${bucket}: ${agg.count} object(s), ${formatMb(agg.bytes)}`);
  }
  console.log(`  TOTAL: ${totalCount} object(s), ${formatMb(totalBytes)}`);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const manifestFile = path.join(process.cwd(), `supabase-storage-delete-manifest-${stamp}.json`);
  writeFileSync(
    manifestFile,
    JSON.stringify(
      manifest.map((row) => ({ bucket: row.bucket_id, name: row.name, size: Number(row.size ?? 0) })),
      null,
      2,
    ),
    "utf8",
  );
  console.log(`\nManifest written to: ${path.basename(manifestFile)}`);

  if (mode === "dry-run") {
    console.log("\nDry-run complete. Nothing deleted. Re-run with --apply to delete permanently.\n");
    return;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --apply.");
  }
  const client = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  let deleted = 0;
  const failures: { bucket: string; reason: string; sample: string }[] = [];
  for (const bucket of TARGET_BUCKETS) {
    const names = manifest.filter((row) => row.bucket_id === bucket).map((row) => row.name);
    for (const batch of chunk(names, DELETE_BATCH_SIZE)) {
      const { error } = await client.storage.from(bucket).remove(batch);
      if (error) {
        failures.push({ bucket, reason: error.message, sample: batch[0] });
        continue;
      }
      deleted += batch.length;
      console.log(`  ${bucket}: deleted ${deleted}/${totalCount} total`);
    }
  }

  const remaining = await loadManifest();
  console.log(`\nDeleted: ${deleted}. Failed batches: ${failures.length}. Remaining objects: ${remaining.length}.`);
  if (failures.length > 0) {
    for (const f of failures.slice(0, 20)) console.log(`  - ${f.bucket} (batch at ${f.sample}): ${f.reason}`);
  }

  await db.auditLog.create({
    data: {
      userId: null,
      userName: "system-cleanup",
      userRole: "SYSTEM",
      action: AuditAction.DELETE,
      entityType: "ImageStorageMigration",
      entityRef: `supabase-storage-cleanup:${TARGET_BUCKETS.join(",")}`,
      meta: {
        phase: "phase-4-cleanup",
        deleted,
        failedBatches: failures.length,
        remaining: remaining.length,
        totalBytes,
        perBucket: Object.fromEntries(
          TARGET_BUCKETS.map((bucket) => {
            const agg = perBucket.get(bucket)!;
            return [bucket, { count: agg.count, bytes: agg.bytes }];
          }),
        ),
        manifestFile: path.basename(manifestFile),
      },
    },
  });

  console.log("\nDone.\n");
}

main()
  .catch((error) => {
    console.error("Supabase storage cleanup failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
