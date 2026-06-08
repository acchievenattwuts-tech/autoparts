import { NextRequest, NextResponse } from "next/server";

import { AuditAction } from "@/lib/generated/prisma";
import { getAuditActorFromSession, getRequestContext, writeAuditLog } from "@/lib/audit-log";
import { lineAdminApiErrorResponse } from "@/lib/line-admin-api";
import { getConfiguredGeminiKeys, resetAiApiKey } from "@/lib/google-ai-keys";
import { requirePermission } from "@/lib/require-auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ keyRef: string }> },
) {
  try {
    const session = await requirePermission("line_ai_keys.manage");
    const { keyRef } = await params;

    const isKnownKey = getConfiguredGeminiKeys().some((handle) => handle.keyRef === keyRef);
    if (!isKnownKey) {
      return NextResponse.json({ error: "AI_API_KEY_NOT_FOUND" }, { status: 404 });
    }

    await resetAiApiKey(keyRef);

    const requestContext = await getRequestContext();
    await writeAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: AuditAction.UPDATE,
      entityType: "AiApiKeyState",
      entityRef: keyRef,
      meta: { operation: "RESET_AI_API_KEY", keyRef },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return lineAdminApiErrorResponse(error);
  }
}
