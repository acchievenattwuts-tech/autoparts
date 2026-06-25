import { NextResponse } from "next/server";

import { createBlobArchiveDownload } from "@/lib/backup-center";
import { requirePermission } from "@/lib/require-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(): Promise<Response> {
  try {
    await requirePermission("system.backup");
    const artifact = await createBlobArchiveDownload();
    return new Response(artifact.stream as unknown as BodyInit, {
      headers: {
        "Content-Type": artifact.contentType,
        "Content-Disposition": `attachment; filename="${artifact.fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "BLOB_ARCHIVE_DOWNLOAD_FAILED";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
