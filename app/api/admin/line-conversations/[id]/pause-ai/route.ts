import { NextRequest, NextResponse } from "next/server";
import { lineAdminApiErrorResponse } from "@/lib/line-admin-api";
import { pauseLineConversation } from "@/lib/line-admin-service";
import { requirePermission } from "@/lib/require-auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requirePermission("line_conversations.manage");
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = typeof body.reason === "string" ? body.reason : null;

    const conversation = await pauseLineConversation({
      conversationId: id,
      adminUserId: session.user.id,
      reason,
    });

    return NextResponse.json({ conversation });
  } catch (error) {
    return lineAdminApiErrorResponse(error);
  }
}
