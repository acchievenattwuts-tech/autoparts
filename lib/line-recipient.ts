import {
  LineRecipientStatus,
  LineRecipientType,
  LineDailySummaryTargetMode,
} from "@/lib/generated/prisma";
import { db } from "@/lib/db";

function inferRecipientType(source: {
  userId?: string | null;
  groupId?: string | null;
  roomId?: string | null;
}) {
  return [
    source.userId
      ? {
          lineId: source.userId,
          type: LineRecipientType.USER,
          sourceName: "user",
          sourceDetail: null,
        }
      : null,
    source.groupId
      ? {
          lineId: source.groupId,
          type: LineRecipientType.GROUP,
          sourceName: "group",
          sourceDetail: null,
        }
      : null,
    source.roomId
      ? {
          lineId: source.roomId,
          type: LineRecipientType.ROOM,
          sourceName: "room",
          sourceDetail: null,
        }
      : null,
  ].filter(Boolean) as Array<{
    lineId: string;
    type: LineRecipientType;
    sourceName: string;
    sourceDetail: string | null;
  }>;
}

export async function upsertLineRecipientFromWebhook(input: {
  userId?: string | null;
  groupId?: string | null;
  roomId?: string | null;
  eventType?: string | null;
  displayName?: string | null;
}) {
  const resolved = inferRecipientType(input);
  if (resolved.length === 0) {
    return [];
  }

  return Promise.all(
    resolved.map((item) =>
      db.lineRecipient.upsert({
        where: { lineId: item.lineId },
        update: {
          type: item.type,
          status: LineRecipientStatus.ACTIVE,
          displayName: item.type === LineRecipientType.USER ? input.displayName ?? undefined : undefined,
          sourceName: input.eventType ?? item.sourceName,
          lastWebhookAt: new Date(),
        },
        create: {
          lineId: item.lineId,
          type: item.type,
          status: LineRecipientStatus.ACTIVE,
          displayName: item.type === LineRecipientType.USER ? input.displayName ?? null : null,
          sourceName: input.eventType ?? item.sourceName,
          lastWebhookAt: new Date(),
        },
      })
    )
  );
}

export async function resolveLineDailySummaryRecipientIds(targetMode: LineDailySummaryTargetMode) {
  if (targetMode === LineDailySummaryTargetMode.ADMIN_USERS) {
    const adminUsers = await db.user.findMany({
      where: {
        isActive: true,
        appRole: {
          is: {
            name: "ADMIN",
          },
        },
        lineRecipientLinks: {
          some: {
            recipient: {
              type: LineRecipientType.USER,
              status: LineRecipientStatus.ACTIVE,
            },
          },
        },
      },
      select: {
        id: true,
        name: true,
        lineRecipientLinks: {
          select: {
            recipient: {
              select: {
                id: true,
                lineId: true,
                displayName: true,
                type: true,
              },
            },
          },
        },
      },
      orderBy: { name: "asc" },
    });

    const recipients = adminUsers
      .flatMap((user) =>
        user.lineRecipientLinks.map((link) => ({
          userId: user.id,
          userName: user.name,
          recipientId: link.recipient.id,
          lineId: link.recipient.lineId,
          label: link.recipient.displayName ?? user.name,
          type: link.recipient.type,
        }))
      )
      .filter((recipient) => recipient.type === LineRecipientType.USER);

    return {
      mode: targetMode,
      recipientIds: [...new Set(recipients.map((recipient) => recipient.lineId))],
      recipients,
    };
  }

  return {
    mode: targetMode,
    recipientIds: [] as string[],
    recipients: [] as Array<{
      userId: string | null;
      userName: string | null;
      recipientId: string | null;
      lineId: string;
      label: string;
      type: LineRecipientType;
    }>,
  };
}
