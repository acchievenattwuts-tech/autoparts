import { NextResponse } from "next/server";

import { runBackupJob } from "@/lib/backup-center";
import { requirePermission } from "@/lib/require-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requirePermission("system.backup");
    const { id } = await params;
    await runBackupJob(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "BACKUP_JOB_FAILED";
    const status = message === "BACKUP_JOB_NOT_FOUND" ? 404 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
