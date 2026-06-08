import { NextRequest, NextResponse } from "next/server";

import { AuditAction } from "@/lib/generated/prisma";
import { getAuditActorFromSession, getRequestContext, writeAuditLog } from "@/lib/audit-log";
import { db } from "@/lib/db";
import { lineAdminApiErrorResponse } from "@/lib/line-admin-api";
import { storeLineAiAudit } from "@/lib/line-conversation-repository";
import { setLineConversationCustomer } from "@/lib/line-conversation-repository";
import { requirePermission } from "@/lib/require-auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requirePermission("line_conversations.manage");
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const customerId = typeof body.customerId === "string" && body.customerId.trim()
      ? body.customerId.trim()
      : null;

    const conversation = await db.lineConversation.findUnique({
      where: { id },
      select: { id: true, customerId: true },
    });
    if (!conversation) {
      return NextResponse.json({ error: "CONVERSATION_NOT_FOUND" }, { status: 404 });
    }

    // When linking, verify the customer exists and is active.
    if (customerId) {
      const customer = await db.customer.findFirst({
        where: { id: customerId, isActive: true },
        select: { id: true },
      });
      if (!customer) {
        return NextResponse.json({ error: "CUSTOMER_NOT_FOUND" }, { status: 404 });
      }
    }

    await setLineConversationCustomer({ conversationId: id, customerId });

    const requestContext = await getRequestContext();
    await writeAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: AuditAction.UPDATE,
      entityType: "LineConversation",
      entityId: id,
      before: { customerId: conversation.customerId },
      after: { customerId },
      meta: { operation: customerId ? "LINK_CUSTOMER" : "UNLINK_CUSTOMER" },
    });

    await storeLineAiAudit({
      conversationId: id,
      action: customerId ? "ADMIN_LINK_CUSTOMER" : "ADMIN_UNLINK_CUSTOMER",
      payload: { adminUserId: session.user.id, customerId },
    });

    return NextResponse.json({ ok: true, customerId });
  } catch (error) {
    return lineAdminApiErrorResponse(error);
  }
}
