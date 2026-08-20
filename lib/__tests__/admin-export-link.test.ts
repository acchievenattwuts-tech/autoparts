import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const adminRoot = path.join(repoRoot, "app", "admin");

function listTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listTsxFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [entryPath] : [];
  });
}

test("admin export and download routes are never rendered with Next Link", () => {
  const violations: string[] = [];

  for (const filePath of listTsxFiles(adminRoot)) {
    const source = readFileSync(filePath, "utf8");
    const openingLinkTags = source.match(/<Link\b[\s\S]*?>/g) ?? [];
    if (openingLinkTags.some((tag) => /(?:\/export|export-excel|\/download)/.test(tag))) {
      violations.push(path.relative(repoRoot, filePath));
    }
  }

  assert.deepEqual(violations, []);
});

test("AdminExportLink remains a native anchor without next/link", () => {
  const source = readFileSync(
    path.join(repoRoot, "components", "shared", "AdminExportLink.tsx"),
    "utf8",
  );

  assert.match(source, /return\s+<a\s/);
  assert.doesNotMatch(source, /from\s+["']next\/link["']/);
});
