import test from "node:test";
import assert from "node:assert/strict";

import { deriveGithubBackupProgress } from "@/lib/github-backup-progress";

test("reports a queued backup before GitHub creates job steps", () => {
  const progress = deriveGithubBackupProgress("QUEUED", [], null);

  assert.equal(progress.percent, 0);
  assert.equal(progress.stage, 0);
  assert.equal(progress.totalStages, 7);
  assert.match(progress.label, /รอ GitHub/);
});

test("maps the long Google Drive upload to an approximate active stage", () => {
  const progress = deriveGithubBackupProgress(
    "RUNNING",
    [
      { name: "Dump PostgreSQL", status: "completed", conclusion: "success" },
      { name: "Upload to Google Drive", status: "in_progress", conclusion: null },
      { name: "Apply retention", status: "queued", conclusion: null },
    ],
    "2026-08-28T07:13:32Z",
  );

  assert.equal(progress.percent, 60);
  assert.equal(progress.stage, 5);
  assert.equal(progress.isIndeterminate, true);
  assert.match(progress.label, /Google Drive/);
});

test("advances to retention only after the Drive step completes", () => {
  const progress = deriveGithubBackupProgress(
    "RUNNING",
    [
      { name: "Upload to Google Drive", status: "completed", conclusion: "success" },
      { name: "Apply retention", status: "in_progress", conclusion: null },
    ],
    null,
  );

  assert.equal(progress.percent, 93);
  assert.equal(progress.stage, 6);
});

test("reports 100 percent only when the complete workflow succeeds", () => {
  const progress = deriveGithubBackupProgress("SUCCESS", [], "2026-08-28T07:13:32Z");

  assert.equal(progress.percent, 100);
  assert.equal(progress.stage, 7);
  assert.equal(progress.isIndeterminate, false);
});

test("preserves the failed stage instead of pretending the backup completed", () => {
  const progress = deriveGithubBackupProgress(
    "FAILED",
    [{ name: "Upload to Google Drive", status: "completed", conclusion: "failure" }],
    null,
  );

  assert.equal(progress.percent, 60);
  assert.equal(progress.stage, 5);
  assert.equal(progress.isIndeterminate, false);
  assert.match(progress.label, /ผิดพลาด/);
});
