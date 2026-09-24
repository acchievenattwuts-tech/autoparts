/**
 * backup-blob-restore-core.ts
 *
 * Pure-ish helpers behind scripts/backup-blob-restore.ts, split out so they can be
 * tested with temp directories and a mocked blob client (tests/backup-blob-restore.test.ts).
 * Nothing here reads process.env or talks to Vercel Blob on its own: the CLI passes
 * the environment and a real `@vercel/blob` client in.
 *
 * Restore is the dangerous direction of the backup: it WRITES into a Blob store.
 * Every guard that decides whether a write may happen lives in this file.
 */

import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

export type BlobStoreKind = "public" | "private";

/** Objects the Backup Center's legacy "copy into the same store" job wrote. Never restored. */
export const LEGACY_BACKUP_PREFIX = "backups/";
export const LIST_PAGE_LIMIT = 1000;
/** Same retry budget as backup-blob-sync.ts: Vercel Blob occasionally 500s under sustained traffic. */
export const UPLOAD_ATTEMPTS = 3;
export const RETRY_BASE_DELAY_MS = 1000;
export const PROGRESS_LOG_EVERY = 50;

export const STORE_TOKEN_ENV: Record<BlobStoreKind, string> = {
  public: "BLOB_READ_WRITE_TOKEN",
  private: "BLOB_SLIPS_READ_WRITE_TOKEN",
};

/** `source` written by backup-blob-sync.ts (`--source-label private` adds the suffix). */
export const MANIFEST_SOURCE: Record<BlobStoreKind, string> = {
  public: "vercel-blob",
  private: "vercel-blob-private",
};

/**
 * Top-level folders of the Drive backup root. Seeing one of them directly inside
 * --source means the operator pointed at `autoparts-backup/` instead of the mirror,
 * and every pathname would gain a bogus `blob-mirror/...` prefix.
 */
const BACKUP_ROOT_FOLDERS = new Set(["blob-mirror", "blob-mirror-private", "db", "db-private", "state", "state-private", "reports"]);

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface RestoreCliOptions {
  sourceDir: string;
  store: BlobStoreKind;
  manifestPath: string | null;
  prefix: string | null;
  apply: boolean;
  overwrite: boolean;
}

const VALUE_FLAGS = new Set(["--source", "--store", "--manifest", "--prefix"]);
const BOOLEAN_FLAGS = new Set(["--apply", "--overwrite"]);

/**
 * Unknown flags are rejected rather than ignored: a typo such as `--overwite` must
 * not run with a different meaning than the operator typed.
 */
export const parseRestoreCliOptions = (argv: string[]): RestoreCliOptions => {
  const values = new Map<string, string>();
  const booleans = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (BOOLEAN_FLAGS.has(flag)) {
      booleans.add(flag);
    } else if (VALUE_FLAGS.has(flag)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`MISSING_VALUE:${flag}`);
      values.set(flag, value);
      index += 1;
    } else {
      throw new Error(`UNKNOWN_ARG:${flag}`);
    }
  }

  const sourceDir = values.get("--source");
  if (!sourceDir) throw new Error("MISSING_ARG:--source");
  const store = values.get("--store");
  if (store !== "public" && store !== "private") throw new Error("MISSING_ARG:--store public|private");

  const prefix = values.get("--prefix") ?? null;
  if (prefix !== null && !isSafePathnamePrefix(prefix)) throw new Error(`INVALID_ARG:--prefix:${prefix}`);

  return {
    sourceDir,
    store,
    manifestPath: values.get("--manifest") ?? null,
    prefix,
    apply: booleans.has("--apply"),
    overwrite: booleans.has("--overwrite"),
  };
};

// ---------------------------------------------------------------------------
// Tokens and store identity
// ---------------------------------------------------------------------------

/**
 * Picks the token for the target store. Refuses when both tokens are set to the
 * same value — the same check the backup workflow makes — because then a
 * "private" restore would put PII into the public store (or vice versa).
 */
