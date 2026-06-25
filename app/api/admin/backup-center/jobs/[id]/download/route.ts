import { NextResponse } from "next/server";

import { getBackupArtifact } from "@/lib/backup-center";
import { requirePermission } from "@/lib/require-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  await requirePermission("system.backup");
  const { id } = await params;
  const artifact = await getBackupArtifact(id);

  if (!artifact) {
    return NextResponse.json({ error: "BACKUP_ARTIFACT_NOT_FOUND" }, { status: 404 });
  }

  if ("redirectUrl" in artifact && artifact.redirectUrl) {
    return NextResponse.redirect(artifact.redirectUrl);
  }

  return new Response(artifact.stream as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(artifact.size),
      "Content-Disposition": `attachment; filename="${artifact.fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
