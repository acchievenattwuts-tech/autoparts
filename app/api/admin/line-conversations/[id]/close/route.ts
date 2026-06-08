import { NextResponse } from "next/server";
import { closeLineConversation } from "@/lib/line-admin-service";
import { lineAdminApiErrorResponse } from "@/lib/line-admin-api";
import { requirePermission } from "@/lib/require-auth";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requirePermission("line_conversations.manage");
    const { id } = await params;
    const conversation = await closeLineConversation({
      conversationId: id,
      adminUserId: session.user.id,
    });

    return NextResponse.json({ conversation });
  } catch (error) {
    return lineAdminApiErrorResponse(error);
  }
}
