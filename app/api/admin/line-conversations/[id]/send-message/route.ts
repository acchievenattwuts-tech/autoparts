import { NextRequest, NextResponse } from "next/server";
import { lineAdminApiErrorResponse } from "@/lib/line-admin-api";
import { sendLineAdminMessage } from "@/lib/line-admin-service";
import { requirePermission } from "@/lib/require-auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requirePermission("line_conversations.reply");
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const text = typeof body.text === "string" ? body.text : "";

    const result = await sendLineAdminMessage({
      conversationId: id,
      adminUserId: session.user.id,
      text,
    });

    return NextResponse.json(result);
  } catch (error) {
    return lineAdminApiErrorResponse(error);
  }
}
