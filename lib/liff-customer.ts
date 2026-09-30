import { getRequestContext, getRequestContextFromHeaders, safeWriteAuditLog } from "@/lib/audit-log";
import { buildCustomerPhoneLookupValues, normalizeCustomerPhone } from "@/lib/customer-phone";
import { db } from "@/lib/db";
import { isUniqueViolationOn } from "@/lib/doc-number-retry";
import { generateCustomerCode } from "@/lib/entity-code";
import { AuditAction, Prisma } from "@/lib/generated/prisma";
import { notifyLineCustomerLinked, type LineCustomerLinkKind } from "@/lib/notifications";

export const ADMIN_UNLINK_AUDIT_ACTIONS = [AuditAction.UPDATE, AuditAction.CANCEL];
export const LIFF_LINK_AUDIT_ACTIONS: AuditAction[] = [AuditAction.LINE_LINK, AuditAction.LINE_REGISTER];

export type LinkStateAudit = {
  action?: AuditAction;
  meta?: Prisma.JsonValue;
  before?: Prisma.JsonValue;
  after?: Prisma.JsonValue;
};

const isJsonObject = (value: Prisma.JsonValue | undefined): value is Prisma.JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * An admin unlink audit: flagged `lineUnlinkedByAdmin` (explicit unlink or a
 * deactivation that released the link), or — for audits written before that
 * flag existed — a before/after diff whose `lineUserId` went from a value to null.
 */
export function isAdminLineUnlinkAudit(log: LinkStateAudit): boolean {
  if (log.action && LIFF_LINK_AUDIT_ACTIONS.includes(log.action)) return false;
  if (isJsonObject(log.meta) && log.meta.lineUnlinkedByAdmin === true) return true;
  const previousLineUserId = isJsonObject(log.before) ? log.before.lineUserId : undefined;
  return (
    typeof previousLineUserId === "string" &&
    previousLineUserId !== "" &&
    isJsonObject(log.after) &&
    log.after.lineUserId === null
  );
}

/**
 * Checks whether an existing customer was previously unlinked by an admin. Used
 * to distinguish a fresh re-link (worth flagging) from a routine first link.
 *
 * Only LINE link-state events are compared, newest first: an admin unlink (see
 * {@link isAdminLineUnlinkAudit}) against a later LIFF link/registration.
 * Unrelated audits such as a profile edit or the reactivation that must precede
 * any relink of a deactivated customer never hide the unlink.
 */
