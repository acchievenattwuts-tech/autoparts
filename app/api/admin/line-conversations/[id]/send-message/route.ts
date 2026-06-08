import { NextRequest, NextResponse } from "next/server";
import { parseLineAdminImageReply, parseLineAdminReplyBody } from "@/lib/line-admin-validation";
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

    // Two transports: multipart/form-data carries an image (+ optional caption);
    // JSON carries text only (the original, unchanged path).
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const { text, image } = await parseLineAdminImageReply(formData);
      const result = await sendLineAdminMessage({
        conversationId: id,
        adminUserId: session.user.id,
        text,
        image,
      });
      return NextResponse.json(result);
    }

    const body = await request.json().catch(() => ({}));
    const { text } = parseLineAdminReplyBody(body);

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
