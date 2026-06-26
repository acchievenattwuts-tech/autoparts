import { del, list } from "@vercel/blob";
import { db } from "@/lib/db";

/**
 * Sweeps orphaned product-image objects from the public Vercel Blob store —
 * objects under `products/` that no Product.imageUrl / ProductImage.url references
 * (e.g. images replaced during the dual-write window before backend-aware delete
 * landed).
 *
 * Read-only by default. Pass `--apply` to delete. Only touches the `products/`
 * prefix (logo/signature/delivery-proof live under other prefixes and are not
 * swept here).
 *
 * Run:  npm run sweep:blob-orphans            (dry-run)
 *       npm run sweep:blob-orphans -- --apply (delete orphans)
 */

const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";
const DELETE_BATCH = 100;
type Mode = "dry-run" | "apply";

const getMode = (): Mode => (process.argv.includes("--apply") ? "apply" : "dry-run");

function objectPathOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith(BLOB_HOST_SUFFIX)) return null;
    return decodeURIComponent(u.pathname.replace(/^\/+/, ""));
  } catch {
    return null;
  }
}

async function main() {
  const mode = getMode();
  console.log(`\nBlob product-image orphan sweep mode: ${mode.toUpperCase()}\n`);

  if (mode === "apply" && !process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is required for --apply.");
  }

  // 1. Object paths still referenced by the DB.
  const [products, images] = await Promise.all([
    db.product.findMany({ where: { imageUrl: { not: null } }, select: { imageUrl: true } }),
    db.productImage.findMany({ select: { url: true } }),
  ]);
  const referenced = new Set<string>();
  for (const p of products) {
    const op = p.imageUrl ? objectPathOf(p.imageUrl) : null;
    if (op) referenced.add(op);
  }
  for (const i of images) {
    const op = objectPathOf(i.url);
    if (op) referenced.add(op);
  }

  // 2. List every Blob object under products/ and flag the unreferenced ones.
  const orphans: string[] = [];
  let scanned = 0;
  let cursor: string | undefined;
  do {
    const res = await list({ prefix: "products/", cursor, limit: 1000 });
    for (const b of res.blobs) {
      scanned += 1;
      if (!referenced.has(b.pathname)) orphans.push(b.url);
    }
    cursor = res.hasMore ? res.cursor : undefined;
  } while (cursor);

  console.log(`Scanned ${scanned} Blob objects under products/.`);
  console.log(`Referenced by DB: ${referenced.size}. Orphans: ${orphans.length}`);
  for (const o of orphans.slice(0, 30)) console.log("  orphan: " + o);
  if (orphans.length > 30) console.log(`  …and ${orphans.length - 30} more`);

  if (mode === "dry-run") {
    console.log("\nDry-run complete. Re-run with --apply to delete the orphans.\n");
    return;
  }
  if (orphans.length === 0) {
    console.log("\nNo orphans to delete.\n");
    return;
  }

  for (let i = 0; i < orphans.length; i += DELETE_BATCH) {
    await del(orphans.slice(i, i + DELETE_BATCH));
    console.log(`deleted ${Math.min(i + DELETE_BATCH, orphans.length)}/${orphans.length}`);
  }
  console.log("\nDone.\n");
}

main()
  .catch((error) => {
    console.error("Blob orphan sweep failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
