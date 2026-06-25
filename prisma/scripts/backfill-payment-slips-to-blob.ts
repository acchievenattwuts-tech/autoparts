import { createClient } from "@supabase/supabase-js";
import { get, put } from "@vercel/blob";
import { db } from "@/lib/db";
import { AuditAction } from "@/lib/generated/prisma";

/**
 * Phase 3 backfill — copy existing payment-slip images from the private Supabase
 * `payment-slips` bucket to a private Vercel Blob store.
 *
 * Slips are PII: the Blob objects are PRIVATE and only viewable through the
 * session-checked `/api/admin/line-payment-slips/[id]/image` route.
 *
 * Unlike the public backfill, `PaymentSlip.imageUrl` stores the object *path*
 * (not a URL) and the path is identical in both backends — so this script only
 * copies bytes and never rewrites the database.
 *
 * Safety: dry-run by default; never deletes the Supabase source; idempotent
 * (objects already present in Blob are skipped); writes one AuditLog.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY (private bucket download) + BLOB_READ_WRITE_TOKEN.
 *
 * Run:  npm run backfill:payment-slips-blob            (dry-run)
 *       npm run backfill:payment-slips-blob -- --apply (execute)
 */

const BUCKET = "payment-slips";
type Mode = "dry-run" | "apply";

const getMode = (): Mode => (process.argv.includes("--apply") ? "apply" : "dry-run");

async function main() {
  const mode = getMode();
  console.log(`\nPayment-slip → Vercel Blob (private) backfill mode: ${mode.toUpperCase()}\n`);

  const slips = await db.paymentSlip.findMany({
    where: { imageUrl: { not: null } },
    select: { id: true, imageUrl: true },
  });
  console.log(`Slips with stored images: ${slips.length}`);

  if (mode === "dry-run") {
    for (const slip of slips.slice(0, 50)) {
      console.log(`  ${slip.id}\n    ${slip.imageUrl}`);
    }
    if (slips.length > 50) console.log(`  …and ${slips.length - 50} more`);
    console.log("\nDry-run complete. Re-run with --apply to copy images to private Blob.\n");
    return;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --apply (private bucket download).",
    );
  }
  if (!process.env.BLOB_SLIPS_READ_WRITE_TOKEN) {
    throw new Error("BLOB_SLIPS_READ_WRITE_TOKEN is required for --apply (separate PRIVATE Blob store).");
  }
  const slipToken = process.env.BLOB_SLIPS_READ_WRITE_TOKEN;

  const client = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const failures: { id: string; reason: string }[] = [];
  let migrated = 0;
  let skipped = 0;

  for (const slip of slips) {
    const path = slip.imageUrl;
    if (!path) continue;
    try {
      const existing = await get(path, { access: "private", token: slipToken }).catch(() => null);
      if (existing && existing.statusCode === 200) {
        skipped += 1;
        continue;
      }

      const { data, error } = await client.storage.from(BUCKET).download(path);
      if (error || !data) {
        failures.push({ id: slip.id, reason: `download failed: ${error?.message ?? "no data"}` });
        continue;
      }
      const buffer = Buffer.from(await data.arrayBuffer());

      await put(path, buffer, {
        access: "private",
        contentType: data.type || "image/webp",
        addRandomSuffix: false,
        allowOverwrite: true,
        token: slipToken,
      });
      migrated += 1;
      console.log(`  migrated ${migrated}/${slips.length}: ${slip.id}`);
    } catch (err) {
      failures.push({ id: slip.id, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  await db.auditLog.create({
    data: {
      userId: null,
      userName: "system-backfill",
      userRole: "SYSTEM",
      action: AuditAction.UPDATE,
      entityType: "ImageStorageMigration",
      entityRef: "supabase→vercel-blob:payment-slips",
      meta: {
        phase: "phase-3-payment-slips",
        migrated,
        skipped,
        failed: failures.length,
      },
    },
  });

  console.log(`\nMigrated: ${migrated}. Skipped (already in Blob): ${skipped}. Failed: ${failures.length}.`);
  if (failures.length > 0) {
    console.log("Failures:");
    for (const f of failures.slice(0, 50)) console.log(`  - ${f.id}: ${f.reason}`);
  }
  console.log("\nDone.\n");
}

main()
  .catch((error) => {
    console.error("Payment-slip backfill failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
