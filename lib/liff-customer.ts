import { getRequestContext, getRequestContextFromHeaders, safeWriteAuditLog } from "@/lib/audit-log";
import { buildCustomerPhoneLookupValues, normalizeCustomerPhone } from "@/lib/customer-phone";
import { db } from "@/lib/db";
import { generateCustomerCode } from "@/lib/entity-code";
import { AuditAction } from "@/lib/generated/prisma";
import { notifyLineCustomerLinked, type LineCustomerLinkKind } from "@/lib/notifications";

/**
 * Checks whether an existing customer was previously unlinked by an admin. Used
 * to distinguish a fresh re-link (worth flagging) from a routine first link.
 */
async function isCustomerPreviouslyUnlinkedByAdmin(customerId: string): Promise<boolean> {
  const log = await db.auditLog.findFirst({
    where: {
      action: AuditAction.UPDATE,
      entityType: "Customer",
      entityId: customerId,
    },
    orderBy: { createdAt: "desc" },
    select: { meta: true },
  });
  return (
    typeof log?.meta === "object" &&
    log.meta !== null &&
    !Array.isArray(log.meta) &&
    "lineUnlinkedByAdmin" in log.meta &&
    (log.meta as { lineUnlinkedByAdmin?: boolean }).lineUnlinkedByAdmin === true
  );
}

/**
 * Best-effort: dispatch the in-app bell + Telegram for a LINE customer linkage.
 * Wrapped so the LIFF flow never fails just because a notification failed.
 */