export const resolveRestoreToken = (store: BlobStoreKind, env: Record<string, string | undefined>): string => {
  const publicToken = env[STORE_TOKEN_ENV.public]?.trim() ?? "";
  const privateToken = env[STORE_TOKEN_ENV.private]?.trim() ?? "";
  const token = store === "public" ? publicToken : privateToken;

  if (!token) throw new Error(`${STORE_TOKEN_ENV[store]}_REQUIRED`);
  if (publicToken && privateToken && publicToken === privateToken) {
    throw new Error(`TOKEN_COLLISION:${STORE_TOKEN_ENV.private} equals ${STORE_TOKEN_ENV.public} — they must be different stores`);
  }
  return token;
};

/** `vercel_blob_rw_<storeId>_<secret>` — the same split @vercel/blob uses internally. */
export const storeIdFromToken = (token: string): string => {
  const storeId = token.split("_")[3] ?? "";
  if (!storeId) throw new Error("UNRECOGNIZED_BLOB_TOKEN_FORMAT");
  return storeId.toLowerCase();
};

export const blobHostForStore = (storeId: string, store: BlobStoreKind): string =>
  `${storeId.toLowerCase()}.${store}.blob.vercel-storage.com`;

export const blobAccessForUrl = (url: string): BlobStoreKind =>
  url.includes(".private.blob.vercel-storage.com") ? "private" : "public";

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
};

/** Distinct hosts found in `urls` that are not `targetHost`. */
export const findForeignHosts = (urls: string[], targetHost: string): string[] => {
  const target = targetHost.toLowerCase();
  const hosts = new Set<string>();
  for (const url of urls) {
    const host = hostOf(url);
    if (host && host !== target) hosts.add(host);
  }
  return [...hosts].sort();
};

/**
 * The target store's own URLs say whether it is really public or private. A token
 * for the wrong kind of store is refused before any upload.
 */
export const assertTargetStoreKind = (existingUrls: string[], store: BlobStoreKind): void => {
  const wrong = existingUrls.find((url) => blobAccessForUrl(url) !== store);
  if (wrong) {
    throw new Error(`TARGET_STORE_KIND_MISMATCH:--store ${store} but the token's store serves ${blobAccessForUrl(wrong)} URLs (${hostOf(wrong) ?? wrong})`);
  }
};

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

const manifestFileSchema = z.object({
  pathname: z.string().min(1),
  url: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
  // Not written by backup-blob-sync.ts today; honoured if a future manifest adds it.
  contentType: z.string().min(1).optional(),
});

const manifestSchema = z.object({
  source: z.string().optional(),
  files: z.array(manifestFileSchema),
});

export type RestoreManifestFile = z.infer<typeof manifestFileSchema>;
export type RestoreManifest = z.infer<typeof manifestSchema>;

export const parseRestoreManifest = (raw: string): RestoreManifest => {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(`MANIFEST_NOT_JSON:${String(error)}`);
  }
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) throw new Error(`MANIFEST_INVALID:${parsed.error.issues[0]?.message ?? "unknown"}`);
  return parsed.data;
};

/**
 * A public manifest restored into the private store is merely wasteful; a private
 * manifest restored into the PUBLIC store leaks PII to anyone with the URL. Both
 * directions are refused so the rule stays simple.
 */
export const assertManifestMatchesStore = (manifest: RestoreManifest, store: BlobStoreKind): void => {
  if (manifest.source !== undefined && manifest.source !== MANIFEST_SOURCE[store]) {
    throw new Error(`MANIFEST_STORE_MISMATCH:manifest source "${manifest.source}" is not "${MANIFEST_SOURCE[store]}" (--store ${store})`);
  }
  const wrong = manifest.files.find((file) => file.url && blobAccessForUrl(file.url) !== store);
  if (wrong) {
    throw new Error(`MANIFEST_STORE_MISMATCH:manifest lists ${blobAccessForUrl(wrong.url ?? "")} URL for ${wrong.pathname} (--store ${store})`);
  }
};

// ---------------------------------------------------------------------------
// Pathnames
// ---------------------------------------------------------------------------

const hasUnsafeSegments = (value: string): boolean =>
  value.includes("\\") || value.includes("\0") || value.split("/").some((segment) => segment === "." || segment === "..");

/** A blob pathname we are willing to write: relative, forward slashes, no traversal, no empty segments. */
export const isSafeBlobPathname = (pathname: string): boolean =>
  pathname.length > 0 &&
  !pathname.startsWith("/") &&
  !hasUnsafeSegments(pathname) &&
  !pathname.split("/").some((segment) => segment.length === 0);

