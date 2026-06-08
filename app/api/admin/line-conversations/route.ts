import { NextRequest, NextResponse } from "next/server";
import { LineConversationAiStatus } from "@/lib/generated/prisma";
import { lineAdminApiErrorResponse, parseOptionalPositiveInt } from "@/lib/line-admin-api";
import { listLineConversations } from "@/lib/line-admin-service";
import { requirePermission } from "@/lib/require-auth";

const ALLOWED_STATUSES = new Set<string>(Object.values(LineConversationAiStatus));

export async function GET(request: NextRequest) {
  try {
    await requirePermission("line_conversations.view");

    const statusParam = request.nextUrl.searchParams.get("status");
    const status = statusParam && ALLOWED_STATUSES.has(statusParam)
      ? (statusParam as LineConversationAiStatus)
      : null;
    const take = parseOptionalPositiveInt(request.nextUrl.searchParams.get("take"));

    const conversations = await listLineConversations({ status, take });
    return NextResponse.json({ conversations });
  } catch (error) {
    return lineAdminApiErrorResponse(error);
  }
}
