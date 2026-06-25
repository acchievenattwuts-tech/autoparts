import { NextResponse } from "next/server";

import { createBlobManifestDownload } from "@/lib/backup-center";
import { requirePermission } from "@/lib/require-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(): Promise<Response> {
  try {
    await requirePermission("system.backup");
    const artifact = await createBlobManifestDownload();
    return new Response(artifact.stream as unknown as BodyInit, {
      headers: {
        "Content-Type": artifact.contentType,
        "Content-Length": String(artifact.size ?? 0),
        "Content-Disposition": `attachment; filename="${artifact.fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "BLOB_MANIFEST_DOWNLOAD_FAILED";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
