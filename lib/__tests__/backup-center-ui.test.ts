import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import BackupCenterClient from "@/app/admin/(protected)/backup-center/BackupCenterClient";
import BackupCenterLoading from "@/app/admin/(protected)/backup-center/loading";
import { QUICK_COMMANDS, filterCommandsByPermission } from "@/lib/quick-search-commands";

const source = (name: string) => readFileSync(
  path.join(process.cwd(), "app/admin/(protected)/backup-center", name), "utf8",
);

for (const configured of [false, true]) {
  test(`Backup Center renders only Google Drive controls (configured=${configured})`, () => {
    const html = renderToStaticMarkup(createElement(BackupCenterClient, {
      envStatus: { githubBackup: configured },
    }));
    assert.match(html, /Backup อัตโนมัติเข้า Google Drive/);
    assert.match(html, /สำรองข้อมูลเดี๋ยวนี้/);
    assert.match(html, /ตรวจสถานะล่าสุด/);
    assert.equal((html.match(/<button\b/g) ?? []).length, 2);
    assert.equal((html.match(/disabled=""/g) ?? []).length, configured ? 0 : 2);
    assert.doesNotMatch(html, /Vercel Blob Manifest|Blob Archive|PostgreSQL Download|Check pg_dump|แสดง 20 งานล่าสุด/);
    assert.match(html, /dark:/);
    if (configured) {
      assert.doesNotMatch(html, /ยังใช้งานไม่ได้/);
      assert.match(html, /กำลังโหลดสถานะ/);
    } else {
      assert.match(html, /GITHUB_BACKUP_TOKEN/);
      assert.match(html, /GITHUB_BACKUP_REPO/);
    }
  });
}

test("Backup Center has no legacy API calls and keeps Google Drive dispatch, polling and progress", () => {
  const client = source("BackupCenterClient.tsx");
  assert.doesNotMatch(client, /\/backup-center\/(?:jobs|pg-dump-status|download)/);
  assert.doesNotMatch(client, /BackupJob|PgDumpHelper|BackupActionPanel|startDownload/);
  assert.match(client, /fetch\("\/api\/admin\/backup-center\/github-backup", \{ method: "POST" \}\)/);
  assert.match(client, /10_000/);
  assert.match(client, /role="progressbar"/);
  assert.match(client, /formatElapsed\(progress.startedAt/);
  assert.match(client, /runs.map\(\(run\)/);
  assert.match(client, /href=\{run.htmlUrl\}/);

  const page = source("page.tsx");
  assert.doesNotMatch(page, /@\/lib\/backup-center/);
  assert.match(page, /isGithubBackupConfigured\(\)/);
  assert.match(page, /requirePermission\("system.backup"\)/);
});

test("Backup Center loading keeps light and dark styles without legacy two-card layout", () => {
  const html = renderToStaticMarkup(createElement(BackupCenterLoading));
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /bg-sky-50/);
  assert.match(html, /dark:bg-sky-400\/10/);
  assert.doesNotMatch(html, /sm:grid-cols-2/);
});

test("Google Drive quick search keeps the Backup Center permission gate", () => {
  const commands = QUICK_COMMANDS.filter((command) => command.href === "/admin/backup-center");
  assert.equal(commands.length, 1);
  assert.equal(commands[0].permission, "system.backup");
  assert.match(commands[0].keywords ?? "", /google drive github/);
  assert.equal(filterCommandsByPermission(commands, "STAFF", []).length, 0);
  assert.equal(filterCommandsByPermission(commands, "STAFF", ["system.backup"]).length, 1);
});
