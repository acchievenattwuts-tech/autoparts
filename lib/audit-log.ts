import type { Session } from "next-auth";
import { headers } from "next/headers";

import { db } from "@/lib/db";
import { AuditAction, Prisma } from "@/lib/generated/prisma";

const REDACTED_VALUE = "[REDACTED]";

const SENSITIVE_KEYS = new Set([
  "password",
  "currentPassword",
  "newPassword",
  "confirmPassword",
  "token",
  "accessToken",
  "refreshToken",
  "secret",
  "apiKey",
  "authorization",
]);

type JsonValue = Prisma.JsonValue;

export type AuditLogActor = {
  userId?: string | null;
  userName?: string | null;
  userRole?: string | null;
};

export type AuditRequestContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type AuditLogInput = AuditLogActor &
  AuditRequestContext & {
    action: AuditAction;
    entityType: string;
    entityId?: string | null;
    entityRef?: string | null;
    before?: unknown;
    after?: unknown;
    meta?: unknown;
  };

type PlainObject = Prisma.JsonObject;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function serializeAuditValue(value: unknown): JsonValue {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Prisma.Decimal) {
    return value.toString();
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeAuditValue(item));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeAuditValue(item)]),
    );
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  return String(value);
}

export function redactSensitive(payload: unknown): JsonValue {
  const serialized = serializeAuditValue(payload);

  if (Array.isArray(serialized)) {
    return serialized.map((item) => redactSensitive(item));
  }

  if (isPlainObject(serialized)) {
    return Object.fromEntries(
      Object.entries(serialized).map(([key, value]) => [
        key,
        SENSITIVE_KEYS.has(key) ? REDACTED_VALUE : redactSensitive(value),
      ]),
    );
  }

  return serialized;
}

function valuesAreEqual(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function diffObject(before: PlainObject, after: PlainObject): { before: PlainObject; after: PlainObject } {
  const beforeDiff: PlainObject = {};
  const afterDiff: PlainObject = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of keys) {
    const beforeValue = before[key] ?? null;
    const afterValue = after[key] ?? null;

    if (isPlainObject(beforeValue) && isPlainObject(afterValue)) {
      const nestedDiff = diffObject(beforeValue, afterValue);
      if (Object.keys(nestedDiff.before).length > 0 || Object.keys(nestedDiff.after).length > 0) {
        beforeDiff[key] = nestedDiff.before;
        afterDiff[key] = nestedDiff.after;
      }
      continue;
    }

    if (!valuesAreEqual(beforeValue, afterValue)) {
      beforeDiff[key] = beforeValue;
      afterDiff[key] = afterValue;
    }
  }

  return { before: beforeDiff, after: afterDiff };
}

export function diffEntity(before: unknown, after: unknown): { before: JsonValue; after: JsonValue } {
  const safeBefore = redactSensitive(before);
  const safeAfter = redactSensitive(after);

  if (isPlainObject(safeBefore) && isPlainObject(safeAfter)) {
    return diffObject(safeBefore, safeAfter);
  }

  if (valuesAreEqual(safeBefore, safeAfter)) {
    return { before: {}, after: {} };
  }

  return {
    before: safeBefore,
    after: safeAfter,
  };
}

export async function getRequestContext(): Promise<AuditRequestContext> {
  const requestHeaders = await headers();
  return getRequestContextFromHeaders(requestHeaders);
}

export function getRequestContextFromHeaders(
  requestHeaders: Pick<Headers, "get">,
): AuditRequestContext {
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  const realIp = requestHeaders.get("x-real-ip");
  const cfConnectingIp = requestHeaders.get("cf-connecting-ip");
  const userAgent = requestHeaders.get("user-agent");

  return {
    ipAddress:
      forwardedFor?.split(",")[0]?.trim() ||
      realIp?.trim() ||
      cfConnectingIp?.trim() ||
      null,
    userAgent: userAgent?.trim() || null,
  };
}

export function getAuditActorFromSession(session: Session | null | undefined): AuditLogActor {
  return {
    userId: session?.user?.id ?? null,
    userName: session?.user?.name ?? session?.user?.email ?? null,
    userRole: session?.user?.role ?? null,
  };
}

function normalizeAuditPayload(input: AuditLogInput) {
  const beforeValue =
    input.before === undefined
      ? undefined
      : redactSensitive(input.before) === null
        ? Prisma.JsonNull
        : (redactSensitive(input.before) as Prisma.InputJsonValue);
  const afterValue =
    input.after === undefined
      ? undefined
      : redactSensitive(input.after) === null
        ? Prisma.JsonNull
        : (redactSensitive(input.after) as Prisma.InputJsonValue);
  const metaValue =
    input.meta === undefined
      ? undefined
      : redactSensitive(input.meta) === null
        ? Prisma.JsonNull
        : (redactSensitive(input.meta) as Prisma.InputJsonValue);

  return {
    userId: input.userId ?? null,
    userName: input.userName ?? null,
    userRole: input.userRole ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    entityRef: input.entityRef ?? null,
    before: beforeValue,
    after: afterValue,
    meta: metaValue,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  };
}

export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  const payload = normalizeAuditPayload(input);
  await db.auditLog.create({ data: payload });
}

export async function writeAuditLogTx(
  tx: Prisma.TransactionClient,
  input: AuditLogInput,
): Promise<void> {
  const payload = normalizeAuditPayload(input);
  await tx.auditLog.create({ data: payload });
}

export async function safeWriteAuditLog(input: AuditLogInput): Promise<void> {
  try {
    await writeAuditLog(input);
  } catch (error) {
    console.error("[audit-log]", error);
  }
}
