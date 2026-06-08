import { NextRequest, NextResponse } from "next/server";
import { lineAdminApiErrorResponse, parseOptionalPositiveInt } from "@/lib/line-admin-api";
import { getLineConversationMessages } from "@/lib/line-admin-service";
import { requirePermission } from "@/lib/require-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePermission("line_conversations.view");

    const { id } = await params;
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