async function isCustomerPreviouslyUnlinkedByAdmin(customerId: string): Promise<boolean> {
  const log = await db.auditLog.findFirst({
    where: {
      entityType: "Customer",
      entityId: customerId,
      OR: [
        {
          action: { in: ADMIN_UNLINK_AUDIT_ACTIONS },
          meta: { path: ["lineUnlinkedByAdmin"], equals: true },
        },
        {
          // Unflagged legacy unlink: a non-empty string lineUserId before, JSON null after.
          action: { in: ADMIN_UNLINK_AUDIT_ACTIONS },
          before: { path: ["lineUserId"], string_starts_with: "", not: "" },
          after: { path: ["lineUserId"], equals: Prisma.JsonNull },
        },
        { action: { in: LIFF_LINK_AUDIT_ACTIONS } },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { action: true, meta: true, before: true, after: true },
  });
  return log ? isAdminLineUnlinkAudit(log) : false;
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

// Only FAILED lookups (BLOCKED / AMBIGUOUS) count toward these limits; a lookup
// that links or registers the customer never consumes an attempt. The per-IP
// ceiling is higher than the per-LINE-user one because Thai mobile carriers put
// many customers behind one CGNAT address.
export const PHONE_LOOKUP_LINE_USER_LIMIT = 5;
export const PHONE_LOOKUP_IP_LIMIT = 15;
const PHONE_LOOKUP_WINDOW_MS = 60 * 60 * 1000;
const LIFF_PHONE_LOOKUP_PREFIX = "liff-phone-lookup";
const LIFF_PHONE_LOOKUP_IP_KEY_PREFIX = `${LIFF_PHONE_LOOKUP_PREFIX}:ip:`;
const LINE_CUSTOMER_FALLBACK_NAME = "ลูกค้า LINE";
const PHONE_LOOKUP_LIMIT_MESSAGE =
  "ลองหลายครั้งเกินไป กรุณารอประมาณ 1 ชั่วโมงแล้วลองใหม่อีกครั้ง";
const PHONE_REQUIRED_MESSAGE = "กรุณาระบุเบอร์โทรศัพท์";
const AMBIGUOUS_CUSTOMER_MESSAGE =
  "พบบัญชีหลายรายการจากเบอร์นี้ กรุณาติดต่อร้านเพื่อยืนยันข้อมูล";
const LINE_ALREADY_LINKED_MESSAGE =
  "เบอร์นี้ผูกกับ LINE อื่นแล้ว กรุณาติดต่อร้านเพื่อให้พนักงานตรวจสอบ";
// A LINE ID or phone already held by another (e.g. deactivated) customer row
// cannot be fixed by the customer retrying; staff has to review the records.
const LINE_LINK_CONFLICT_MESSAGE =
  "ไม่สามารถผูกบัญชี LINE กับเบอร์นี้ได้ กรุณาติดต่อร้านเพื่อให้พนักงานตรวจสอบ";
const LINE_LINK_UNIQUE_CONFLICT_REASON = "unique_conflict";
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
    ipAddress ? `${LIFF_PHONE_LOOKUP_IP_KEY_PREFIX}${ipAddress}` : null,
  ].filter((key): key is string => Boolean(key));
}

export function getLiffPhoneLookupLimit(key: string): number {
  return key.startsWith(LIFF_PHONE_LOOKUP_IP_KEY_PREFIX)
    ? PHONE_LOOKUP_IP_LIMIT
    : PHONE_LOOKUP_LINE_USER_LIMIT;
}

/**
 * Throws the customer-visible limit message when any throttle key has already
 * reached its failure limit inside the window. Read-only: it never consumes an
 * attempt — only {@link recordLiffPhoneLookupFailure} does, once the lookup has
 * actually failed.
 */
export async function assertLiffPhoneLookupAllowed(keys: string[]): Promise<void> {
  if (keys.length === 0) return;

  const now = new Date();
  const windowStart = new Date(now.getTime() - PHONE_LOOKUP_WINDOW_MS);
  const records = await db.loginThrottle.findMany({
    where: { key: { in: keys } },
  });
  const isBlocked = records.some((record) => {
    if (record.lockedUntil && record.lockedUntil > now) return true;
    return (
      record.firstFailureAt !== null &&
      record.firstFailureAt >= windowStart &&
      record.failures >= getLiffPhoneLookupLimit(record.key)
    );
  });

  if (isBlocked) {
    throw new Error(PHONE_LOOKUP_LIMIT_MESSAGE);
  }
}

function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Adds one failure in the database itself (`failures = failures + 1`), creating the row on first failure. */
async function incrementLiffPhoneLookupFailures(key: string, now: Date): Promise<{ failures: number }> {
  const upsert = () =>
    db.loginThrottle.upsert({
      where: { key },
      create: { key, failures: 1, firstFailureAt: now, lockedUntil: null },
      update: { failures: { increment: 1 } },
      select: { failures: true },
    });
  try {
    return await upsert();
  } catch (error) {
    // Two first failures can race on the insert; the loser increments the winner's row.
    if (isUniqueConstraintError(error)) return upsert();
    throw error;
  }
}

/**
 * Counts one failed lookup (BLOCKED / AMBIGUOUS) against every throttle key.
 * Every step is a single conditional or atomic statement, so parallel failures
 * never overwrite each other's count:
 * 1. an expired (or never started) window is reset to zero — the WHERE is
 *    re-checked under the row lock, so only one of several racing requests resets;
 * 2. the counter is incremented in the database;
 * 3. the lock is set from the count that increment returned.
 */
export async function recordLiffPhoneLookupFailure(keys: string[]): Promise<void> {
  if (keys.length === 0) return;

  const now = new Date();
  const windowStart = new Date(now.getTime() - PHONE_LOOKUP_WINDOW_MS);
  const lockedUntil = new Date(now.getTime() + PHONE_LOOKUP_WINDOW_MS);

  for (const key of keys) {
    await db.loginThrottle.updateMany({
      where: { key, OR: [{ firstFailureAt: null }, { firstFailureAt: { lt: windowStart } }] },
      data: { failures: 0, firstFailureAt: now, lockedUntil: null },
    });
    const { failures } = await incrementLiffPhoneLookupFailures(key, now);
    if (failures >= getLiffPhoneLookupLimit(key)) {
      await db.loginThrottle.update({ where: { key }, data: { lockedUntil } });
    }
  }
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

type LineLinkCustomer = { id: string; code: string | null; name: string };

type CustomerLineClaim =
  | { outcome: "CLAIMED"; customer: LineLinkCustomer }
  | { outcome: "ALREADY_LINKED"; customer: LineLinkCustomer }
  | { outcome: "LOST" }
  | { outcome: "UNIQUE_CONFLICT" };

/**
 * After a lost claim, tells a double submit of the same LINE identity (which
 * the winning request already linked, audited and notified) apart from a real
 * conflict with another identity or an admin deactivation.
 */
async function readSameIdentityLink(customerId: string, lineUserId: string): Promise<CustomerLineClaim> {
  const current = await db.customer.findUnique({
    where: { id: customerId },
    select: { id: true, code: true, name: true, isActive: true, lineUserId: true },
  });
  if (current?.isActive && current.lineUserId === lineUserId) {
    return { outcome: "ALREADY_LINKED", customer: { id: current.id, code: current.code, name: current.name } };
  }
  return { outcome: "LOST" };
}

async function claimCustomerLineLink(
  customerId: string,
  lineUserId: string,
  phone: string,
): Promise<CustomerLineClaim> {
  try {
    const customer = await db.customer.update({
      // Recheck the guard in the write itself: another LINE identity, a second
      // submit of this identity or an admin deactivation can win after the
      // phone lookup has completed. Only an unlinked customer is claimed.
      where: {
        id: customerId,
        isActive: true,
        OR: [{ lineUserId: null }, { lineUserId: "" }],
      },
      data: { phone, lineUserId, lineLinkedAt: new Date() },
      select: { id: true, code: true, name: true },
    });
    return { outcome: "CLAIMED", customer };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { outcome: "UNIQUE_CONFLICT" };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return readSameIdentityLink(customerId, lineUserId);
    }
    throw error;
  }
}

async function blockCustomerLineLink(input: {
  customer: LineLinkCustomer | null;
  lineUserId: string;
  phone: string;
  throttleKeys: string[];
  uniqueConflict?: boolean;
}): Promise<LiffLinkResult> {
  await writeCustomerLineAudit({
    action: AuditAction.LINE_LINK_BLOCKED,
    customerId: input.customer?.id ?? null,
    customerRef: input.customer ? input.customer.code ?? input.customer.name : null,
    meta: input.uniqueConflict
      ? { lineUserId: input.lineUserId, phone: input.phone, reason: LINE_LINK_UNIQUE_CONFLICT_REASON }
      : { lineUserId: input.lineUserId, phone: input.phone },
  });
  await recordLiffPhoneLookupFailure(input.throttleKeys);
  return {
    status: "BLOCKED",
    message: input.uniqueConflict ? LINE_LINK_CONFLICT_MESSAGE : LINE_ALREADY_LINKED_MESSAGE,
  };
}

/**
 * Creates the LINE customer for a phone that is not on file. A unique conflict
 * is either a double submit of this same identity (the winner already
 * registered, audited and notified) or a LINE ID / phone held by another
 * customer row, which staff has to review.
 */
async function registerLiffCustomer(input: {
  lineUserId: string;
  displayName: string | null;
  phone: string;
  throttleKeys: string[];
}): Promise<LiffLinkResult> {
  const code = await generateCustomerCode();
  let customer: LineLinkCustomer;
  try {
    customer = await db.customer.create({
      data: {
        code,
        name: input.displayName?.trim() || LINE_CUSTOMER_FALLBACK_NAME,
        phone: input.phone,
        source: "LINE_LIFF",
        lineUserId: input.lineUserId,
        lineLinkedAt: new Date(),
      },
      select: { id: true, code: true, name: true },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const winner = await resolveCustomerByLineUserId(input.lineUserId);
    if (winner) {
      return { status: "LINKED", customerId: winner.id, customerName: winner.name };
    }
    // A customer-code race is transient: keep the generic "try again" error.
    if (isUniqueViolationOn(error, "code")) throw error;
    return blockCustomerLineLink({
      customer: null,
      lineUserId: input.lineUserId,
      phone: input.phone,
      throttleKeys: input.throttleKeys,
      uniqueConflict: true,
    });
  }

  await writeCustomerLineAudit({
    action: AuditAction.LINE_REGISTER,
    customerId: customer.id,
    customerRef: customer.code ?? customer.name,
    meta: { lineUserId: input.lineUserId, phone: input.phone, source: "LINE_LIFF" },
  });

  // Iron rule §8: notifications go to the bell AND Telegram together.
  await safeNotifyLineCustomerLinked({
    kind: "LINE_NEW_CUSTOMER",
    customerId: customer.id,
    customerName: customer.name,
    customerCode: customer.code,
    phone: input.phone,
  });

  return { status: "REGISTERED", customerId: customer.id, customerName: customer.name };
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
    await recordLiffPhoneLookupFailure(input.throttleKeys);
    return {
      status: "AMBIGUOUS",
      message: AMBIGUOUS_CUSTOMER_MESSAGE,
    };
  }

  const matchedCustomer = matchedCustomers[0];

  if (matchedCustomer?.lineUserId && matchedCustomer.lineUserId !== input.lineUserId) {
    return blockCustomerLineLink({
      customer: matchedCustomer,
      lineUserId: input.lineUserId,
      phone: normalizedPhone,
      throttleKeys: input.throttleKeys,
    });
  }

  if (matchedCustomer) {
    // Determine link kind BEFORE the update so a relink is detected based on
    // pre-existing admin-unlink history (not the link we're about to create).
    const wasUnlinkedByAdmin = await isCustomerPreviouslyUnlinkedByAdmin(matchedCustomer.id);

    const claim = await claimCustomerLineLink(matchedCustomer.id, input.lineUserId, normalizedPhone);
    if (claim.outcome === "ALREADY_LINKED") {
      // A concurrent submit of this same identity won the claim and already
      // wrote the audit and notification; never repeat them.
      return { status: "LINKED", customerId: claim.customer.id, customerName: claim.customer.name };
    }
    if (claim.outcome !== "CLAIMED") {
      return blockCustomerLineLink({
        customer: matchedCustomer,
        lineUserId: input.lineUserId,
        phone: normalizedPhone,
        throttleKeys: input.throttleKeys,
        uniqueConflict: claim.outcome === "UNIQUE_CONFLICT",
      });
    }
    const { customer } = claim;

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

  return registerLiffCustomer({
    lineUserId: input.lineUserId,
    displayName: input.displayName,
    phone: normalizedPhone,
    throttleKeys: input.throttleKeys,
  });
}
