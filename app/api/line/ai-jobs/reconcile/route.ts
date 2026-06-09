export const dynamic = "force-dynamic";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { LineDeliveryStatus, LineMessageDirection } from "@/lib/generated/prisma";

const STALE_OUTBOUND_AGE_MS = 5 * 60 * 1000;
const RECONCILE_BATCH_LIMIT = 200;

const isAuthorized = (authHeader: string | null): boolean => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!provided) return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(secret);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
};

/**
 * Sweeps outbound LINE messages stuck in PENDING for more than 5 minutes —
 * caused by a `replyLineMessage`/`pushLineMessages` succeeding but the
 * follow-up `markOutboundLineMessageSent` write losing its DB round-trip.
 * We can't tell after the fact whether the send actually succeeded, so we
 * mark the row FAILED to clear the queue and surface the count for ops.
 */
export async function GET(request: Request): Promise<Response> {
  if (!isAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  try {
    const cutoff = new Date(Date.now() - STALE_OUTBOUND_AGE_MS);
    const stale = await db.lineMessage.findMany({
      where: {
        direction: { in: [LineMessageDirection.OUTBOUND_AI, LineMessageDirection.OUTBOUND_ADMIN] },
        deliveryStatus: LineDeliveryStatus.PENDING,
        createdAt: { lt: cutoff },
      },
      orderBy: { createdAt: "asc" },
      take: RECONCILE_BATCH_LIMIT,
      select: { id: true },
    });

    if (stale.length === 0) {
      return NextResponse.json({ ok: true, reconciled: 0 });
    }

    const ids = stale.map((row) => row.id);
    const updated = await db.lineMessage.updateMany({
      where: { id: { in: ids }, deliveryStatus: LineDeliveryStatus.PENDING },
      data: { deliveryStatus: LineDeliveryStatus.FAILED },
    });

    console.warn(
      `[line-ai-reconcile] marked ${updated.count} stale OUTBOUND messages as FAILED`,
    );
    return NextResponse.json({ ok: true, reconciled: updated.count });
  } catch (error) {
    console.error(
      "[line-ai-reconcile] failed",
      error instanceof Error ? error.message : "unknown",
    );
    return NextResponse.json({ ok: false, error: "RECONCILE_FAILED" }, { status: 500 });
  }
}
