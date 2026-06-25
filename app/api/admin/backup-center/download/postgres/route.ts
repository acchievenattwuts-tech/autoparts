import { NextResponse } from "next/server";

import { createPostgresBackupDownload, type DownloadArtifact } from "@/lib/backup-center";
import { requirePermission } from "@/lib/require-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function downloadResponse(artifact: DownloadArtifact): Response {
  if (artifact.cleanup) {
    artifact.stream.on("close", () => {
      void artifact.cleanup?.();
    });
    artifact.stream.on("error", () => {
      void artifact.cleanup?.();
    });
  }

  const headers = new Headers({
    "Content-Type": artifact.contentType,
    "Content-Disposition": `attachment; filename="${artifact.fileName}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (artifact.size !== undefined) {
    headers.set("Content-Length", String(artifact.size));
  }

  return new Response(artifact.stream as unknown as BodyInit, { headers });
}

export async function GET(): Promise<Response> {
  try {
    await requirePermission("system.backup");
    return downloadResponse(await createPostgresBackupDownload());
  } catch (error) {
    const message = error instanceof Error ? error.message : "POSTGRES_BACKUP_DOWNLOAD_FAILED";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
