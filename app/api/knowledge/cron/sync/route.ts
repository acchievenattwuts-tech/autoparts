export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { reportCriticalError } from "@/lib/error-reporting";
import { syncKnowledgeRag } from "@/lib/knowledge-sync";
import { processPendingKnowledgePublishJobs } from "@/lib/knowledge-cms-publish";
import { db } from "@/lib/db";

function isAuthorized(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!provided) return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(secret);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const cmsSources = await db.knowledgeSource.count();
    if (cmsSources > 0) {
      const result = await processPendingKnowledgePublishJobs(2);
      return NextResponse.json({ ok: true, mode: "cms", sources: cmsSources, ...result });
    }
    const result = await syncKnowledgeRag({ maxDocuments: 8 });
    return NextResponse.json({ ok: true, mode: "legacy", ...result });
  } catch (error) {
    await reportCriticalError(error, { scope: "cron.knowledge_sync" });
    return NextResponse.json({ ok: false, error: "SYNC_FAILED" }, { status: 500 });
  }
}
