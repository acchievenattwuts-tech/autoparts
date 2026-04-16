import type { ContentPost, User } from "@/lib/generated/prisma";
import { LineRecipientStatus, LineRecipientType } from "@/lib/generated/prisma";
import { db } from "@/lib/db";
import type { LinePushMessage } from "@/lib/line-daily-summary";
import { getLineDailySummaryConfig, pushLineMessages } from "@/lib/line-messaging";
import { formatThaiDateTime, truncateText } from "@/lib/content-utils";

type NotifyParams = {
  post: Pick<ContentPost, "id" | "title" | "caption" | "scheduledAt" | "status">;
  recipientUserIds: string[];
  heading: string;
  detail: string;
  appBaseUrl: string;
};

async function resolveActiveUserLineRecipientIds(userIds: string[]) {
  if (userIds.length === 0) return [];

  const links = await db.userLineRecipient.findMany({
    where: {
      userId: { in: userIds },
      recipient: {
        status: LineRecipientStatus.ACTIVE,
        type: LineRecipientType.USER,
      },
    },
    select: {
      userId: true,
      recipient: {
        select: {
          lineId: true,
        },
      },
    },
  });

  return [...new Set(links.map((link) => link.recipient.lineId))];
}

function buildApprovalMessage(params: NotifyParams): LinePushMessage[] {
  const url = `${params.appBaseUrl}/admin/content/${params.post.id}`;
  const scheduledAt = params.post.scheduledAt
    ? `เวลาที่ตั้งไว้: ${formatThaiDateTime(params.post.scheduledAt)}`
    : "ยังไม่ได้ตั้งเวลาโพสต์";
  const preview = truncateText(params.post.caption.replace(/\s+/g, " ").trim(), 220);

  return [
    {
      type: "text",
      text: [
        params.heading,
        params.post.title ? `หัวข้อ: ${params.post.title}` : null,
        params.detail,
        scheduledAt,
        `พรีวิว: ${preview}`,
        `เปิดตรวจและอนุมัติ: ${url}`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
}

export async function sendContentWorkflowNotification(params: NotifyParams) {
  const config = getLineDailySummaryConfig();
  if (!config.channelAccessToken) {
    throw new Error("LINE_CHANNEL_ACCESS_TOKEN_NOT_CONFIGURED");
  }

  const recipientIds = await resolveActiveUserLineRecipientIds(params.recipientUserIds);
  if (recipientIds.length === 0) {
    throw new Error("LINE_RECIPIENTS_NOT_FOUND");
  }

  return pushLineMessages({
    channelAccessToken: config.channelAccessToken,
    recipientIds,
    messages: buildApprovalMessage(params),
  });
}

export async function getContentApproverUsers(): Promise<
  Array<Pick<User, "id" | "name" | "email" | "role"> & { lineRecipientId: string; lineId: string }>
> {
  const users = await db.user.findMany({
    where: {
      isActive: true,
      OR: [{ role: "ADMIN" }, { appRole: { is: { name: "ADMIN" } } }],
      lineRecipientLinks: {
        some: {
          recipient: {
            status: LineRecipientStatus.ACTIVE,
            type: LineRecipientType.USER,
          },
        },
      },
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      lineRecipientLinks: {
        where: {
          recipient: {
            status: LineRecipientStatus.ACTIVE,
            type: LineRecipientType.USER,
          },
        },
        select: {
          recipientId: true,
          recipient: {
            select: {
              lineId: true,
            },
          },
        },
        take: 1,
      },
    },
    orderBy: { name: "asc" },
  });

  return users
    .map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      lineRecipientId: user.lineRecipientLinks[0]?.recipientId ?? "",
      lineId: user.lineRecipientLinks[0]?.recipient.lineId ?? "",
    }))
    .filter((user) => user.lineRecipientId && user.lineId);
}
