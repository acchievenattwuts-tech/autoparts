import { writeFileSync } from "node:fs";
import path from "node:path";
import { put } from "@vercel/blob";
import { db } from "@/lib/db";
import { AuditAction } from "@/lib/generated/prisma";

/**
 * Phase 2 backfill — copy existing public objects from Supabase Storage to Vercel
 * Blob and rewrite the stored URLs in the database.
 *
 * Scope (agreed): the public `products` bucket (product images, shop logo, user
 * signatures, delivery proofs) and the public `line-chat` bucket. Private
 * payment-slips (Phase 3) and the temporary purchase-ocr bucket are out of scope.
 *
 * Safety:
 *  - dry-run by default; pass `--apply` to actually copy + rewrite.
 *  - never deletes the Supabase source (Phase 4 cleanup does that after a soak).
 *  - idempotent: rows already pointing at Blob are skipped, so a failed run can be
 *    re-run to resume.
 *  - writes a rollback map (old → new URL per row) to a JSON file and one AuditLog.
 *
 * Run:  npm run backfill:public-images-blob            (dry-run)
 *       npm run backfill:public-images-blob -- --apply (execute)
 */

type Mode = "dry-run" | "apply";
type Bucket = "products" | "line-chat";

interface MigrationRef {
  /** Human label for logs, e.g. "Product.imageUrl P00123". */
  label: string;
  bucket: Bucket;
  objectPath: string;
  oldUrl: string;
  /** Rewrites the DB row to the new Blob URL. Returns the number of rows updated. */
  apply: (newUrl: string) => Promise<number>;
}

interface RollbackEntry {
  label: string;
  bucket: Bucket;
  objectPath: string;
  oldUrl: string;
  newUrl: string;
}

const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";
const PUBLIC_BLOB_CACHE_MAX_AGE_SECONDS = 31_536_000; // 1 year.
const MIGRATED_BUCKETS: ReadonlySet<string> = new Set<Bucket>(["products", "line-chat"]);

const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

const getMode = (): Mode => (process.argv.includes("--apply") ? "apply" : "dry-run");

const isBlobUrl = (url: string): boolean => {
  try {
    return new URL(url).hostname.endsWith(BLOB_HOST_SUFFIX);
  } catch {
    return false;
  }
};

/**
 * Parses a Supabase public-object URL into { bucket, objectPath } for the buckets
 * in migration scope. Returns null for Blob URLs, foreign URLs, or anything else.
 */
const parseSupabasePublicUrl = (
  url: string,
  supabaseHost: string,
): { bucket: Bucket; objectPath: string } | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.host !== supabaseHost) return null;

  const match = parsed.pathname.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
  if (!match) return null;

  const bucket = match[1];
  if (!MIGRATED_BUCKETS.has(bucket)) return null;

  let objectPath: string;
  try {
    objectPath = decodeURIComponent(match[2]);
  } catch {
    objectPath = match[2];
  }
  return { bucket: bucket as Bucket, objectPath };
};

const inferContentType = (objectPath: string, downloadedType: string | undefined): string => {
  if (downloadedType && downloadedType.startsWith("image/")) return downloadedType;
  const ext = objectPath.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_MIME[ext] ?? "application/octet-stream";
};

async function buildPlan(supabaseHost: string): Promise<MigrationRef[]> {
  const refs: MigrationRef[] = [];

  const addCandidate = (
    label: string,
    oldUrl: string | null | undefined,
    apply: (newUrl: string) => Promise<number>,
  ) => {
    if (!oldUrl || isBlobUrl(oldUrl)) return;
    const parsed = parseSupabasePublicUrl(oldUrl, supabaseHost);
    if (!parsed) return;
    refs.push({ label, bucket: parsed.bucket, objectPath: parsed.objectPath, oldUrl, apply });
  };

  // 1. Product.imageUrl
  const products = await db.product.findMany({ select: { id: true, code: true, imageUrl: true } });
  for (const p of products) {
    addCandidate(`Product.imageUrl ${p.code}`, p.imageUrl, async (newUrl) => {
      const r = await db.product.updateMany({
        where: { id: p.id, imageUrl: p.imageUrl },
        data: { imageUrl: newUrl },
      });
      return r.count;
    });
  }

  // 2. ProductImage.url
  const productImages = await db.productImage.findMany({ select: { id: true, url: true } });
  for (const img of productImages) {
    addCandidate(`ProductImage.url ${img.id}`, img.url, async (newUrl) => {
      const r = await db.productImage.updateMany({
        where: { id: img.id, url: img.url },
        data: { url: newUrl },
      });
      return r.count;
    });
  }

  // 3. SiteContent shop_logo_url
  const logo = await db.siteContent.findFirst({
    where: { key: "shop_logo_url" },
    select: { key: true, value: true },
  });
  if (logo?.value) {
    addCandidate("SiteContent.shop_logo_url", logo.value, async (newUrl) => {
      const r = await db.siteContent.updateMany({
        where: { key: "shop_logo_url", value: logo.value },
        data: { value: newUrl },
      });
      return r.count;
    });
  }

  // 4. User.signatureUrl
  const users = await db.user.findMany({
    where: { signatureUrl: { not: null } },
    select: { id: true, signatureUrl: true },
  });
  for (const u of users) {
    addCandidate(`User.signatureUrl ${u.id}`, u.signatureUrl, async (newUrl) => {
      const r = await db.user.updateMany({
        where: { id: u.id, signatureUrl: u.signatureUrl },
        data: { signatureUrl: newUrl },
      });
      return r.count;
    });
  }

  // 5. DeliveryProof.signatureImageUrl + deliveryPhotoUrl
  const proofs = await db.deliveryProof.findMany({
    select: { id: true, signatureImageUrl: true, deliveryPhotoUrl: true },
  });
  for (const proof of proofs) {
    addCandidate(`DeliveryProof.signatureImageUrl ${proof.id}`, proof.signatureImageUrl, async (newUrl) => {
      const r = await db.deliveryProof.updateMany({
        where: { id: proof.id, signatureImageUrl: proof.signatureImageUrl },
        data: { signatureImageUrl: newUrl },
      });
      return r.count;
    });
    addCandidate(`DeliveryProof.deliveryPhotoUrl ${proof.id}`, proof.deliveryPhotoUrl, async (newUrl) => {
      const r = await db.deliveryProof.updateMany({
        where: { id: proof.id, deliveryPhotoUrl: proof.deliveryPhotoUrl },
        data: { deliveryPhotoUrl: newUrl },
      });
      return r.count;
    });
  }

  // 6. LineMessage.imageUrl (line-chat bucket)
  const lineMessages = await db.lineMessage.findMany({
    where: { imageUrl: { not: null } },
    select: { id: true, imageUrl: true },
  });
  for (const msg of lineMessages) {
    addCandidate(`LineMessage.imageUrl ${msg.id}`, msg.imageUrl, async (newUrl) => {
      const r = await db.lineMessage.updateMany({
        where: { id: msg.id, imageUrl: msg.imageUrl },
        data: { imageUrl: newUrl },
      });
      return r.count;
    });
  }

  return refs;
}

