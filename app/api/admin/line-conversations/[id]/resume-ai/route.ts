import { NextResponse } from "next/server";
import { lineAdminApiErrorResponse } from "@/lib/line-admin-api";
import { resumeLineConversation } from "@/lib/line-admin-service";
import { requirePermission } from "@/lib/require-auth";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requirePermission("line_conversations.manage");
    const { id } = await params;
    const conversation = await resumeLineConversation({
      conversationId: id,
      adminUserId: session.user.id,
    });

    return NextResponse.json({ conversation });
  } catch (error) {
    return lineAdminApiErrorResponse(error);
  }
}
