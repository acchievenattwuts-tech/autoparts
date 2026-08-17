import { NextResponse } from "next/server";

import { getAuditActorFromSession, safeWriteAuditLog } from "@/lib/audit-log";
import { AuditAction } from "@/lib/generated/prisma";
import { dispatchGithubBackup, getGithubBackupRuns } from "@/lib/github-backup";
import { requirePermission } from "@/lib/require-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Error codes the client is allowed to see. Anything else becomes a generic failure. */
const CLIENT_SAFE_ERRORS = new Set([
  "GITHUB_BACKUP_NOT_CONFIGURED",
  "GITHUB_BACKUP_UNAUTHORIZED",
  "GITHUB_BACKUP_WORKFLOW_NOT_FOUND",
]);

const toClientError = (error: unknown, fallback: string): string => {
  const message = error instanceof Error ? error.message : fallback;
  return CLIENT_SAFE_ERRORS.has(message) ? message : fallback;
};

export async function GET(): Promise<NextResponse> {
  try {
    await requirePermission("system.backup");
    const runs = await getGithubBackupRuns();
    return NextResponse.json({ ok: true, runs });
  } catch (error) {
    console.error("[backup-center] failed to load GitHub backup runs", error);
    return NextResponse.json(
      { ok: false, error: toClientError(error, "GITHUB_BACKUP_RUNS_FAILED") },
      { status: 500 },
    );
  }
}

export async function POST(): Promise<NextResponse> {
  try {
    const session = await requirePermission("system.backup");
    await dispatchGithubBackup();

    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      action: AuditAction.EXPORT,
      entityType: "BackupWorkflow",
      entityRef: "weekly-backup",
      after: { trigger: "manual", workflow: "backup.yml" },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[backup-center] failed to dispatch GitHub backup", error);
    return NextResponse.json(
      { ok: false, error: toClientError(error, "GITHUB_BACKUP_DISPATCH_FAILED") },
      { status: 500 },
    );
  }
}