async function main() {
  const mode = getMode();
  console.log(`\nPublic image → Vercel Blob backfill mode: ${mode.toUpperCase()}\n`);

  // Dry-run only classifies stored URLs, so it just needs the Supabase host + DB.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is required.");
  }
  const supabaseHost = new URL(supabaseUrl).host;

  const refs = await buildPlan(supabaseHost);
  const byBucket = refs.reduce<Record<string, number>>((acc, ref) => {
    acc[ref.bucket] = (acc[ref.bucket] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`Rows to migrate: ${refs.length}`);
  for (const [bucket, count] of Object.entries(byBucket)) {
    console.log(`  ${bucket}: ${count}`);
  }

  if (mode === "dry-run") {
    for (const ref of refs.slice(0, 50)) {
      console.log(`  [${ref.bucket}] ${ref.label}\n    ${ref.objectPath}`);
    }
    if (refs.length > 50) console.log(`  …and ${refs.length - 50} more`);
    console.log("\nDry-run complete. Re-run with --apply to copy files and rewrite DB URLs.\n");
    return;
  }

  if (refs.length === 0) {
    console.log("\nNo public image URLs need migration.\n");
    return;
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is required for --apply.");
  }
  const rollback: RollbackEntry[] = [];
  const failures: { label: string; reason: string }[] = [];
  let migrated = 0;

  for (const ref of refs) {
    try {
      // Buckets are public, so the stored URL is fetchable without auth — no
      // Supabase service-role key needed.
      const response = await fetch(ref.oldUrl);
      if (!response.ok) {
        failures.push({ label: ref.label, reason: `download failed: HTTP ${response.status}` });
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = inferContentType(ref.objectPath, response.headers.get("content-type") ?? undefined);

      const result = await put(ref.objectPath, buffer, {
        access: "public",
        contentType,
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: PUBLIC_BLOB_CACHE_MAX_AGE_SECONDS,
      });

      const updated = await ref.apply(result.url);
      if (updated === 0) {
        // Row changed under us (e.g. re-uploaded). Blob object is harmless; skip.
        failures.push({ label: ref.label, reason: "db row no longer matches old URL (skipped)" });
        continue;
      }

      rollback.push({
        label: ref.label,
        bucket: ref.bucket,
        objectPath: ref.objectPath,
        oldUrl: ref.oldUrl,
        newUrl: result.url,
      });
      migrated += 1;
      console.log(`  migrated ${migrated}/${refs.length}: ${ref.label}`);
    } catch (err) {
      failures.push({ label: ref.label, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rollbackFile = path.join(process.cwd(), `backfill-blob-rollback-${stamp}.json`);
  writeFileSync(rollbackFile, JSON.stringify(rollback, null, 2), "utf8");

  await db.auditLog.create({
    data: {
      userId: null,
      userName: "system-backfill",
      userRole: "SYSTEM",
      action: AuditAction.UPDATE,
      entityType: "ImageStorageMigration",
      entityRef: "supabase→vercel-blob:public",
      meta: {
        phase: "phase-2-public-backfill",
        migrated,
        failed: failures.length,
        byBucket,
        rollbackFile: path.basename(rollbackFile),
      },
    },
  });

  console.log(`\nMigrated: ${migrated}. Failed/skipped: ${failures.length}.`);
  if (failures.length > 0) {
    console.log("Failures:");
    for (const f of failures.slice(0, 50)) console.log(`  - ${f.label}: ${f.reason}`);
  }
  console.log(`Rollback map written to: ${rollbackFile}`);
  console.log("\nDone. Re-run without --apply to confirm no remaining Supabase public URLs.\n");
}

main()
  .catch((error) => {
    console.error("Public image backfill failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
