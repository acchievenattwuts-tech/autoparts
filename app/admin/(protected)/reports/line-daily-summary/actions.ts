"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { LineDailySummaryDispatchKind, LineDailySummaryTargetMode } from "@/lib/generated/prisma";
import { db } from "@/lib/db";
import { deliverLineDailySummary } from "@/lib/line-daily-summary-delivery";
import { syncLineDailySummaryQStashSchedule } from "@/lib/line-daily-summary-qstash";
import {
  isValidLineSummarySendTime,
  updateLineDailySummarySettings,
} from "@/lib/line-daily-summary-settings";
import { resolveBangkokDayKey } from "@/lib/line-daily-summary";
import { requireRole } from "@/lib/require-auth";

const settingsSchema = z.object({
  enabled: z.enum(["true", "false"]),
  sendTime: z.string(),
  targetMode: z.nativeEnum(LineDailySummaryTargetMode),
});

const testSendSchema = z.object({
  date: z.string().optional(),
  targetMode: z.nativeEnum(LineDailySummaryTargetMode),
});

const mappingSchema = z.object({
  userId: z.string().min(1),
  recipientId: z.string().min(1),
});

const unmapSchema = z.object({
  userId: z.string().min(1),
});

export async function saveLineDailySummarySettingsAction(formData: FormData) {
  try {
    await requireRole("ADMIN");
  } catch {
    return { error: "ไม่มีสิทธิ์แก้ไขการตั้งค่า LINE OA" };
  }

  const parsed = settingsSchema.safeParse({
    enabled: formData.get("enabled"),
    sendTime: formData.get("sendTime"),
    targetMode: formData.get("targetMode"),
  });

  if (!parsed.success) {
    return { error: "ข้อมูลการตั้งค่าไม่ถูกต้อง" };
  }

  if (!isValidLineSummarySendTime(parsed.data.sendTime)) {
    return { error: "เวลาส่งต้องอยู่ในรูปแบบ HH:mm" };
  }

  try {
    await syncLineDailySummaryQStashSchedule({
      enabled: parsed.data.enabled === "true",
      sendTime: parsed.data.sendTime,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "QSTASH_SYNC_FAILED";

    if (message.startsWith("QSTASH_CONFIG_INCOMPLETE:")) {
      const missing = message.replace("QSTASH_CONFIG_INCOMPLETE:", "").trim();
      return { error: `QStash ยังตั้งค่าไม่ครบ: ${missing}` };
    }

    if (message === "APP_BASE_URL_NOT_CONFIGURED") {
      return { error: "ยังไม่ได้ตั้งค่า APP_BASE_URL สำหรับสร้างปลายทาง QStash" };
    }

    return { error: "ไม่สามารถซิงก์ตารางเวลาส่งกับ QStash ได้" };
  }

  await updateLineDailySummarySettings({
    enabled: parsed.data.enabled === "true",
    sendTime: parsed.data.sendTime,
    targetMode: parsed.data.targetMode,
  });

  revalidatePath("/admin/reports/line-daily-summary");
  return { success: true };
}

export async function sendLineDailySummaryTestAction(formData: FormData) {
  let session;
  try {
    session = await requireRole("ADMIN");
  } catch {
    return { error: "ไม่มีสิทธิ์ส่งข้อความทดสอบ" };
  }

  const parsed = testSendSchema.safeParse({
    date: formData.get("date") || undefined,
    targetMode: formData.get("targetMode"),
  });

  if (!parsed.success) {
    return { error: "ข้อมูลทดสอบไม่ถูกต้อง" };
  }

  const reportDayKey = resolveBangkokDayKey(parsed.data.date);
  const result = await deliverLineDailySummary({
    reportDayKey,
    dispatchKind: LineDailySummaryDispatchKind.TEST,
    targetMode: parsed.data.targetMode,
    triggeredByUserId: session.user.id,
  });

  revalidatePath("/admin/reports/line-daily-summary");

  if (!result.ok) {
    return {
      error: result.reason,
      missingDeliveryEnv: result.missingDeliveryEnv ?? [],
    };
  }

  return {
    success: true,
    sentCount: result.sentCount,
  };
}

export async function linkAdminLineRecipientAction(formData: FormData) {
  try {
    await requireRole("ADMIN");
  } catch {
    return { error: "ไม่มีสิทธิ์ผูก LINE กับผู้ใช้" };
  }

  const parsed = mappingSchema.safeParse({
    userId: formData.get("userId"),
    recipientId: formData.get("recipientId"),
  });

  if (!parsed.success) {
    return { error: "ข้อมูล mapping ไม่ถูกต้อง" };
  }

  const recipient = await db.lineRecipient.findUnique({
    where: { id: parsed.data.recipientId },
    select: { id: true, type: true },
  });

  const user = await db.user.findUnique({
    where: { id: parsed.data.userId },
    select: {
      id: true,
      appRole: {
        select: {
          name: true,
        },
      },
    },
  });

  if (!recipient || recipient.type !== "USER") {
    return { error: "ผูกได้เฉพาะ LINE userId เท่านั้น" };
  }

  if (!user || user.appRole?.name !== "ADMIN") {
    return { error: "ผูก LINE ได้เฉพาะผู้ใช้ที่มีบทบาทการใช้งาน ADMIN" };
  }

  await db.userLineRecipient.deleteMany({
    where: {
      OR: [
        { userId: parsed.data.userId },
        { recipientId: parsed.data.recipientId },
      ],
    },
  });

  await db.userLineRecipient.create({
    data: {
      userId: parsed.data.userId,
      recipientId: parsed.data.recipientId,
    },
  });

  revalidatePath("/admin/reports/line-daily-summary");
  return { success: true };
}

export async function unlinkAdminLineRecipientAction(formData: FormData) {
  try {
    await requireRole("ADMIN");
  } catch {
    return { error: "ไม่มีสิทธิ์ยกเลิกการผูก LINE" };
  }

  const parsed = unmapSchema.safeParse({
    userId: formData.get("userId"),
  });

  if (!parsed.success) {
    return { error: "ข้อมูลผู้ใช้ไม่ถูกต้อง" };
  }

  await db.userLineRecipient.deleteMany({
    where: { userId: parsed.data.userId },
  });

  revalidatePath("/admin/reports/line-daily-summary");
  return { success: true };
}
