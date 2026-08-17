/**
 * backup-blob-sync.ts
 *
 * Incremental mirror of the Vercel Blob store, used by .github/workflows/backup.yml.
 *
 * Vercel Blob is not S3-compatible, so rclone cannot read it directly. Instead this
 * script diffs the live store against the index written by the previous run (which
 * lives on Google Drive, not on the runner — the runner is ephemeral) and downloads
 * ONLY the objects whose etag changed. After the first run the weekly egress from
 * Vercel Blob is close to zero, which matters: this project is held to a ≤5GB/month
 * egress budget.
 *
 * Usage (all paths are absolute, set by the workflow):
 *   BLOB_READ_WRITE_TOKEN=... npx tsx scripts/backup-blob-sync.ts \
 *     --work-dir <dir> --state <previous blob-index.json | missing> --date 2026-08-17
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { get, list } from "@vercel/blob";

/** Objects the Backup Center's legacy "copy into the same store" job wrote. Never mirror those. */
const LEGACY_BACKUP_PREFIX = "backups/";
const LIST_PAGE_LIMIT = 1000;
/** Vercel Blob occasionally 500s under sustained reads; a few retries beat failing a whole weekly run. */
const DOWNLOAD_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000;

interface IndexEntry {
  etag: string;
  size: number;
  uploadedAt: string;
}

type BlobIndex = Record<string, IndexEntry>;

interface ManifestFile extends IndexEntry {
  pathname: string;
  url: string;
}

interface SyncSummary {
  totalFiles: number;
  totalBytes: number;
  changedFiles: number;
  changedBytes: number;
  removedFiles: number;
}

interface CliOptions {
  workDir: string;
  statePath: string | null;
  dateKey: string;
}

const parseCliOptions = (argv: string[]): CliOptions => {
  const read = (flag: string): string | null => {
    const index = argv.indexOf(flag);
    if (index === -1 || index + 1 >= argv.length) return null;
    return argv[index + 1];
  };

  const workDir = read("--work-dir");
  const dateKey = read("--date");
  if (!workDir) throw new Error("MISSING_ARG:--work-dir");
  if (!dateKey) throw new Error("MISSING_ARG:--date");

  return { workDir, statePath: read("--state"), dateKey };
};

/**
 * Blob pathnames are application-generated, but a mirror that writes outside its
 * work directory would be a path-traversal bug waiting to happen. Reject anything
 * that does not stay inside the mirror root.
 */
const resolveMirrorPath = (mirrorRoot: string, pathname: string): string => {
  const target = path.resolve(mirrorRoot, pathname);
  const root = path.resolve(mirrorRoot);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`UNSAFE_BLOB_PATHNAME:${pathname}`);
  }
  return target;
};

const readPreviousIndex = async (statePath: string | null): Promise<BlobIndex> => {
  if (!statePath) return {};
  try {
    const raw = await readFile(statePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as BlobIndex;
  } catch (error) {
    // A missing state file is the normal first-run case, not a failure. Anything
    // else (corrupt JSON) also degrades safely: an empty index re-downloads
    // everything, which is slow but correct.
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn(`⚠️  Previous blob index unreadable (${String(error)}) — treating this as a full sync.`);
    }
    return {};
  }
};

const listAllBlobs = async (token: string) => {
  const blobs: Awaited<ReturnType<typeof list>>["blobs"] = [];
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const page = await list({ cursor, limit: LIST_PAGE_LIMIT, token });
    blobs.push(...page.blobs.filter((blob) => !blob.pathname.startsWith(LEGACY_BACKUP_PREFIX)));
    cursor = page.cursor;
    hasMore = page.hasMore;
  }

  return blobs;
};