/** A --prefix may end in "/" (a folder) but must otherwise follow the pathname rules. */
export const isSafePathnamePrefix = (prefix: string): boolean =>
  prefix.length > 0 && !prefix.startsWith("/") && !hasUnsafeSegments(prefix);

/** Local relative path (OS separators) → blob pathname (forward slashes). */
export const toBlobPathname = (relativePath: string): string => relativePath.split(path.sep).join("/");

/** Blob pathname → absolute local path, refusing anything that escapes the source root. */
export const resolveLocalPath = (sourceRoot: string, pathname: string): string => {
  if (!isSafeBlobPathname(pathname)) throw new Error(`UNSAFE_BLOB_PATHNAME:${pathname}`);
  const root = path.resolve(sourceRoot);
  const target = path.resolve(root, ...pathname.split("/"));
  if (!target.startsWith(root + path.sep)) throw new Error(`UNSAFE_BLOB_PATHNAME:${pathname}`);
  return target;
};

export type PathnameFilterResult = "include" | "legacy-backup" | "outside-prefix";

export const classifyPathname = (pathname: string, prefix: string | null): PathnameFilterResult => {
  if (pathname.startsWith(LEGACY_BACKUP_PREFIX)) return "legacy-backup";
  if (prefix !== null && !pathname.startsWith(prefix)) return "outside-prefix";
  return "include";
};

// ---------------------------------------------------------------------------
// Local mirror
// ---------------------------------------------------------------------------

export interface LocalMirrorFile {
  pathname: string;
  absolutePath: string;
  size: number;
}

/** Refuses a --source that is the Drive backup root rather than one mirror folder. */
export const assertSourceIsMirrorRoot = (topLevelNames: string[]): void => {
  const suspicious = topLevelNames.filter((name) => BACKUP_ROOT_FOLDERS.has(name));
  if (suspicious.length > 0) {
    throw new Error(`SOURCE_LOOKS_LIKE_BACKUP_ROOT:found ${suspicious.join(", ")} — point --source at the blob-mirror or blob-mirror-private folder itself`);
  }
};

/**
 * A public restore from a folder named like the private mirror is refused: that
 * is exactly how payment slips would end up on public URLs.
 */
export const assertSourceNameMatchesStore = (sourceDir: string, store: BlobStoreKind): void => {
  const name = path.basename(path.resolve(sourceDir)).toLowerCase();
  if (store === "public" && name.includes("private")) {
    throw new Error(`SOURCE_STORE_MISMATCH:--store public but --source folder "${name}" looks like the PRIVATE mirror`);
  }
};

/** Recursive walk of regular files. Symlinks are not followed. Sorted by pathname. */
export const listLocalMirrorFiles = async (sourceRoot: string): Promise<LocalMirrorFile[]> => {
  const root = path.resolve(sourceRoot);
  const files: LocalMirrorFile[] = [];
  const pending: string[] = [root];

  while (pending.length > 0) {
    const directory = pending.pop() as string;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolutePath);
      } else if (entry.isFile()) {
        const info = await stat(absolutePath);
        files.push({ pathname: toBlobPathname(path.relative(root, absolutePath)), absolutePath, size: info.size });
      }
    }
  }

  return files.sort((left, right) => left.pathname.localeCompare(right.pathname));
};

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export type RestoreAction = "upload" | "overwrite" | "skip-exists";

export interface RestorePlanItem {
  pathname: string;
  absolutePath: string;
  size: number;
  contentType: string | undefined;
  action: RestoreAction;
}

export interface SizeMismatch {
  pathname: string;
  manifestSize: number;
  localSize: number;
}

export interface RestorePlan {
  items: RestorePlanItem[];
  /** Listed in the manifest but absent from --source: the restore would be incomplete. */
  missingLocal: string[];
  /** Local file differs in size from the manifest (usually a newer version of the same pathname). */
  sizeMismatches: SizeMismatch[];
  /** Pathnames that cannot be restored safely (traversal, backslashes, empty segments). */
  unsafePathnames: string[];
  skippedLegacyBackup: number;
  skippedOutsidePrefix: number;
  /** Local files ignored because --manifest did not list them. */
  notInManifest: number;
}

