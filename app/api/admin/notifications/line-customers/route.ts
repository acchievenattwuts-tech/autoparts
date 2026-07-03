import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { AuditAction } from "@/lib/generated/prisma";
import { isLineCustomerProfileIncomplete } from "@/lib/line-customer-profile";
import { checkRateLimit } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/require-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SUMMARY_RATE_LIMIT_WINDOW_MS = 60_000;
const SUMMARY_RATE_LIMIT_MAX_REQUESTS = 20;
const LIST_RATE_LIMIT_WINDOW_MS = 60_000;
const LIST_RATE_LIMIT_MAX_REQUESTS = 20;
const DEFAULT_LIST_TAKE = 5;
const MAX_LIST_TAKE = 10;

const LINE_NEW_CUSTOMER_KIND = "LINE_NEW_CUSTOMER";
const OLD_CUSTOMER_LINKED_KIND = "OLD_CUSTOMER_LINKED";
const OLD_CUSTOMER_RELINKED_KIND = "OLD_CUSTOMER_RELINKED";

const timestampSchema = z.string().trim().refine((value) => {
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
});

const querySchema = z.object({
  mode: z.enum(["summary", "list"]).default("summary"),
  since: timestampSchema.optional(),
  take: z.coerce.number().int().min(1).max(MAX_LIST_TAKE).default(DEFAULT_LIST_TAKE),
});

const safeError = (message: string, status = 500) =>
  NextResponse.json({ error: message }, { status });

const hasAdminLineUnlinkMeta = (meta: unknown): boolean =>
  typeof meta === "object" &&
  meta !== null &&
  !Array.isArray(meta) &&
  "lineUnlinkedByAdmin" in meta &&
  meta.lineUnlinkedByAdmin === true;

export const GET = async (request: Request): Promise<NextResponse> => {
  try {
    const session = await requirePermission("customers.view");
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      mode: url.searchParams.get("mode") ?? undefined,
      since: url.searchParams.get("since") ?? undefined,
      take: url.searchParams.get("take") ?? undefined,
    });

    if (!parsed.success) {
      return safeError("BAD_REQUEST", 400);
    }

    const { mode, take } = parsed.data;
    const rate = await checkRateLimit({
      key: `line-customer-notifications:${mode}:${session.user.id}`,
      limit: mode === "summary" ? SUMMARY_RATE_LIMIT_MAX_REQUESTS : LIST_RATE_LIMIT_MAX_REQUESTS,
      windowMs: mode === "summary" ? SUMMARY_RATE_LIMIT_WINDOW_MS : LIST_RATE_LIMIT_WINDOW_MS,
    });

    if (!rate.ok) {
      return NextResponse.json(
        { error: "RATE_LIMITED" },
        { status: 429, headers: { "Retry-After": String(Math.ceil((rate.resetAt - Date.now()) / 1000)) } },
      );
    }

    if (mode === "list") {
      const customers = await db.customer.findMany({
        where: { lineLinkedAt: { not: null } },
        orderBy: { lineLinkedAt: "desc" },
        take,
        select: {
          id: true,
          code: true,
          name: true,
          phone: true,
          source: true,
          lineUserId: true,
          lineLinkedAt: true,
          shippingAddress: true,
        },
      });
      const relinkCandidateIds = customers
        .filter((customer) => customer.source !== "LINE_LIFF" && customer.lineUserId && customer.lineLinkedAt)
        .map((customer) => customer.id);
      const customersById = new Map(customers.map((customer) => [customer.id, customer]));
      const unlinkLogs = relinkCandidateIds.length
        ? await db.auditLog.findMany({
            where: {
              action: AuditAction.UPDATE,
              entityType: "Customer",
              entityId: { in: relinkCandidateIds },
            },
            orderBy: { createdAt: "desc" },
            select: {
              entityId: true,
              createdAt: true,
              meta: true,
            },
          })
        : [];
      const relinkedCustomerIds = new Set<string>();

      for (const log of unlinkLogs) {
        if (!log.entityId || !hasAdminLineUnlinkMeta(log.meta)) continue;
        const customer = customersById.get(log.entityId);
        if (!customer?.lineLinkedAt) continue;
        if (log.createdAt.getTime() < customer.lineLinkedAt.getTime()) {
          relinkedCustomerIds.add(customer.id);
        }
      }

      return NextResponse.json({
        items: customers.map((customer) => {
          const linkKind =
            customer.source === "LINE_LIFF"
              ? LINE_NEW_CUSTOMER_KIND
              : relinkedCustomerIds.has(customer.id)
                ? OLD_CUSTOMER_RELINKED_KIND
                : OLD_CUSTOMER_LINKED_KIND;

          return {
            id: customer.id,
            code: customer.code,
            name: customer.name,
            phone: customer.phone,
            source: customer.source,
            linkKind,
            hasLineLink: Boolean(customer.lineUserId),
            isProfileIncomplete: isLineCustomerProfileIncomplete(customer),
            lineLinkedAt: customer.lineLinkedAt?.toISOString() ?? null,
          };
        }),
        latestLinkedAt: customers[0]?.lineLinkedAt?.toISOString() ?? null,
      });
    }

    const since = parsed.data.since ? new Date(parsed.data.since) : null;
    const where = since ? { lineLinkedAt: { gt: since } } : { lineLinkedAt: { not: null } };

    const [unreadCount, latest] = await Promise.all([
      since ? db.customer.count({ where }) : Promise.resolve(0),
      db.customer.findFirst({
        where: { lineLinkedAt: { not: null } },
        orderBy: { lineLinkedAt: "desc" },
        select: { lineLinkedAt: true },
      }),
    ]);

    return NextResponse.json({
      unreadCount,
      latestLinkedAt: latest?.lineLinkedAt?.toISOString() ?? null,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return safeError("UNAUTHORIZED", 401);
    }
    if (error instanceof Error && error.message === "FORBIDDEN") {
      return safeError("FORBIDDEN", 403);
    }
    console.error("[line-customer-notifications]", error);
    return safeError("INTERNAL_ERROR", 500);
  }
};
