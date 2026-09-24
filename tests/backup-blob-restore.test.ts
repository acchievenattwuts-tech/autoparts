import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

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
  resolveLocalPath,
  resolveRestoreToken,
  restoreExitCode,
  storeIdFromToken,
  summarizePlan,
  UPLOAD_ATTEMPTS,
  type RestoreBlobClient,
  type RestoreManifest,
  type RestorePutOptions,
} from "../scripts/backup-blob-restore-core";

const PUBLIC_TOKEN = "vercel_blob_rw_PubStore123_secretA";
const PRIVATE_TOKEN = "vercel_blob_rw_PrivStore456_secretB";
const PUBLIC_HOST = "pubstore123.public.blob.vercel-storage.com";
const PRIVATE_HOST = "privstore456.private.blob.vercel-storage.com";

let sourceRoot = "";

before(async () => {
  sourceRoot = await mkdtemp(path.join(tmpdir(), "blob-restore-test-"));
  const files: Record<string, string> = {
    "products/AB123/main.webp": "main-image",
    "products/AB123/side.webp": "side",
    "expenses/2026/receipt.pdf": "pdf-body",
    "backups/2026-08-01/archive.json": "legacy",
  };
  for (const [pathname, body] of Object.entries(files)) {
    const target = path.join(sourceRoot, ...pathname.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
  }
});

after(async () => {
  await rm(sourceRoot, { recursive: true, force: true });
});

interface PutCall {
  pathname: string;
  body: string;
  options: RestorePutOptions;
}

interface MockClientOptions {
  existing?: string[];
  host?: string;
  failTimes?: Record<string, number>;
  alreadyExistsOnPut?: string[];
}

const createMockClient = (options: MockClientOptions = {}) => {
  const host = options.host ?? PUBLIC_HOST;
  const stored = new Set(options.existing ?? []);
  const failuresLeft = new Map(Object.entries(options.failTimes ?? {}));
  const putCalls: PutCall[] = [];
  const listCalls: Array<{ prefix?: string; cursor?: string }> = [];

  const client: RestoreBlobClient = {
    list: async ({ prefix, cursor }) => {
      listCalls.push({ prefix, cursor });
      const all = [...stored].filter((pathname) => !prefix || pathname.startsWith(prefix)).sort();
      // Two pages when there is more than one object, to exercise cursor handling.
      const page = cursor === "page-2" ? all.slice(1) : all.slice(0, 1);
      return {
        blobs: page.map((pathname) => ({ pathname, url: `https://${host}/${pathname}` })),
        cursor: cursor === "page-2" ? undefined : "page-2",
        hasMore: cursor !== "page-2" && all.length > 1,
      };
    },
    put: async (pathname, body, putOptions) => {
      putCalls.push({ pathname, body: body.toString("utf8"), options: putOptions });
      const remaining = failuresLeft.get(pathname) ?? 0;
      if (remaining > 0) {
        failuresLeft.set(pathname, remaining - 1);
        throw new Error("Vercel Blob: service unavailable");
      }
      if (options.alreadyExistsOnPut?.includes(pathname) && !putOptions.allowOverwrite) {
        throw new Error("Vercel Blob: This blob already exists, use `allowOverwrite: true` if you want to overwrite it.");
      }
      stored.add(pathname);
      return { pathname, url: `https://${host}/${pathname}` };
    },
  };

  return { client, putCalls, listCalls };
};

const noSleep = async (): Promise<void> => {};

const executeOptions = (client: RestoreBlobClient, store: "public" | "private" = "public") => ({
  client,
  store,
  token: store === "public" ? PUBLIC_TOKEN : PRIVATE_TOKEN,
  readBody: (absolutePath: string) => readFile(absolutePath),
  sleep: noSleep,
  log: () => {},
});

const manifestOf = (source: string, pathnames: Array<{ pathname: string; size?: number; host?: string }>): RestoreManifest => ({
  source,
  files: pathnames.map((file) => ({
    pathname: file.pathname,
    size: file.size,
    url: `https://${file.host ?? PUBLIC_HOST}/${file.pathname}`,
  })),
});

// --- CLI -------------------------------------------------------------------

test("CLI defaults to a dry run and requires --source and --store", () => {
  const options = parseRestoreCliOptions(["--source", "D:\\restore\\blob-mirror", "--store", "public"]);
  assert.deepEqual(options, {
    sourceDir: "D:\\restore\\blob-mirror",
    store: "public",
    manifestPath: null,
    prefix: null,
    apply: false,
    overwrite: false,
  });
  assert.throws(() => parseRestoreCliOptions(["--store", "public"]), /MISSING_ARG:--source/);
  assert.throws(() => parseRestoreCliOptions(["--source", "x"]), /MISSING_ARG:--store/);
  assert.throws(() => parseRestoreCliOptions(["--source", "x", "--store", "shared"]), /MISSING_ARG:--store/);
});

test("CLI rejects unknown flags, dangling values and unsafe prefixes", () => {
  assert.throws(() => parseRestoreCliOptions(["--source", "x", "--store", "public", "--overwite"]), /UNKNOWN_ARG:--overwite/);
  assert.throws(() => parseRestoreCliOptions(["--source", "--store", "public"]), /MISSING_VALUE:--source/);
  assert.throws(() => parseRestoreCliOptions(["--source", "x", "--store", "public", "--prefix", "../etc"]), /INVALID_ARG:--prefix/);
  const options = parseRestoreCliOptions(["--store", "private", "--source", "x", "--apply", "--overwrite", "--prefix", "2026/09/", "--manifest", "m.json"]);
  assert.equal(options.apply, true);
  assert.equal(options.overwrite, true);
  assert.equal(options.prefix, "2026/09/");
  assert.equal(options.manifestPath, "m.json");
});

// --- tokens / store identity -------------------------------------------------

test("token selection follows --store and refuses identical public/private tokens", () => {
  const env = { BLOB_READ_WRITE_TOKEN: PUBLIC_TOKEN, BLOB_SLIPS_READ_WRITE_TOKEN: PRIVATE_TOKEN };
  assert.equal(resolveRestoreToken("public", env), PUBLIC_TOKEN);
  assert.equal(resolveRestoreToken("private", env), PRIVATE_TOKEN);
  assert.throws(() => resolveRestoreToken("private", { BLOB_READ_WRITE_TOKEN: PUBLIC_TOKEN }), /BLOB_SLIPS_READ_WRITE_TOKEN_REQUIRED/);
  assert.throws(() => resolveRestoreToken("public", { BLOB_SLIPS_READ_WRITE_TOKEN: PRIVATE_TOKEN }), /BLOB_READ_WRITE_TOKEN_REQUIRED/);

  const same = { BLOB_READ_WRITE_TOKEN: PUBLIC_TOKEN, BLOB_SLIPS_READ_WRITE_TOKEN: ` ${PUBLIC_TOKEN} ` };
  assert.throws(() => resolveRestoreToken("private", same), /TOKEN_COLLISION/);
  assert.throws(() => resolveRestoreToken("public", same), /TOKEN_COLLISION/);
});

test("store host is derived from the token's store id", () => {
  assert.equal(storeIdFromToken(PUBLIC_TOKEN), "pubstore123");
  assert.equal(blobHostForStore("pubstore123", "public"), PUBLIC_HOST);
  assert.equal(blobHostForStore("PrivStore456", "private"), PRIVATE_HOST);
  assert.throws(() => storeIdFromToken("not-a-token"), /UNRECOGNIZED_BLOB_TOKEN_FORMAT/);
});

test("a token whose store serves the other access kind is refused", () => {
  assert.doesNotThrow(() => assertTargetStoreKind([`https://${PUBLIC_HOST}/a.webp`], "public"));
  assert.doesNotThrow(() => assertTargetStoreKind([], "public"));
  assert.throws(() => assertTargetStoreKind([`https://${PRIVATE_HOST}/a.webp`], "public"), /TARGET_STORE_KIND_MISMATCH/);
  assert.throws(() => assertTargetStoreKind([`https://${PUBLIC_HOST}/a.webp`], "private"), /TARGET_STORE_KIND_MISMATCH/);
});

test("foreign hosts are reported when manifest URLs point at another store", () => {
  const urls = [`https://${PUBLIC_HOST}/a.webp`, "https://oldstore.public.blob.vercel-storage.com/b.webp", "not a url"];
  assert.deepEqual(findForeignHosts(urls, PUBLIC_HOST), ["oldstore.public.blob.vercel-storage.com"]);
  assert.deepEqual(findForeignHosts(urls.slice(0, 1), PUBLIC_HOST.toUpperCase()), []);
});

// --- manifest ----------------------------------------------------------------

test("manifest parsing validates shape and store pairing", () => {
  const manifest = parseRestoreManifest(
    JSON.stringify({ source: "vercel-blob-private", totalItems: 1, files: [{ pathname: "2026/09/01/a.webp", url: `https://${PRIVATE_HOST}/2026/09/01/a.webp`, size: 3, etag: "x", uploadedAt: "2026-09-01T00:00:00.000Z" }] }),
  );
  assert.equal(manifest.files[0].pathname, "2026/09/01/a.webp");
  assert.doesNotThrow(() => assertManifestMatchesStore(manifest, "private"));
  // A private manifest into the PUBLIC store would publish PII.
  assert.throws(() => assertManifestMatchesStore(manifest, "public"), /MANIFEST_STORE_MISMATCH/);
  assert.throws(() => assertManifestMatchesStore({ files: manifest.files }, "public"), /MANIFEST_STORE_MISMATCH/);
  assert.throws(() => assertManifestMatchesStore(manifestOf("vercel-blob", []), "private"), /MANIFEST_STORE_MISMATCH/);

  assert.throws(() => parseRestoreManifest("{"), /MANIFEST_NOT_JSON/);
  assert.throws(() => parseRestoreManifest(JSON.stringify({ files: [{ url: "x" }] })), /MANIFEST_INVALID/);
});

// --- paths / source ------------------------------------------------------------

test("local paths never escape the source root", () => {
  assert.equal(resolveLocalPath(sourceRoot, "products/AB123/main.webp"), path.join(sourceRoot, "products", "AB123", "main.webp"));
  for (const unsafe of ["../outside.webp", "products/../../x", "/abs.webp", "a\\..\\b", "a//b", ""]) {
    assert.throws(() => resolveLocalPath(sourceRoot, unsafe), /UNSAFE_BLOB_PATHNAME/, unsafe);
  }
});

test("source must be the mirror folder itself, and a public restore refuses a private-looking folder", () => {
  assert.throws(() => assertSourceIsMirrorRoot(["blob-mirror", "db", "state"]), /SOURCE_LOOKS_LIKE_BACKUP_ROOT/);
  assert.doesNotThrow(() => assertSourceIsMirrorRoot(["products", "expenses", "2026"]));
  assert.throws(() => assertSourceNameMatchesStore("D:\\restore\\blob-mirror-private", "public"), /SOURCE_STORE_MISMATCH/);
  assert.doesNotThrow(() => assertSourceNameMatchesStore("D:\\restore\\blob-mirror-private", "private"));
  assert.doesNotThrow(() => assertSourceNameMatchesStore("D:\\restore\\blob-mirror", "public"));
});

test("local mirror walk maps files to forward-slash pathnames", async () => {
  const files = await listLocalMirrorFiles(sourceRoot);
  assert.deepEqual(
    files.map((file) => [file.pathname, file.size]),
    [
      ["backups/2026-08-01/archive.json", 6],
      ["expenses/2026/receipt.pdf", 8],
      ["products/AB123/main.webp", 10],
      ["products/AB123/side.webp", 4],
    ],
  );
});

// --- plan ----------------------------------------------------------------------

test("plan without manifest: skips backups/, honours --prefix, skips existing objects", async () => {
  const localFiles = await listLocalMirrorFiles(sourceRoot);
  const plan = buildRestorePlan({
    localFiles,
    manifest: null,
    existingPathnames: new Set(["products/AB123/side.webp"]),
    prefix: "products/",
    overwrite: false,
  });
  assert.deepEqual(plan.items.map((item) => [item.pathname, item.action]), [
    ["products/AB123/main.webp", "upload"],
    ["products/AB123/side.webp", "skip-exists"],
  ]);
  assert.equal(plan.skippedLegacyBackup, 1);
  assert.equal(plan.skippedOutsidePrefix, 1);
  assert.deepEqual(summarizePlan(plan), {
    upload: { files: 1, bytes: 10 },
    overwrite: { files: 0, bytes: 0 },
    skipExists: { files: 1, bytes: 4 },
  });
  assert.equal(restoreExitCode(plan, null), 0);
});

test("plan with manifest: only listed files, reports missing, unsafe and size mismatches", async () => {
  const localFiles = await listLocalMirrorFiles(sourceRoot);
  const manifest = manifestOf("vercel-blob", [
    { pathname: "products/AB123/main.webp", size: 10 },
    { pathname: "products/AB123/main.webp", size: 10 },
    { pathname: "products/AB123/side.webp", size: 999 },
    { pathname: "products/GONE/lost.webp", size: 1 },
    { pathname: "products/../escape.webp" },
    { pathname: "backups/2026-08-01/archive.json" },
  ]);
  const plan = buildRestorePlan({ localFiles, manifest, existingPathnames: new Set(["products/AB123/side.webp"]), prefix: null, overwrite: true });

  assert.deepEqual(plan.items.map((item) => [item.pathname, item.action]), [
    ["products/AB123/main.webp", "upload"],
    ["products/AB123/side.webp", "overwrite"],
  ]);
  assert.deepEqual(plan.missingLocal, ["products/GONE/lost.webp"]);
  assert.deepEqual(plan.unsafePathnames, ["products/../escape.webp"]);
  assert.deepEqual(plan.sizeMismatches, [{ pathname: "products/AB123/side.webp", manifestSize: 999, localSize: 4 }]);
  assert.equal(plan.skippedLegacyBackup, 1);
  // expenses/2026/receipt.pdf exists locally but is not listed, so it is ignored.
  assert.equal(plan.notInManifest, 1);
  assert.equal(restoreExitCode(plan, null), 1);
});

test("manifest content type is passed through when present", async () => {
  const localFiles = await listLocalMirrorFiles(sourceRoot);
  const plan = buildRestorePlan({
    localFiles,
    manifest: { source: "vercel-blob", files: [{ pathname: "expenses/2026/receipt.pdf", contentType: "application/pdf" }, { pathname: "products/AB123/main.webp" }] },
    existingPathnames: new Set(),
    prefix: null,
    overwrite: false,
  });
  assert.deepEqual(plan.items.map((item) => item.contentType), ["application/pdf", undefined]);
});

// --- target listing --------------------------------------------------------------

test("target store listing is read-only, paginated and forwards --prefix", async () => {
  const { client, putCalls, listCalls } = createMockClient({ existing: ["products/a.webp", "products/b.webp", "other/c.webp"] });
  const snapshot = await listTargetStore(client, PUBLIC_TOKEN, "products/");
  assert.deepEqual([...snapshot.pathnames].sort(), ["products/a.webp", "products/b.webp"]);
  assert.equal(snapshot.urls[0], `https://${PUBLIC_HOST}/products/a.webp`);
  assert.deepEqual(listCalls, [{ prefix: "products/", cursor: undefined }, { prefix: "products/", cursor: "page-2" }]);
  assert.equal(putCalls.length, 0);
});

// --- execution -------------------------------------------------------------------

const planFor = async (existing: string[], overwrite: boolean) =>
  buildRestorePlan({
    localFiles: await listLocalMirrorFiles(sourceRoot),
    manifest: null,
    existingPathnames: new Set(existing),
    prefix: "products/",
    overwrite,
  });

test("apply uploads only missing objects at the original pathname with safe put options", async () => {
  const { client, putCalls } = createMockClient({ existing: ["products/AB123/side.webp"] });
  const plan = await planFor(["products/AB123/side.webp"], false);
  const result = await executeRestorePlan(plan, executeOptions(client));

  assert.deepEqual(putCalls, [
    {
      pathname: "products/AB123/main.webp",
      body: "main-image",
      options: { access: "public", addRandomSuffix: false, allowOverwrite: false, token: PUBLIC_TOKEN },
    },
  ]);
  assert.deepEqual(result, { uploaded: 1, overwritten: 0, uploadedBytes: 10, skippedAlreadyExists: 0, failed: [] });
  assert.equal(restoreExitCode(plan, result), 0);
});

test("--overwrite sends allowOverwrite only for objects that already exist", async () => {
  const { client, putCalls } = createMockClient({ existing: ["products/AB123/side.webp"] });
  const plan = await planFor(["products/AB123/side.webp"], true);
  const result = await executeRestorePlan(plan, executeOptions(client));

  assert.deepEqual(putCalls.map((call) => [call.pathname, call.options.allowOverwrite]), [
    ["products/AB123/main.webp", false],
    ["products/AB123/side.webp", true],
  ]);
  assert.equal(result.uploaded, 1);
  assert.equal(result.overwritten, 1);
});

test("private restores use access private and the private token", async () => {
  const { client, putCalls } = createMockClient({ host: PRIVATE_HOST });
  const plan = await planFor([], false);
  await executeRestorePlan(plan, executeOptions(client, "private"));
  assert.ok(putCalls.length > 0);
  for (const call of putCalls) {
    assert.equal(call.options.access, "private");
    assert.equal(call.options.token, PRIVATE_TOKEN);
    assert.equal(call.options.addRandomSuffix, false);
  }
});

test("transient failures are retried with backoff; persistent ones are reported and fail the run", async () => {
  const sleeps: number[] = [];
  const { client, putCalls } = createMockClient({
    failTimes: { "products/AB123/main.webp": 1, "products/AB123/side.webp": UPLOAD_ATTEMPTS },
  });
  const plan = await planFor([], false);
  const result = await executeRestorePlan(plan, { ...executeOptions(client), sleep: async (ms) => { sleeps.push(ms); } });

  assert.equal(putCalls.filter((call) => call.pathname === "products/AB123/main.webp").length, 2);
  assert.equal(putCalls.filter((call) => call.pathname === "products/AB123/side.webp").length, UPLOAD_ATTEMPTS);
  assert.deepEqual(sleeps, [1000, 1000, 2000]);
  assert.equal(result.uploaded, 1);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].pathname, "products/AB123/side.webp");
  assert.match(result.failed[0].error, /BLOB_UPLOAD_FAILED/);
  assert.equal(restoreExitCode(plan, result), 1);
});