export interface BuildRestorePlanInput {
  localFiles: LocalMirrorFile[];
  manifest: RestoreManifest | null;
  existingPathnames: ReadonlySet<string>;
  prefix: string | null;
  overwrite: boolean;
}

interface Candidate {
  pathname: string;
  contentType: string | undefined;
  manifestSize: number | undefined;
}

const emptyPlan = (): RestorePlan => ({
  items: [],
  missingLocal: [],
  sizeMismatches: [],
  unsafePathnames: [],
  skippedLegacyBackup: 0,
  skippedOutsidePrefix: 0,
  notInManifest: 0,
});

const candidatesFrom = (input: BuildRestorePlanInput): Candidate[] => {
  if (!input.manifest) {
    return input.localFiles.map((file) => ({ pathname: file.pathname, contentType: undefined, manifestSize: undefined }));
  }
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const file of input.manifest.files) {
    if (seen.has(file.pathname)) continue;
    seen.add(file.pathname);
    candidates.push({ pathname: file.pathname, contentType: file.contentType, manifestSize: file.size });
  }
  return candidates;
};

const actionFor = (pathname: string, input: BuildRestorePlanInput): RestoreAction => {
  if (!input.existingPathnames.has(pathname)) return "upload";
  return input.overwrite ? "overwrite" : "skip-exists";
};

/** Decides, for every candidate pathname, whether it would be uploaded, overwritten or skipped. */
export const buildRestorePlan = (input: BuildRestorePlanInput): RestorePlan => {
  const plan = emptyPlan();
  const localByPathname = new Map(input.localFiles.map((file) => [file.pathname, file]));
  const candidates = candidatesFrom(input);

  if (input.manifest) {
    const listed = new Set(candidates.map((candidate) => candidate.pathname));
    plan.notInManifest = input.localFiles.filter((file) => !listed.has(file.pathname)).length;
  }

  for (const candidate of candidates) {
    const filter = classifyPathname(candidate.pathname, input.prefix);
    if (filter === "legacy-backup") {
      plan.skippedLegacyBackup += 1;
      continue;
    }
    if (filter === "outside-prefix") {
      plan.skippedOutsidePrefix += 1;
      continue;
    }
    if (!isSafeBlobPathname(candidate.pathname)) {
      plan.unsafePathnames.push(candidate.pathname);
      continue;
    }
    const local = localByPathname.get(candidate.pathname);
    if (!local) {
      plan.missingLocal.push(candidate.pathname);
      continue;
    }
    if (candidate.manifestSize !== undefined && candidate.manifestSize !== local.size) {
      plan.sizeMismatches.push({ pathname: candidate.pathname, manifestSize: candidate.manifestSize, localSize: local.size });
    }
    plan.items.push({
      pathname: candidate.pathname,
      absolutePath: local.absolutePath,
      size: local.size,
      contentType: candidate.contentType,
      action: actionFor(candidate.pathname, input),
    });
  }

  return plan;
};

export interface PlanTotals {
  upload: { files: number; bytes: number };
  overwrite: { files: number; bytes: number };
  skipExists: { files: number; bytes: number };
}

export const summarizePlan = (plan: RestorePlan): PlanTotals => {
  const totals: PlanTotals = {
    upload: { files: 0, bytes: 0 },
    overwrite: { files: 0, bytes: 0 },
    skipExists: { files: 0, bytes: 0 },
  };
  for (const item of plan.items) {
    const bucket = item.action === "upload" ? totals.upload : item.action === "overwrite" ? totals.overwrite : totals.skipExists;
    bucket.files += 1;
    bucket.bytes += item.size;
  }
  return totals;
};

// ---------------------------------------------------------------------------
// Blob client boundary (real @vercel/blob in the CLI, a mock in tests)
// ---------------------------------------------------------------------------

export interface RestoreListedBlob {
  pathname: string;
  url: string;
}

export interface RestoreListPage {
  blobs: RestoreListedBlob[];
  cursor?: string;
  hasMore: boolean;
}

export interface RestorePutOptions {
  access: BlobStoreKind;
  addRandomSuffix: false;
  allowOverwrite: boolean;
  contentType?: string;
  token: string;
}

export interface RestoreBlobClient {
  list: (options: { cursor?: string; limit: number; prefix?: string; token: string }) => Promise<RestoreListPage>;
  put: (pathname: string, body: Buffer, options: RestorePutOptions) => Promise<{ pathname: string; url: string }>;
}

