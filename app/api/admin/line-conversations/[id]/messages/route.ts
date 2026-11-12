import { NextRequest, NextResponse } from "next/server";
import { lineAdminApiErrorResponse, parseOptionalPositiveInt } from "@/lib/line-admin-api";
import { getLineConversationLatestMessageId, getLineConversationMessages } from "@/lib/line-admin-service";
import { requirePermission } from "@/lib/require-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requirePermission("line_conversations.view");

    const { id } = await params;
    // Poll mode for LineConversationMessagePoller: only the newest message id,
    // one query, same permission check as the full read below.
    if (request.nextUrl.searchParams.get("latestOnly") === "1") {
      const latestMessageId = await getLineConversationLatestMessageId(id);
      return NextResponse.json({ latestMessageId }, { headers: { "Cache-Control": "private, no-store" } });
    }

    const take = parseOptionalPositiveInt(request.nextUrl.searchParams.get("take"));
    const result = await getLineConversationMessages({ conversationId: id, take });

    if (!result) {
      return NextResponse.json({ error: "CONVERSATION_NOT_FOUND" }, { status: 404 });
    }

    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return lineAdminApiErrorResponse(error);
  }
}
