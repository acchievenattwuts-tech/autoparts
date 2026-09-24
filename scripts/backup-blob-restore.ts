/**
 * backup-blob-restore.ts
 *
 * Uploads files from a local copy of the Drive Blob mirror back into a Vercel Blob
 * store, at their ORIGINAL pathnames — the counterpart of backup-blob-sync.ts.
 * See docs/backup-automation-runbook.md ("การกู้คืน") for the full procedure.
 *
 * DRY RUN BY DEFAULT. Without --apply the script only lists the target store
 * (read-only) and prints what it would upload / skip. Nothing is written.
 *
 * Usage:
 *   # 1. copy the mirror down from Drive first (rclone copy, never sync)
 *   # 2. dry run
 *   BLOB_READ_WRITE_TOKEN=... npx tsx scripts/backup-blob-restore.ts \
 *     --source D:\restore\blob-mirror --store public \
 *     [--manifest D:\restore\db\blob-manifest-2026-09-21.json] [--prefix products/]
 *   # 3. same command + --apply to upload
 *
 *   --store public   token BLOB_READ_WRITE_TOKEN,       access "public"
 *   --store private  token BLOB_SLIPS_READ_WRITE_TOKEN, access "private"
 *   --manifest       restore only the pathnames listed there (and check store/host)
 *   --prefix         restore only pathnames starting with this prefix
 *   --apply          actually upload
 *   --overwrite      replace objects that already exist (default: skip them)
 *
 * Safety: refuses when the public and private tokens are equal, when the manifest
 * or the target store belongs to the other kind of store, and when --source is the
 * Drive backup root. Skips `backups/`. Uploads sequentially with retry/backoff and
 * `allowOverwrite: false` unless --overwrite. Exits non-zero on any failure.
 */

import { readdir, readFile, stat } from "node:fs/promises";

import { list, put } from "@vercel/blob";

import {
  assertManifestMatchesStore,
  assertSourceIsMirrorRoot,
  assertSourceNameMatchesStore,
  assertTargetStoreKind,
  blobHostForStore,
  buildRestorePlan,
  executeRestorePlan,
  findForeignHosts,
  listLocalMirrorFiles,
  listTargetStore,
  parseRestoreCliOptions,
  parseRestoreManifest,
  resolveRestoreToken,
  restoreExitCode,
  storeIdFromToken,
  summarizePlan,
  STORE_TOKEN_ENV,
  type BlobStoreKind,
  type RestoreBlobClient,
  type RestoreCliOptions,
  type RestoreExecutionResult,
  type RestoreManifest,
  type RestorePlan,
} from "./backup-blob-restore-core";

/** Skip-exists lines are informational; the rest are counted in the totals. */
const MAX_SKIPPED_LINES = 20;
const MAX_WARNING_LINES = 50;

const vercelBlobClient: RestoreBlobClient = {
  list: async (options) => {
    const page = await list(options);
    return {
      blobs: page.blobs.map((blob) => ({ pathname: blob.pathname, url: blob.url })),
      cursor: page.cursor,
      hasMore: page.hasMore,
    };
  },
  put: async (pathname, body, options) => {
    const result = await put(pathname, body, options);
    return { pathname: result.pathname, url: result.url };
  },
};

const sleep = (ms: number): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, ms));

const printList = (title: string, lines: string[], max: number): void => {
  if (lines.length === 0) return;
  console.log(title);
  for (const line of lines.slice(0, max)) console.log(`   ${line}`);
  if (lines.length > max) console.log(`   ... and ${lines.length - max} more`);
};

const assertSourceDirectory = async (sourceDir: string, store: BlobStoreKind): Promise<void> => {
  assertSourceNameMatchesStore(sourceDir, store);
  const info = await stat(sourceDir).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`SOURCE_NOT_A_DIRECTORY:${sourceDir}`);
  assertSourceIsMirrorRoot(await readdir(sourceDir));
};

const loadManifest = async (manifestPath: string | null, store: BlobStoreKind): Promise<RestoreManifest | null> => {
  if (!manifestPath) return null;
  const manifest = parseRestoreManifest(await readFile(manifestPath, "utf8"));
  assertManifestMatchesStore(manifest, store);
  return manifest;
};

/**
 * Public DB rows hold full URLs whose hostname is the store id. Restoring into a
 * different store brings the files back under a different host, so those URLs
 * stay broken until the DB is rewritten — out of scope for this script.
 */
const warnAboutHosts = (manifest: RestoreManifest | null, targetHost: string, store: BlobStoreKind): void => {
  console.log(`🎯 Target store host: ${targetHost}`);
  if (!manifest) {
    if (store === "public") console.log("   (no --manifest: cannot compare with the hosts stored in DB URLs)");
    return;
  }
  const manifestUrls = manifest.files.flatMap((file) => (file.url ? [file.url] : []));
  const foreignHosts = findForeignHosts(manifestUrls, targetHost);
  if (foreignHosts.length === 0) return;

  if (store === "public") {
    console.warn("⚠️  WARNING: the manifest's URLs point at a DIFFERENT store:");
    for (const host of foreignHosts) console.warn(`   ${host}`);
    console.warn("   The DB stores full public URLs. Files restored here get NEW URLs on the host above,");
    console.warn("   so product/legacy image URLs in the DB stay broken until they are rewritten.");
    console.warn("   Rewriting DB URLs is NOT done by this script.");
  } else {
    console.log(`ℹ️  Manifest came from ${foreignHosts.join(", ")}. The private DB columns store pathnames, not URLs,`);
    console.log("   so restoring into a different private store keeps DB references valid (update the token in Vercel).");
  }
};

