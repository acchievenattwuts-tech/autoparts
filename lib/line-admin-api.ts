import { NextResponse } from "next/server";

export function parseOptionalPositiveInt(value: string | null) {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function lineAdminApiErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";

  if (message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  if (message === "FORBIDDEN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  if (message === "CONVERSATION_NOT_FOUND") {
    return NextResponse.json({ error: "CONVERSATION_NOT_FOUND" }, { status: 404 });
  }

  if (message === "EMPTY_MESSAGE") {
    return NextResponse.json({ error: "EMPTY_MESSAGE" }, { status: 400 });
  }

  if (
    message === "INVALID_DECISION" ||
    message === "INVALID_REASON_PAYLOAD" ||
    message === "INVALID_REPLY_PAYLOAD" ||
    message === "MESSAGE_TOO_LONG" ||
    message === "REASON_TOO_LONG" ||
    message === "EMPTY_IMAGE" ||
    message === "IMAGE_TOO_LARGE" ||
    message === "UNSUPPORTED_IMAGE_TYPE"
  ) {
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (message === "LINE_MESSAGING_API_CHANNEL_ACCESS_TOKEN_NOT_CONFIGURED") {
    return NextResponse.json(
      { error: "LINE_MESSAGING_API_CHANNEL_ACCESS_TOKEN_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  if (
    message === "LINE_CHAT_IMAGE_STORAGE_NOT_CONFIGURED" ||
    message.startsWith("LINE_CHAT_IMAGE_UPLOAD_FAILED") ||
    message.startsWith("CREATE_BUCKET_FAILED")
  ) {
    return NextResponse.json({ error: "IMAGE_UPLOAD_FAILED" }, { status: 502 });
  }

  console.error("[line-admin-api] request failed", error);
  return NextResponse.json({ error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
}
