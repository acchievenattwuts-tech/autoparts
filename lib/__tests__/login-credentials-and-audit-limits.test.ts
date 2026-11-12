import assert from "node:assert/strict";
import test, { before, mock } from "node:test";

/**
 * A1 (review 2026-11-12): the admin login runs before authentication, so an
 * unbounded username used to reach `LoginThrottle` keys and `AuditLog.entityRef`
 * whole. These tests pin the new bounds and show that ordinary values are kept
 * unchanged.
 */

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type CreatedAudit = { data: Record<string, unknown> };
const created: CreatedAudit[] = [];

before(async () => {
  if (moduleMocksUnavailable) return;
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        auditLog: {
          create: async (args: CreatedAudit): Promise<{ id: string }> => {
            created.push(args);
            return { id: "audit-1" };
          },
        },
      },
    },
  });
});

test("login credentials accept every real account and reject oversized input", async () => {
  const {
    LOGIN_PASSWORD_MAX_LENGTH,
    LOGIN_USERNAME_MAX_LENGTH,
    loginCredentialsSchema,
  } = await import("@/lib/login-credentials");

  assert.equal(loginCredentialsSchema.safeParse({ username: "admin", password: "secret123" }).success, true);
  assert.equal(
    loginCredentialsSchema.safeParse({
      username: "u".repeat(LOGIN_USERNAME_MAX_LENGTH),
      password: "p".repeat(LOGIN_PASSWORD_MAX_LENGTH),
    }).success,
    true,
  );
  assert.equal(
    loginCredentialsSchema.safeParse({ username: "u".repeat(LOGIN_USERNAME_MAX_LENGTH + 1), password: "x" }).success,
    false,
  );
  assert.equal(
    loginCredentialsSchema.safeParse({ username: "admin", password: "p".repeat(LOGIN_PASSWORD_MAX_LENGTH + 1) }).success,
    false,
  );
  assert.equal(loginCredentialsSchema.safeParse({ username: "x".repeat(5_000_000), password: "x" }).success, false);
  assert.equal(loginCredentialsSchema.safeParse({ username: "", password: "x" }).success, false);
});

test("the login limits are not tighter than what the user forms allow", async () => {
  const { LOGIN_PASSWORD_MAX_LENGTH, LOGIN_USERNAME_MAX_LENGTH } = await import("@/lib/login-credentials");
  // users/actions.ts: username .max(100), password .max(100); change-password: .max(100).
  assert.ok(LOGIN_USERNAME_MAX_LENGTH >= 100);
  assert.ok(LOGIN_PASSWORD_MAX_LENGTH >= 100);
});

test("truncateAuditText keeps short values and cuts long ones without splitting a surrogate pair", async () => {
  const { truncateAuditText } = await import("@/lib/audit-log");
  assert.equal(truncateAuditText(null, 10), null);
  assert.equal(truncateAuditText(undefined, 10), null);
  assert.equal(truncateAuditText("SO202611120001", 255), "SO202611120001");
  assert.equal(truncateAuditText("ใบขาย ลูกค้าอู่", 255), "ใบขาย ลูกค้าอู่");
  assert.equal(truncateAuditText("abcdef", 3), "abc");
  // "😀" is a surrogate pair; cutting at 4 would leave its high half alone.
  assert.equal(truncateAuditText("abc😀def", 4), "abc");
  assert.equal(truncateAuditText("abc😀def", 5), "abc😀");
});

test("writeAuditLog stores ordinary values unchanged and caps oversized free-text columns", { skip: moduleMocksUnavailable }, async () => {
  const {
    AUDIT_ENTITY_REF_MAX_LENGTH,
    AUDIT_IP_ADDRESS_MAX_LENGTH,
    AUDIT_USER_AGENT_MAX_LENGTH,
    writeAuditLog,
  } = await import("@/lib/audit-log");
  const { AuditAction } = await import("@/lib/generated/prisma");

  created.length = 0;
  const ordinaryUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36";
  await writeAuditLog({
    action: AuditAction.LOGIN_FAILED,
    entityType: "Auth",
    entityRef: "admin",
    ipAddress: "203.0.113.7",
    userAgent: ordinaryUserAgent,
    meta: { reason: "INVALID_PASSWORD" },
  });
  assert.equal(created[0].data.entityRef, "admin");
  assert.equal(created[0].data.ipAddress, "203.0.113.7");
  assert.equal(created[0].data.userAgent, ordinaryUserAgent);

  await writeAuditLog({
    action: AuditAction.LOGIN_FAILED,
    entityType: "Auth",
    entityRef: "x".repeat(1_000_000),
    ipAddress: "1".repeat(500),
    userAgent: "y".repeat(100_000),
    meta: { reason: "LOGIN_BLOCKED" },
  });
  assert.equal(String(created[1].data.entityRef).length, AUDIT_ENTITY_REF_MAX_LENGTH);
  assert.equal(String(created[1].data.ipAddress).length, AUDIT_IP_ADDRESS_MAX_LENGTH);
  assert.equal(String(created[1].data.userAgent).length, AUDIT_USER_AGENT_MAX_LENGTH);

  await writeAuditLog({ action: AuditAction.LOGOUT, entityType: "Auth" });
  assert.equal(created[2].data.entityRef, null);
  assert.equal(created[2].data.ipAddress, null);
  assert.equal(created[2].data.userAgent, null);
});
