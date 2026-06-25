import { NextResponse } from "next/server";

import { createBackupJob, getBackupCenterJobs } from "@/lib/backup-center";
import { BackupJobKind } from "@/lib/generated/prisma";
import { requirePermission } from "@/lib/require-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function serializeJob(job: Awaited<ReturnType<typeof getBackupCenterJobs>>[number]) {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    phase: job.phase,
    message: job.message,
    processedItems: job.processedItems,
    totalItems: job.totalItems,
    processedBytes: job.processedBytes.toString(),
    totalBytes: job.totalBytes.toString(),
    percent: job.percent,
    artifactKind: job.artifactKind,
    artifactPath: job.artifactPath,
    artifactUrl: job.artifactUrl,
    errorMessage: job.errorMessage,
    metadata: job.metadata,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    createdBy: job.createdBy,
  };
}

export async function GET(): Promise<NextResponse> {
  await requirePermission("system.backup");
  const jobs = await getBackupCenterJobs();
  return NextResponse.json(
    { jobs: jobs.map(serializeJob) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const session = await requirePermission("system.backup");
  const payload = (await request.json().catch(() => null)) as { kind?: string } | null;
  const kind = payload?.kind;

  if (kind !== BackupJobKind.BLOB && kind !== BackupJobKind.POSTGRES) {
    return NextResponse.json({ error: "INVALID_BACKUP_KIND" }, { status: 400 });
  }

  const job = await createBackupJob(kind, session);
  return NextResponse.json({ jobId: job.id }, { status: 201 });
}