const blobAccessForUrl = (url: string): "public" | "private" =>
  url.includes(".private.blob.vercel-storage.com") ? "private" : "public";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const downloadBlob = async (url: string, destination: string, token: string): Promise<void> => {
  await mkdir(path.dirname(destination), { recursive: true });

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      const source = await get(url, { access: blobAccessForUrl(url), token });
      if (!source?.stream) throw new Error("BLOB_STREAM_UNAVAILABLE");

      await pipeline(
        Readable.fromWeb(source.stream as unknown as Parameters<typeof Readable.fromWeb>[0]),
        createWriteStream(destination),
      );
      return;
    } catch (error) {
      lastError = error;
      if (attempt < DOWNLOAD_ATTEMPTS) await sleep(RETRY_BASE_DELAY_MS * attempt);
    }
  }

  throw new Error(`BLOB_DOWNLOAD_FAILED:${url}:${String(lastError)}`);
};

const main = async (): Promise<void> => {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN_REQUIRED");

  const { workDir, statePath, dateKey } = parseCliOptions(process.argv.slice(2));
  const mirrorRoot = path.join(workDir, "blob-mirror");
  const stateDir = path.join(workDir, "state");
  const manifestDir = path.join(workDir, "db");

  await mkdir(mirrorRoot, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await mkdir(manifestDir, { recursive: true });

  console.log("📋 Listing Vercel Blob objects...");
  const [blobs, previousIndex] = await Promise.all([listAllBlobs(token), readPreviousIndex(statePath)]);
  console.log(`   found ${blobs.length} objects`);

  const nextIndex: BlobIndex = {};
  const manifest: ManifestFile[] = [];
  const changed: typeof blobs = [];
  let totalBytes = 0;

  for (const blob of blobs) {
    const entry: IndexEntry = {
      etag: blob.etag,
      size: blob.size,
      uploadedAt: blob.uploadedAt.toISOString(),
    };
    nextIndex[blob.pathname] = entry;
    manifest.push({ ...entry, pathname: blob.pathname, url: blob.url });
    totalBytes += blob.size;
    if (previousIndex[blob.pathname]?.etag !== blob.etag) changed.push(blob);
  }

  const removedFiles = Object.keys(previousIndex).filter((pathname) => !(pathname in nextIndex));
  const changedBytes = changed.reduce((sum, blob) => sum + blob.size, 0);

  console.log(`⬇️  ${changed.length} new/changed objects to download (${changedBytes} bytes)`);
  for (let index = 0; index < changed.length; index += 1) {
    const blob = changed[index];
    await downloadBlob(blob.url, resolveMirrorPath(mirrorRoot, blob.pathname), token);
    if ((index + 1) % 50 === 0 || index + 1 === changed.length) {
      console.log(`   ${index + 1}/${changed.length}`);
    }
  }

  await writeFile(path.join(stateDir, "blob-index.json"), JSON.stringify(nextIndex, null, 2), "utf8");
  await writeFile(
    path.join(manifestDir, `blob-manifest-${dateKey}.json`),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        source: "vercel-blob",
        totalItems: blobs.length,
        totalBytes,
        // Objects deleted from production since the last run. They stay in the
        // Drive mirror on purpose — that is what makes this a backup rather than
        // a sync, and it is the only protection against an accidental delete.
        removedSinceLastRun: removedFiles,
        files: manifest,
      },
      null,
      2,
    ),
    "utf8",
  );

  const summary: SyncSummary = {
    totalFiles: blobs.length,
    totalBytes,
    changedFiles: changed.length,
    changedBytes,
    removedFiles: removedFiles.length,
  };
  await writeFile(path.join(workDir, "blob-summary.json"), JSON.stringify(summary, null, 2), "utf8");

  console.log("✅ Blob sync complete");
  console.log(`   total       ${summary.totalFiles} files / ${summary.totalBytes} bytes`);
  console.log(`   downloaded  ${summary.changedFiles} files / ${summary.changedBytes} bytes`);
  console.log(`   removed in production since last run: ${summary.removedFiles} (kept in mirror)`);
};

main().catch((error: unknown) => {
  console.error("❌ Blob sync failed:", error);
  process.exit(1);
});