async function safeNotifyLineCustomerLinked(input: {
  kind: LineCustomerLinkKind;
  customerId: string;
  customerName: string;
  customerCode?: string | null;
  phone?: string | null;
}): Promise<void> {
  try {
    await notifyLineCustomerLinked(input);
  } catch (error) {
    console.warn(
      "[liff-customer] LINE customer notification skipped:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
}

const PHONE_LOOKUP_LIMIT = 5;
const PHONE_LOOKUP_WINDOW_MS = 60 * 60 * 1000;
const LIFF_PHONE_LOOKUP_PREFIX = "liff-phone-lookup";
const LINE_CUSTOMER_FALLBACK_NAME = "ลูกค้า LINE";
const PHONE_LOOKUP_LIMIT_MESSAGE =
  "ลองหลายครั้งเกินไป กรุณารอประมาณ 1 ชั่วโมงแล้วลองใหม่อีกครั้ง";
const PHONE_REQUIRED_MESSAGE = "กรุณาระบุเบอร์โทรศัพท์";
const AMBIGUOUS_CUSTOMER_MESSAGE =
  "พบบัญชีหลายรายการจากเบอร์นี้ กรุณาติดต่อร้านเพื่อยืนยันข้อมูล";
const LINE_ALREADY_LINKED_MESSAGE =
  "เบอร์นี้ผูกกับ LINE อื่นแล้ว กรุณาติดต่อร้านเพื่อให้พนักงานตรวจสอบ";
const CUSTOMER_VISIBLE_ERROR_MESSAGES = new Set([
  PHONE_LOOKUP_LIMIT_MESSAGE,
  PHONE_REQUIRED_MESSAGE,
  AMBIGUOUS_CUSTOMER_MESSAGE,
  LINE_ALREADY_LINKED_MESSAGE,
]);

export type LiffLinkResult =
  | { status: "LINKED"; customerId: string; customerName: string }
  | { status: "REGISTERED"; customerId: string; customerName: string }
  | { status: "BLOCKED"; message: string }
  | { status: "AMBIGUOUS"; message: string };

export function isLiffCustomerVisibleError(error: unknown): error is Error {
  return error instanceof Error && CUSTOMER_VISIBLE_ERROR_MESSAGES.has(error.message);
}

export function getLiffPhoneLookupThrottleKeys(lineUserId: string, request: Request) {
  const { ipAddress } = getRequestContextFromHeaders(request.headers);
  return [
    `${LIFF_PHONE_LOOKUP_PREFIX}:line:${lineUserId}`,
    ipAddress ? `${LIFF_PHONE_LOOKUP_PREFIX}:ip:${ipAddress}` : null,
  ].filter((key): key is string => Boolean(key));
}

export async function assertLiffPhoneLookupAllowed(keys: string[]) {
  if (keys.length === 0) return;

  const now = new Date();
  const windowStart = new Date(now.getTime() - PHONE_LOOKUP_WINDOW_MS);
  const lockedUntil = new Date(now.getTime() + PHONE_LOOKUP_WINDOW_MS);
  const records = await db.loginThrottle.findMany({
    where: { key: { in: keys } },
  });
  const recordMap = new Map(records.map((record) => [record.key, record]));
  const isBlocked = records.some((record) => {
    if (record.lockedUntil && record.lockedUntil > now) return true;
    return (
      record.firstFailureAt !== null &&
      record.firstFailureAt >= windowStart &&
      record.failures >= PHONE_LOOKUP_LIMIT
    );
  });

  if (isBlocked) {
    throw new Error(PHONE_LOOKUP_LIMIT_MESSAGE);
  }

  await db.$transaction(
    keys.map((key) => {
      const current = recordMap.get(key);
      const shouldReset =
        !current || current.firstFailureAt === null || current.firstFailureAt < windowStart;

      if (shouldReset) {
        return db.loginThrottle.upsert({
          where: { key },
          create: {
            key,
            failures: 1,
            firstFailureAt: now,
            lockedUntil: null,
          },
          update: {
            failures: 1,
            firstFailureAt: now,
            lockedUntil: null,
          },
        });
      }

      const failures = current.failures + 1;
      return db.loginThrottle.update({
        where: { key },
        data: {
          failures,
          lockedUntil: failures >= PHONE_LOOKUP_LIMIT ? lockedUntil : null,
        },
      });
    }),
  );
}

async function writeCustomerLineAudit(input: {
  action: AuditAction;
  customerId?: string | null;
  customerRef?: string | null;
  meta?: unknown;
}) {
  await safeWriteAuditLog({
    ...(await getRequestContext()),
    action: input.action,
    entityType: "Customer",
    entityId: input.customerId ?? null,
    entityRef: input.customerRef ?? null,
    meta: input.meta,
  });
}

export async function resolveCustomerByLineUserId(lineUserId: string) {
  return db.customer.findFirst({
    where: { lineUserId, isActive: true },
    select: {
      id: true,
      code: true,
      name: true,
      phone: true,
      lineUserId: true,
      lineLinkedAt: true,
      source: true,
    },
  });
}

export async function resolveLiffCustomerFromPhone(input: {
  lineUserId: string;
  displayName: string | null;
  phone: string;
  throttleKeys: string[];
}): Promise<LiffLinkResult> {
  // A verified LINE identity that is already linked must be able to recreate
  // its LIFF session without requiring the phone again, mutating the customer,
  // consuming lookup attempts, writing duplicate audits, or dispatching another
  // notification.
  const alreadyLinkedCustomer = await resolveCustomerByLineUserId(input.lineUserId);
  if (alreadyLinkedCustomer) {
    return {
      status: "LINKED",
      customerId: alreadyLinkedCustomer.id,
      customerName: alreadyLinkedCustomer.name,
    };
  }

  const normalizedPhone = normalizeCustomerPhone(input.phone);
  if (!normalizedPhone) {
    throw new Error(PHONE_REQUIRED_MESSAGE);
  }

  await assertLiffPhoneLookupAllowed(input.throttleKeys);

  const phoneVariants = buildCustomerPhoneLookupValues(normalizedPhone);
  const matchedCustomers = await db.customer.findMany({
    where: { phone: { in: phoneVariants }, isActive: true },
    select: {
      id: true,
      code: true,
      name: true,
      phone: true,
      lineUserId: true,
    },
    take: 2,
  });

  if (matchedCustomers.length > 1) {
    await writeCustomerLineAudit({
      action: AuditAction.LINE_LINK_AMBIGUOUS,
      meta: { lineUserId: input.lineUserId, phone: normalizedPhone, matchedCount: matchedCustomers.length },
    });
    return {
      status: "AMBIGUOUS",
      message: AMBIGUOUS_CUSTOMER_MESSAGE,
    };
  }

  const matchedCustomer = matchedCustomers[0];

  if (matchedCustomer?.lineUserId && matchedCustomer.lineUserId !== input.lineUserId) {
    await writeCustomerLineAudit({
      action: AuditAction.LINE_LINK_BLOCKED,
      customerId: matchedCustomer.id,
      customerRef: matchedCustomer.code ?? matchedCustomer.name,
      meta: { lineUserId: input.lineUserId, phone: normalizedPhone },
    });
    return {
      status: "BLOCKED",
      message: LINE_ALREADY_LINKED_MESSAGE,
    };
  }

  if (matchedCustomer) {
    // Determine link kind BEFORE the update so a relink is detected based on
    // pre-existing admin-unlink history (not the link we're about to create).
    const wasUnlinkedByAdmin = await isCustomerPreviouslyUnlinkedByAdmin(matchedCustomer.id);

    const customer = await db.customer.update({
      where: { id: matchedCustomer.id },
      data: {
        phone: normalizedPhone,
        lineUserId: input.lineUserId,
        lineLinkedAt: new Date(),
      },
      select: { id: true, code: true, name: true },
    });

    await writeCustomerLineAudit({
      action: AuditAction.LINE_LINK,
      customerId: customer.id,
      customerRef: customer.code ?? customer.name,
      meta: { lineUserId: input.lineUserId, phone: normalizedPhone },
    });

    // Iron rule §8: notifications go to the bell AND Telegram together.
    await safeNotifyLineCustomerLinked({
      kind: wasUnlinkedByAdmin ? "LINE_OLD_CUSTOMER_RELINKED" : "LINE_OLD_CUSTOMER_LINKED",
      customerId: customer.id,
      customerName: customer.name,
      customerCode: customer.code,
      phone: normalizedPhone,
    });

    return { status: "LINKED", customerId: customer.id, customerName: customer.name };
  }

  const code = await generateCustomerCode();
  const customer = await db.customer.create({
    data: {
      code,
      name: input.displayName?.trim() || LINE_CUSTOMER_FALLBACK_NAME,
      phone: normalizedPhone,
      source: "LINE_LIFF",
      lineUserId: input.lineUserId,
      lineLinkedAt: new Date(),
    },
    select: { id: true, code: true, name: true },
  });

  await writeCustomerLineAudit({
    action: AuditAction.LINE_REGISTER,
    customerId: customer.id,
    customerRef: customer.code ?? customer.name,
    meta: { lineUserId: input.lineUserId, phone: normalizedPhone, source: "LINE_LIFF" },
  });

  // Iron rule §8: notifications go to the bell AND Telegram together.
  await safeNotifyLineCustomerLinked({
    kind: "LINE_NEW_CUSTOMER",
    customerId: customer.id,
    customerName: customer.name,
    customerCode: customer.code,
    phone: normalizedPhone,
  });

  return { status: "REGISTERED", customerId: customer.id, customerName: customer.name };
}
