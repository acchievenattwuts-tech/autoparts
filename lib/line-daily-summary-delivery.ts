import { Prisma, LineDailySummaryDispatchKind, LineDailySummaryDispatchStatus, LineDailySummaryTargetMode } from "@/lib/generated/prisma";
import { db } from "@/lib/db";
import { buildLineDailySummary } from "@/lib/line-daily-summary";
import { markLineDailySummarySent } from "@/lib/line-daily-summary-settings";
import { getLineDailySummaryConfig, pushLineMessages, resolveConfiguredLineRecipients } from "@/lib/line-messaging";

type DeliverParams = {
  reportDayKey: string;
  dispatchKind: LineDailySummaryDispatchKind;
  targetMode: LineDailySummaryTargetMode;
  triggeredByUserId?: string | null;
};

type LogDispatchAttemptParams = {
  reportDayKey: string;
  dispatchKind: LineDailySummaryDispatchKind;
  status: LineDailySummaryDispatchStatus;
  targetMode: LineDailySummaryTargetMode;
  recipientIds?: string[];
  sentCount?: number;
  errorMessage?: string | null;
  triggeredByUserId?: string | null;
  sentAt?: Date | null;
};

export type DeliverLineDailySummaryResult =
  | {
      ok: true;
      status: "SENT";
      reportDayKey: string;
      targetMode: LineDailySummaryTargetMode;
      sentCount: number;
      recipientIds: string[];
      message: string;
    }
  | {
      ok: false;
      status: "SKIPPED" | "FAILED";
      reportDayKey: string;
      targetMode: LineDailySummaryTargetMode;
      reason: string;
      missingDeliveryEnv?: string[];
      recipientIds?: string[];
      message?: string;
    };

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export async function logLineDailySummaryDispatchAttempt(
  params: LogDispatchAttemptParams
) {
  const {
    reportDayKey,
    dispatchKind,
    status,
    targetMode,
    recipientIds = [],
    sentCount = 0,
    errorMessage,
    triggeredByUserId,
    sentAt,
  } = params;

  await db.lineDailySummaryDispatch.create({
    data: {
      reportDayKey,
      dispatchKind,
      status,
      targetMode,
      recipientCount: recipientIds.length,
      sentCount,
      recipientSnapshot: recipientIds.length > 0 ? recipientIds.join(",") : null,
      errorMessage: errorMessage?.slice(0, 1000) ?? null,
      triggeredByUserId: triggeredByUserId ?? null,
      sentAt: sentAt ?? null,
    },
  });
}

export async function deliverLineDailySummary(
  params: DeliverParams
): Promise<DeliverLineDailySummaryResult> {
  const { reportDayKey, dispatchKind, targetMode, triggeredByUserId } = params;
  const summary = await buildLineDailySummary(reportDayKey);
  const config = getLineDailySummaryConfig();
  const resolvedRecipients = await resolveConfiguredLineRecipients(targetMode);
  const missingDeliveryEnv = [...config.missingDeliveryEnv, ...resolvedRecipients.missingDeliveryEnv];
  const recipientIds = resolvedRecipients.recipientIds;

  if (!config.channelAccessToken || missingDeliveryEnv.length > 0 || recipientIds.length === 0) {
    await logLineDailySummaryDispatchAttempt({
      reportDayKey,
      dispatchKind,
      status: LineDailySummaryDispatchStatus.FAILED,
      targetMode,
      recipientIds,
      errorMessage: `CONFIG_INCOMPLETE:${[...new Set(missingDeliveryEnv)].join(",")}`,
      triggeredByUserId,
    });

    return {
      ok: false,
      status: "FAILED",
      reportDayKey,
      targetMode,
      reason: "LINE delivery config is incomplete",
      missingDeliveryEnv: [...new Set(missingDeliveryEnv)],
      recipientIds,
      message: summary.message,
    };
  }

  const dispatchKey =
    dispatchKind === LineDailySummaryDispatchKind.SCHEDULED
      ? `scheduled:${reportDayKey}`
      : null;

  let dispatchId: string | null = null;

  if (dispatchKey) {
    try {
      const dispatch = await db.lineDailySummaryDispatch.create({
        data: {
          dispatchKey,
          reportDayKey,
          dispatchKind,
          status: LineDailySummaryDispatchStatus.PROCESSING,
          targetMode,
          recipientCount: recipientIds.length,
          recipientSnapshot: recipientIds.join(","),
          triggeredByUserId: triggeredByUserId ?? null,
        },
      });
      dispatchId = dispatch.id;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        await logLineDailySummaryDispatchAttempt({
          reportDayKey,
          dispatchKind,
          status: LineDailySummaryDispatchStatus.SKIPPED,
          targetMode,
          recipientIds,
          errorMessage: "ALREADY_DISPATCHED",
          triggeredByUserId,
        });

        return {
          ok: false,
          status: "SKIPPED",
          reportDayKey,
          targetMode,
          reason: "ALREADY_DISPATCHED",
          recipientIds,
          message: summary.message,
        };
      }

      throw error;
    }
  } else {
    const dispatch = await db.lineDailySummaryDispatch.create({
      data: {
        reportDayKey,
        dispatchKind,
        status: LineDailySummaryDispatchStatus.PROCESSING,
        targetMode,
        recipientCount: recipientIds.length,
        recipientSnapshot: recipientIds.join(","),
        triggeredByUserId: triggeredByUserId ?? null,
      },
    });
    dispatchId = dispatch.id;
  }

  try {
    const result = await pushLineMessages({
      channelAccessToken: config.channelAccessToken,
      recipientIds,
      messages: summary.messages,
    });

    const sentAt = new Date();

    await db.lineDailySummaryDispatch.update({
      where: { id: dispatchId },
      data: {
        status: LineDailySummaryDispatchStatus.SENT,
        sentCount: result.sentCount,
        sentAt,
      },
    });

    if (dispatchKind === LineDailySummaryDispatchKind.SCHEDULED) {
      await markLineDailySummarySent(reportDayKey, sentAt);
    }

    return {
      ok: true,
      status: "SENT",
      reportDayKey,
      targetMode,
      sentCount: result.sentCount,
      recipientIds: result.recipientIds,
      message: summary.message,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown LINE send error";

    await db.lineDailySummaryDispatch.update({
      where: { id: dispatchId },
      data: {
        status: LineDailySummaryDispatchStatus.FAILED,
        errorMessage: message.slice(0, 1000),
      },
    });

    return {
      ok: false,
      status: "FAILED",
      reportDayKey,
      targetMode,
      reason: message,
      recipientIds,
      message: summary.message,
    };
  }
}
