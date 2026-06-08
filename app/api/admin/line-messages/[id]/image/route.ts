import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { LineMessageType } from "@/lib/generated/prisma";
import { fetchLineMessageContent, getLineDailySummaryConfig } from "@/lib/line-messaging";
import { requirePermission } from "@/lib/require-auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    await requirePermission("line_conversations.view");

    const { id } = await context.params;
    const message = await db.lineMessage.findUnique({
      where: { id },
      select: {
        lineMessageId: true,
        messageType: true,
      },
    });

    if (!message || message.messageType !== LineMessageType.IMAGE || !message.lineMessageId) {
      return new NextResponse("Image not found", { status: 404 });
    }

    const config = getLineDailySummaryConfig();
    if (!config.channelAccessToken) {
      return NextResponse.json({ error: "LINE_CHANNEL_ACCESS_TOKEN_NOT_CONFIGURED" }, { status: 503 });
    }

    const content = await fetchLineMessageContent({
      channelAccessToken: config.channelAccessToken,
      messageId: message.lineMessageId,
    });

    if (!content?.mimeType.startsWith("image/")) {
      return new NextResponse("Image expired or unavailable", { status: 404 });
    }

    return new NextResponse(Buffer.from(content.dataBase64, "base64"), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": content.mimeType,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (message === "FORBIDDEN") {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    console.error("[line-message-image] failed", error);
    return NextResponse.json({ error: "IMAGE_FETCH_FAILED" }, { status: 502 });
  }
}
