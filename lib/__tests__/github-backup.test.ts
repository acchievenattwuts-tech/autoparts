import test from "node:test";
import assert from "node:assert/strict";

import { dispatchGithubBackup, getGithubBackupRuns, SCHEDULED_RUN_TITLE } from "@/lib/github-backup";

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

test("loads job steps only for the active workflow run and returns derived progress", async (t) => {
  const previousToken = process.env.GITHUB_BACKUP_TOKEN;
  const previousRepo = process.env.GITHUB_BACKUP_REPO;
  process.env.GITHUB_BACKUP_TOKEN = "test-token";
  process.env.GITHUB_BACKUP_REPO = "owner/repo";
  t.after(() => {
    if (previousToken === undefined) delete process.env.GITHUB_BACKUP_TOKEN;
    else process.env.GITHUB_BACKUP_TOKEN = previousToken;
    if (previousRepo === undefined) delete process.env.GITHUB_BACKUP_REPO;
    else process.env.GITHUB_BACKUP_REPO = previousRepo;
  });

  const requestedUrls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.includes("/runs/123/jobs")) {
      return jsonResponse({
        jobs: [{
          name: "backup",
          started_at: "2026-08-28T07:13:32Z",
          steps: [{ name: "Upload to Google Drive", status: "in_progress", conclusion: null }],
        }],
      });
    }
    return jsonResponse({
      workflow_runs: [{
        id: 123,
        status: "in_progress",
        conclusion: null,
        event: "workflow_dispatch",
        html_url: "https://github.com/owner/repo/actions/runs/123",
        created_at: "2026-08-28T07:13:27Z",
        updated_at: "2026-08-28T07:13:32Z",
        actor: { login: "owner" },
      }],
    });
  });

  const runs = await getGithubBackupRuns();

  assert.equal(requestedUrls.length, 2);
  assert.match(requestedUrls[1], /\/runs\/123\/jobs/);
  assert.equal(runs[0]?.progress?.percent, 60);
  assert.equal(runs[0]?.progress?.stage, 5);
});

test("keeps run-level status when the secondary jobs endpoint is unavailable", async (t) => {
  const previousToken = process.env.GITHUB_BACKUP_TOKEN;
  const previousRepo = process.env.GITHUB_BACKUP_REPO;
  process.env.GITHUB_BACKUP_TOKEN = "test-token";
  process.env.GITHUB_BACKUP_REPO = "owner/repo";
  t.after(() => {
    if (previousToken === undefined) delete process.env.GITHUB_BACKUP_TOKEN;
    else process.env.GITHUB_BACKUP_TOKEN = previousToken;
    if (previousRepo === undefined) delete process.env.GITHUB_BACKUP_REPO;
    else process.env.GITHUB_BACKUP_REPO = previousRepo;
  });

  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/runs/456/jobs")) return jsonResponse({ message: "temporary" }, 503);
    return jsonResponse({
      workflow_runs: [{
        id: 456,
        status: "in_progress",
        conclusion: null,
        event: "schedule",
        html_url: "https://github.com/owner/repo/actions/runs/456",
        created_at: "2026-08-28T07:13:27Z",
        updated_at: "2026-08-28T07:13:32Z",
        actor: null,
      }],
    });
  });

  const runs = await getGithubBackupRuns();

  assert.equal(runs[0]?.status, "RUNNING");
  assert.equal(runs[0]?.progress?.percent, 5);
  assert.match(runs[0]?.progress?.label ?? "", /เริ่มงาน/);
});

const withBackupEnv = (t: test.TestContext): void => {
  const previousToken = process.env.GITHUB_BACKUP_TOKEN;
  const previousRepo = process.env.GITHUB_BACKUP_REPO;
  process.env.GITHUB_BACKUP_TOKEN = "test-token";
  process.env.GITHUB_BACKUP_REPO = "owner/repo";
  t.after(() => {
    if (previousToken === undefined) delete process.env.GITHUB_BACKUP_TOKEN;
    else process.env.GITHUB_BACKUP_TOKEN = previousToken;
    if (previousRepo === undefined) delete process.env.GITHUB_BACKUP_REPO;
    else process.env.GITHUB_BACKUP_REPO = previousRepo;
  });
};

test("dispatch passes the trigger as a workflow input, defaulting to manual", async (t) => {
  withBackupEnv(t);
  const bodies: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (_input: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(null, { status: 204 });
  });

  await dispatchGithubBackup();
  await dispatchGithubBackup("scheduled");

  assert.deepEqual(bodies, [
    { ref: "main", inputs: { trigger: "manual" } },
    { ref: "main", inputs: { trigger: "scheduled" } },
  ]);
});

test("a run counts as scheduled when GitHub scheduled it or the cron's run-name marks it", async (t) => {
  withBackupEnv(t);
  const run = (id: number, event: string, displayTitle: string | null) => ({
    id,
    status: "completed",
    conclusion: "success",
    event,
    display_title: displayTitle,
    html_url: `https://github.com/owner/repo/actions/runs/${id}`,
    created_at: "2026-11-27T17:00:05Z",
    updated_at: "2026-11-27T17:10:05Z",
    actor: { login: "owner" },
  });
  t.mock.method(globalThis, "fetch", async () => jsonResponse({
    workflow_runs: [
      run(1, "workflow_dispatch", SCHEDULED_RUN_TITLE),
      run(2, "workflow_dispatch", "Weekly Backup"),
      run(3, "schedule", "Weekly Backup"),
      run(4, "workflow_dispatch", null),
    ],
  }));

  const runs = await getGithubBackupRuns();

  assert.deepEqual(runs.map((r) => r.trigger), ["scheduled", "manual", "scheduled", "manual"]);
});
