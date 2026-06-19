import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function normalize(path) {
  return path.replace(/\\/g, "/");
}

function listFiles(root) {
  const absoluteRoot = join(repoRoot, root);
  const files = [];
  const stack = [absoluteRoot];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolutePath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }
      if (entry.isFile()) {
        files.push(normalize(absolutePath.slice(repoRoot.length + 1)));
      }
    }
  }

  return files;
}

function readRepoFile(path) {
  return readFileSync(join(repoRoot, path), "utf8");
}

const adminRouteAuthPattern =
  /\b(requirePermission|requireAnyPermission|requireAdmin|requireAuth|getRequiredSession|getSessionPermissionContext|auth)\s*\(/;

const adminApiRouteFiles = listFiles("app/api/admin").filter((file) =>
  normalize(file).endsWith("/route.ts"),
);

assert.ok(adminApiRouteFiles.length > 0, "Expected to find admin API route handlers");

const adminRoutesMissingAuth = adminApiRouteFiles.filter((file) => {
  const source = readRepoFile(file);
  return !adminRouteAuthPattern.test(source);
});

assert.deepEqual(
  adminRoutesMissingAuth.map(normalize),
  [],
  "Every app/api/admin route handler must enforce auth/permission locally",
);

const codeFiles = [...listFiles("app"), ...listFiles("lib")].filter(
  (file) => /\.(ts|tsx)$/.test(file) && !normalize(file).startsWith("lib/generated/"),
);
const unsafeRawUsages = codeFiles.flatMap((file) => {
  const source = readRepoFile(file);
  return source
    .split(/\r?\n/)
    .map((line, index) => ({ file: normalize(file), line: index + 1, text: line }))
    .filter((entry) => /\$(execute|query)RawUnsafe\b/.test(entry.text));
});

assert.deepEqual(
  unsafeRawUsages.map((entry) => `${entry.file}:${entry.line}`),
  [],
  "Business code must use parameterized raw SQL instead of raw-unsafe APIs",
);

console.log("Security hardening checks passed");