test("an object that appears between listing and upload is skipped, never overwritten", async () => {
  const { client, putCalls } = createMockClient({ alreadyExistsOnPut: ["products/AB123/main.webp"] });
  const plan = await planFor([], false);
  const result = await executeRestorePlan(plan, executeOptions(client));

  assert.equal(putCalls.filter((call) => call.pathname === "products/AB123/main.webp").length, 1);
  assert.equal(result.skippedAlreadyExists, 1);
  assert.equal(result.uploaded, 1);
  assert.deepEqual(result.failed, []);
});

test("a put that returns a different pathname counts as a failure", async () => {
  const { client } = createMockClient();
  const renaming: RestoreBlobClient = {
    list: client.list,
    put: async (pathname) => ({ pathname: `${pathname}-random`, url: "https://x/y" }),
  };
  const plan = await planFor([], false);
  const result = await executeRestorePlan(plan, executeOptions(renaming));
  assert.equal(result.uploaded, 0);
  assert.equal(result.failed.length, 2);
  assert.match(result.failed[0].error, /PATHNAME_CHANGED/);
});

test("dry-run path: building a plan never calls put", async () => {
  const { client, putCalls } = createMockClient({ existing: ["products/AB123/side.webp"] });
  const snapshot = await listTargetStore(client, PUBLIC_TOKEN, null);
  buildRestorePlan({ localFiles: await listLocalMirrorFiles(sourceRoot), manifest: null, existingPathnames: snapshot.pathnames, prefix: null, overwrite: true });
  assert.equal(putCalls.length, 0);
});