const printPlan = (plan: RestorePlan, options: RestoreCliOptions): void => {
  const verb = options.apply ? "" : "would ";
  printList(`⬆️  ${verb}upload (new):`, plan.items.filter((item) => item.action === "upload").map((item) => `${item.pathname} (${item.size} bytes)`), Number.POSITIVE_INFINITY);
  printList(`♻️  ${verb}OVERWRITE (--overwrite):`, plan.items.filter((item) => item.action === "overwrite").map((item) => item.pathname), Number.POSITIVE_INFINITY);
  printList("⏭️  already in target store — skipped:", plan.items.filter((item) => item.action === "skip-exists").map((item) => item.pathname), MAX_SKIPPED_LINES);
  printList("❌ listed in manifest but missing from --source:", plan.missingLocal, MAX_WARNING_LINES);
  printList("❌ unsafe pathnames refused:", plan.unsafePathnames, MAX_WARNING_LINES);
  printList(
    "⚠️  size differs from manifest (local copy will be uploaded as-is):",
    plan.sizeMismatches.map((mismatch) => `${mismatch.pathname} manifest=${mismatch.manifestSize} local=${mismatch.localSize}`),
    MAX_WARNING_LINES,
  );
};

const printTotals = (plan: RestorePlan, options: RestoreCliOptions, execution: RestoreExecutionResult | null): void => {
  const totals = summarizePlan(plan);
  console.log(options.apply ? "📊 Restore summary" : "📊 Dry-run summary (nothing was written)");
  console.log(`   store              ${options.store}${options.prefix ? ` (prefix ${options.prefix})` : ""}`);
  console.log(`   to upload          ${totals.upload.files} files / ${totals.upload.bytes} bytes`);
  console.log(`   to overwrite       ${totals.overwrite.files} files / ${totals.overwrite.bytes} bytes`);
  console.log(`   skipped (exists)   ${totals.skipExists.files} files`);
  console.log(`   skipped backups/   ${plan.skippedLegacyBackup}`);
  console.log(`   outside --prefix   ${plan.skippedOutsidePrefix}`);
  console.log(`   not in manifest    ${plan.notInManifest}`);
  console.log(`   missing locally    ${plan.missingLocal.length}`);
  console.log(`   unsafe pathnames   ${plan.unsafePathnames.length}`);
  console.log(`   size mismatches    ${plan.sizeMismatches.length}`);
  if (!execution) return;
  console.log(`   uploaded           ${execution.uploaded} files`);
  console.log(`   overwritten        ${execution.overwritten} files`);
  console.log(`   written bytes      ${execution.uploadedBytes}`);
  console.log(`   appeared meanwhile ${execution.skippedAlreadyExists} (skipped, not overwritten)`);
  console.log(`   FAILED             ${execution.failed.length}`);
  printList("❌ failed uploads:", execution.failed.map((failure) => `${failure.pathname}: ${failure.error}`), MAX_WARNING_LINES);
};

const main = async (): Promise<number> => {
  const options = parseRestoreCliOptions(process.argv.slice(2));
  const token = resolveRestoreToken(options.store, process.env);
  console.log(`🔐 ${options.apply ? "APPLY" : "DRY RUN"} — store ${options.store} (token ${STORE_TOKEN_ENV[options.store]})`);

  await assertSourceDirectory(options.sourceDir, options.store);
  const manifest = await loadManifest(options.manifestPath, options.store);

  console.log("📂 Reading local mirror...");
  const localFiles = await listLocalMirrorFiles(options.sourceDir);
  console.log(`   ${localFiles.length} local files`);

  console.log("📋 Listing target store (read-only)...");
  const snapshot = await listTargetStore(vercelBlobClient, token, options.prefix);
  console.log(`   ${snapshot.pathnames.size} objects already in target${options.prefix ? " under the prefix" : ""}`);
  assertTargetStoreKind(snapshot.urls, options.store);

  const targetHost = snapshot.urls[0] ? new URL(snapshot.urls[0]).host : blobHostForStore(storeIdFromToken(token), options.store);
  warnAboutHosts(manifest, targetHost, options.store);

  const plan = buildRestorePlan({
    localFiles,
    manifest,
    existingPathnames: snapshot.pathnames,
    prefix: options.prefix,
    overwrite: options.overwrite,
  });
  printPlan(plan, options);

  if (!options.apply) {
    printTotals(plan, options, null);
    console.log("ℹ️  Dry run only. Re-run the same command with --apply to upload.");
    return restoreExitCode(plan, null);
  }

  console.log("⬆️  Uploading sequentially...");
  const execution = await executeRestorePlan(plan, {
    client: vercelBlobClient,
    store: options.store,
    token,
    readBody: (absolutePath) => readFile(absolutePath),
    sleep,
    log: (line) => console.log(line),
  });
  printTotals(plan, options, execution);
  return restoreExitCode(plan, execution);
};

main()
  .then((exitCode) => {
    console.log(exitCode === 0 ? "✅ Blob restore finished" : "❌ Blob restore finished with problems (see above)");
    process.exit(exitCode);
  })
  .catch((error: unknown) => {
    console.error("❌ Blob restore refused/failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