export interface TargetStoreSnapshot {
  pathnames: Set<string>;
  urls: string[];
}

/** Read-only listing of the target store (optionally narrowed by --prefix). */
export const listTargetStore = async (
  client: RestoreBlobClient,
  token: string,
  prefix: string | null,
): Promise<TargetStoreSnapshot> => {
  const snapshot: TargetStoreSnapshot = { pathnames: new Set(), urls: [] };
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const page = await client.list({ cursor, limit: LIST_PAGE_LIMIT, token, ...(prefix ? { prefix } : {}) });
    for (const blob of page.blobs) {
      snapshot.pathnames.add(blob.pathname);
      snapshot.urls.push(blob.url);
    }
    cursor = page.cursor;
    hasMore = page.hasMore;
  }

  return snapshot;
};

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface RestoreFailure {
  pathname: string;
  error: string;
}

export interface RestoreExecutionResult {
  uploaded: number;
  overwritten: number;
  uploadedBytes: number;
  /** Planned as new, but the store already had it when we wrote (someone uploaded meanwhile). */
  skippedAlreadyExists: number;
  failed: RestoreFailure[];
}

export interface ExecuteRestoreOptions {
  client: RestoreBlobClient;
  store: BlobStoreKind;
  token: string;
  readBody: (absolutePath: string) => Promise<Buffer>;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

/** @vercel/blob answers a non-overwriting put on an existing pathname with this message. */
const isAlreadyExistsError = (error: unknown): boolean =>
  error instanceof Error && /already exists/i.test(error.message);

type UploadOutcome = "written" | "already-exists";

const uploadWithRetry = async (item: RestorePlanItem, options: ExecuteRestoreOptions): Promise<UploadOutcome> => {
  const body = await options.readBody(item.absolutePath);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      const result = await options.client.put(item.pathname, body, {
        access: options.store,
        addRandomSuffix: false,
        allowOverwrite: item.action === "overwrite",
        ...(item.contentType ? { contentType: item.contentType } : {}),
        token: options.token,
      });
      // The DB references the exact pathname; a renamed object would be a silent miss.
      if (result.pathname !== item.pathname) throw new Error(`PATHNAME_CHANGED:${result.pathname}`);
      return "written";
    } catch (error) {
      if (item.action === "upload" && isAlreadyExistsError(error)) return "already-exists";
      lastError = error;
      if (attempt < UPLOAD_ATTEMPTS) await options.sleep(RETRY_BASE_DELAY_MS * attempt);
    }
  }

  throw new Error(`BLOB_UPLOAD_FAILED:${String(lastError)}`);
};

/**
 * Uploads every "upload"/"overwrite" item sequentially. "skip-exists" items are
 * never sent. One failed file does not stop the run — the summary lists it and
 * the CLI exits non-zero.
 */
export const executeRestorePlan = async (
  plan: RestorePlan,
  options: ExecuteRestoreOptions,
): Promise<RestoreExecutionResult> => {
  const result: RestoreExecutionResult = { uploaded: 0, overwritten: 0, uploadedBytes: 0, skippedAlreadyExists: 0, failed: [] };
  const work = plan.items.filter((item) => item.action !== "skip-exists");

  for (let index = 0; index < work.length; index += 1) {
    const item = work[index];
    try {
      const outcome = await uploadWithRetry(item, options);
      if (outcome === "already-exists") {
        result.skippedAlreadyExists += 1;
      } else {
        if (item.action === "overwrite") result.overwritten += 1;
        else result.uploaded += 1;
        result.uploadedBytes += item.size;
      }
    } catch (error) {
      result.failed.push({ pathname: item.pathname, error: error instanceof Error ? error.message : String(error) });
    }
    if ((index + 1) % PROGRESS_LOG_EVERY === 0 || index + 1 === work.length) {
      options.log(`   ${index + 1}/${work.length}`);
    }
  }

  return result;
};

/** Exit code rule: any failed upload, missing local file or unsafe pathname makes the run fail. */
export const restoreExitCode = (plan: RestorePlan, execution: RestoreExecutionResult | null): number =>
  plan.missingLocal.length > 0 || plan.unsafePathnames.length > 0 || (execution?.failed.length ?? 0) > 0 ? 1 : 0;
