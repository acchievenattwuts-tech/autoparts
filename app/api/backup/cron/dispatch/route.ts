export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { safeWriteAuditLog } from "@/lib/audit-log";
import { reportCriticalError } from "@/lib/error-reporting";
import { AuditAction } from "@/lib/generated/prisma";
import { dispatchGithubBackup } from "@/lib/github-backup";

/**
 * Starts the scheduled backup (.github/workflows/backup.yml) at an exact time.
 *
 * The workflow used to rely on GitHub's own `schedule` trigger, which GitHub
 * started 5–8 hours late in November 2026 (a 00:00 schedule ran at 05:16–08:14
 * Bangkok time), so the backup could not be relied on to finish before the
 * shop opens at 06:00. A `workflow_dispatch` starts within seconds, so Vercel
 * Cron now dispatches the run at the time in vercel.json and the GitHub runner
 * still does the actual work (pg_dump is not available on Vercel).
 *
 * Vercel Cron triggers this with a GET and attaches
 * `Authorization: Bearer ${CRON_SECRET}`.
 *
 * A failed dispatch means no backup that night, and the workflow's own Telegram
 * message never fires because the run never starts — so the failure is sent to
 * Telegram from here instead.
 */

const DISPATCH_RETRY_DELAY_MS = 5_000;
/** Retrying these cannot help: the token, repository or workflow is wrong. */
const PERMANENT_DISPATCH_ERRORS = new Set([
  "GITHUB_BACKUP_NOT_CONFIGURED",
  "GITHUB_BACKUP_UNAUTHORIZED",
  "GITHUB_BACKUP_WORKFLOW_NOT_FOUND",
]);

const isAuthorized = (authHeader: string | null): boolean => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const provided = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!provided) return false;

  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(secret);
  if (providedBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(providedBuffer, expectedBuffer);
};

const isPermanentError = (error: unknown): boolean =>
  error instanceof Error && PERMANENT_DISPATCH_ERRORS.has(error.message);

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** One retry covers a GitHub blip or a timed-out request. Returns the attempts used. */
const dispatchWithRetry = async (): Promise<number> => {
  try {
    await dispatchGithubBackup("scheduled");
    return 1;
  } catch (error) {
    if (isPermanentError(error)) throw error;
    console.error("[backup-cron] dispatch failed, retrying once", error);
  }

  await wait(DISPATCH_RETRY_DELAY_MS);
  await dispatchGithubBackup("scheduled");
  return 2;
};

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  let attempts: number;
  try {
    attempts = await dispatchWithRetry();
  } catch (error) {
    console.error("[backup-cron] failed to dispatch scheduled backup", error);
    await reportCriticalError(error, { scope: "cron.backup_dispatch" });
    return NextResponse.json({ ok: false, error: "BACKUP_DISPATCH_FAILED" }, { status: 500 });
  }

  await safeWriteAuditLog({
    userName: "Vercel Cron",
    action: AuditAction.EXPORT,
    entityType: "BackupWorkflow",
    entityRef: "weekly-backup",
    after: { trigger: "scheduled", workflow: "backup.yml" },
    meta: { attempts },
  });

  return NextResponse.json({ ok: true, attempts });
}
