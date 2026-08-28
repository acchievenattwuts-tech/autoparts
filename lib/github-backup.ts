import { z } from "zod";

import {
  deriveGithubBackupProgress,
  type GithubBackupProgress,
  type GithubWorkflowStep,
} from "@/lib/github-backup-progress";

/**
 * Thin client for the Weekly Backup GitHub Actions workflow
 * (.github/workflows/backup.yml).
 *
 * The backup itself cannot run on Vercel: `pg_dump` is not present in the
 * serverless runtime and a full dump would not fit inside the function time
 * limit. GitHub's runner has both, so Backup Center only *triggers* the run and
 * then reports its status back — all the heavy lifting happens on GitHub.
 */

const WORKFLOW_FILE = "backup.yml";
const GITHUB_API_ROOT = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const RECENT_RUNS_LIMIT = 5;
/** GitHub is a third-party dependency of a button click — never let it hang the request. */
const REQUEST_TIMEOUT_MS = 10_000;

export type GithubBackupRunStatus = "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED" | "CANCELLED" | "UNKNOWN";

export interface GithubBackupRun {
  id: number;
  status: GithubBackupRunStatus;
  event: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  actor: string | null;
  progress: GithubBackupProgress | null;
}

const workflowRunSchema = z.object({
  id: z.number(),
  status: z.string().nullable(),
  conclusion: z.string().nullable(),
  event: z.string(),
  html_url: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  actor: z.object({ login: z.string() }).nullish(),
});

const workflowRunsSchema = z.object({
  workflow_runs: z.array(workflowRunSchema),
});

const workflowJobsSchema = z.object({
  jobs: z.array(z.object({
    name: z.string(),
    started_at: z.string().nullable(),
    steps: z.array(z.object({
      name: z.string(),
      status: z.string().nullable(),
      conclusion: z.string().nullable(),
    })).nullish(),
  })),
});

interface GithubBackupConfig {
  token: string;
  owner: string;
  repo: string;
  ref: string;
}

const readConfig = (): GithubBackupConfig | null => {
  const token = process.env.GITHUB_BACKUP_TOKEN;
  const repository = process.env.GITHUB_BACKUP_REPO;
  if (!token || !repository) return null;

  const [owner, repo] = repository.split("/");
  if (!owner || !repo) return null;

  return { token, owner, repo, ref: process.env.GITHUB_BACKUP_REF || "main" };
};

export const isGithubBackupConfigured = (): boolean => readConfig() !== null;

const githubFetch = async (config: GithubBackupConfig, pathname: string, init?: RequestInit) => {
  const response = await fetch(`${GITHUB_API_ROOT}${pathname}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  return response;
};

/**
 * Maps a workflow run to a single status. GitHub splits this across `status`
 * (lifecycle) and `conclusion` (result, null until finished).
 */
const toRunStatus = (status: string | null, conclusion: string | null): GithubBackupRunStatus => {
  if (conclusion === "success") return "SUCCESS";
  if (conclusion === "cancelled") return "CANCELLED";
  if (conclusion) return "FAILED";
  if (status === "queued" || status === "waiting" || status === "pending" || status === "requested") return "QUEUED";
  if (status === "in_progress") return "RUNNING";
  return "UNKNOWN";
};

/** Starts a backup run. Resolves once GitHub has queued it — not when it finishes. */
export const dispatchGithubBackup = async (): Promise<void> => {
  const config = readConfig();
  if (!config) throw new Error("GITHUB_BACKUP_NOT_CONFIGURED");

  const response = await githubFetch(
    config,
    `/repos/${config.owner}/${config.repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    { method: "POST", body: JSON.stringify({ ref: config.ref }) },
  );

  // A dispatch returns 204 with no body, so there is no run id to hand back —
  // the UI discovers the new run by polling getGithubBackupRuns().
  if (response.status === 204) return;

  if (response.status === 401 || response.status === 403) throw new Error("GITHUB_BACKUP_UNAUTHORIZED");
  if (response.status === 404) throw new Error("GITHUB_BACKUP_WORKFLOW_NOT_FOUND");
  throw new Error(`GITHUB_BACKUP_DISPATCH_FAILED:${response.status}`);
};

export const getGithubBackupRuns = async (): Promise<GithubBackupRun[]> => {
  const config = readConfig();
  if (!config) return [];

  const response = await githubFetch(
    config,
    `/repos/${config.owner}/${config.repo}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=${RECENT_RUNS_LIMIT}`,
  );

  if (!response.ok) throw new Error(`GITHUB_BACKUP_RUNS_FAILED:${response.status}`);

  const parsed = workflowRunsSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("GITHUB_BACKUP_RUNS_UNEXPECTED_SHAPE");

  const runs: GithubBackupRun[] = parsed.data.workflow_runs.map((run) => ({
    id: run.id,
    status: toRunStatus(run.status, run.conclusion),
    event: run.event,
    htmlUrl: run.html_url,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    actor: run.actor?.login ?? null,
    progress: null,
  }));

  // Only the active run needs job details. Fetching jobs for all five history
  // rows on every 10-second UI poll would waste GitHub API quota.
  const activeIndex = runs.findIndex((run) => run.status === "QUEUED" || run.status === "RUNNING");
  if (activeIndex === -1) return runs;

  const activeRun = runs[activeIndex];
  let progress = deriveGithubBackupProgress(activeRun.status, [], activeRun.createdAt);

  try {
    const jobsResponse = await githubFetch(
      config,
      `/repos/${config.owner}/${config.repo}/actions/runs/${activeRun.id}/jobs?filter=latest&per_page=10`,
    );
    if (jobsResponse.ok) {
      const jobsParsed = workflowJobsSchema.safeParse(await jobsResponse.json());
      if (jobsParsed.success) {
        const backupJob = jobsParsed.data.jobs.find((job) => job.name === "backup") ?? jobsParsed.data.jobs[0];
        if (backupJob) {
          const steps: GithubWorkflowStep[] = (backupJob.steps ?? []).map((step) => ({
            name: step.name,
            status: step.status,
            conclusion: step.conclusion,
          }));
          progress = deriveGithubBackupProgress(activeRun.status, steps, backupJob.started_at ?? activeRun.createdAt);
        }
      }
    }
  } catch {
    // Run-level status remains useful if GitHub's secondary jobs endpoint is
    // temporarily unavailable. The next poll can recover richer progress.
  }

  runs[activeIndex] = { ...activeRun, progress };
  return runs;
};
