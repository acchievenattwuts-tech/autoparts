import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test, { before, beforeEach, mock } from "node:test";

// approve/sync/archive of the knowledge CMS belong to knowledge admins (app role
// ADMIN, or legacy ADMIN without an app role); everyone with knowledge access
// keeps view/create/update (review item #215).

const ALL_KNOWLEDGE_KEYS = [
  "knowledge.view",
  "knowledge.create",
  "knowledge.update",
  "knowledge.approve",
  "knowledge.sync",
  "knowledge.archive",
];

type GrantRow = { userId: string; permissionId: string };
type StoredUser = { role: string; appRole: { name: string } | null };
const users: Record<string, StoredUser> = {};
const calls = {
  deletedPermissionIds: [] as string[][],
  created: [] as GrantRow[][],
  authVersionBumps: [] as string[],
};

before(async () => {
  const tx = {
    userPermissionGrant: {
      deleteMany: async (args: { where: { permissionId: { in: string[] } } }) => {
        calls.deletedPermissionIds.push(args.where.permissionId.in);
        return { count: 0 };
      },
      createMany: async (args: { data: GrantRow[] }) => {
        calls.created.push(args.data);
        return { count: args.data.length };
      },
    },
    user: {
      update: async (args: { where: { id: string } }) => {
        calls.authVersionBumps.push(args.where.id);
        return {};
      },
    },
  };
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        // ensureAccessControlSetup() fast path: catalog already present.
        permission: {
          count: async () => 10_000,
          findMany: async () => ALL_KNOWLEDGE_KEYS.map((key) => ({ id: `id:${key}`, key })),
        },
        user: {
          findUnique: async (args: { where: { id: string } }) => users[args.where.id] ?? null,
        },
        $transaction: async (fn: (client: typeof tx) => Promise<void>) => fn(tx),
      },
    },
  });
});

beforeEach(() => {
  calls.deletedPermissionIds.length = 0;
  calls.created.length = 0;
  calls.authVersionBumps.length = 0;
});

const BASIC_KEYS = ["knowledge.view", "knowledge.create", "knowledge.update"];

test("knowledge admin = app role ADMIN, or legacy ADMIN without an app role", async () => {
  const { getKnowledgePermissionKeysForUser, isKnowledgeAdminUser, KNOWLEDGE_ADMIN_ONLY_PERMISSION_KEYS } =
    await import("@/lib/access-control");
  // Today's production users: `admin` (ADMIN/ADMIN) and milk/vyvi/mai/kuk (STAFF/ADMIN).
  assert.equal(isKnowledgeAdminUser({ role: "ADMIN", appRoleName: "ADMIN" }), true);
  assert.equal(isKnowledgeAdminUser({ role: "STAFF", appRoleName: "ADMIN" }), true);
  assert.equal(isKnowledgeAdminUser({ role: "ADMIN", appRoleName: null }), true);
  assert.equal(isKnowledgeAdminUser({ role: "ADMIN", appRoleName: "STAFF_OPERATIONS" }), false);
  assert.equal(isKnowledgeAdminUser({ role: "STAFF", appRoleName: "STAFF_OPERATIONS" }), false);
  assert.equal(isKnowledgeAdminUser({ role: "STAFF", appRoleName: null }), false);

  assert.deepEqual(getKnowledgePermissionKeysForUser({ role: "STAFF", appRoleName: "ADMIN" }), ALL_KNOWLEDGE_KEYS);
  assert.deepEqual(getKnowledgePermissionKeysForUser({ role: "STAFF", appRoleName: "STAFF_VIEWER" }), BASIC_KEYS);
  assert.deepEqual([...KNOWLEDGE_ADMIN_ONLY_PERMISSION_KEYS], ["knowledge.approve", "knowledge.sync", "knowledge.archive"]);
});

test("resolveUserPermissionKeys keeps the legacy-ADMIN rule: knowledge only via direct grants", async () => {
  const { resolveUserPermissionKeys } = await import("@/lib/access-control");
  const admin = resolveUserPermissionKeys({ role: "ADMIN", appRolePermissionKeys: [], directPermissionKeys: ALL_KNOWLEDGE_KEYS });
  assert.ok(ALL_KNOWLEDGE_KEYS.every((key) => admin.includes(key as (typeof admin)[number])));
  const adminWithoutGrants = resolveUserPermissionKeys({ role: "ADMIN", appRolePermissionKeys: [], directPermissionKeys: [] });
  assert.ok(!adminWithoutGrants.some((key) => key.startsWith("knowledge.")));
  assert.ok(adminWithoutGrants.includes("sales.create"));
  const staff = resolveUserPermissionKeys({
    role: "STAFF",
    appRolePermissionKeys: ["sales.view", "not.a.key"],
    directPermissionKeys: ["knowledge.view", "sales.view"],
  });
  assert.deepEqual(staff, ["sales.view", "knowledge.view"]);
});

test("users-page knowledge checkbox grants a non-admin app role view/create/update only", async () => {
  const { setUserKnowledgeAccess } = await import("@/lib/access-control");
  users["staff-1"] = { role: "STAFF", appRole: { name: "STAFF_OPERATIONS" } };
  assert.deepEqual(await setUserKnowledgeAccess("staff-1", true), BASIC_KEYS);
  // Every knowledge grant is cleared first so a stale approve/sync/archive row is removed too.
  assert.deepEqual(calls.deletedPermissionIds, [ALL_KNOWLEDGE_KEYS.map((key) => `id:${key}`)]);
  assert.deepEqual(calls.created, [
    BASIC_KEYS.map((key) => ({ userId: "staff-1", permissionId: `id:${key}` })),
  ]);
  assert.deepEqual(calls.authVersionBumps, ["staff-1"]);
});

test("users-page knowledge checkbox grants app role ADMIN the full set, even with legacy role STAFF", async () => {
  const { setUserKnowledgeAccess } = await import("@/lib/access-control");
  users["milk"] = { role: "STAFF", appRole: { name: "ADMIN" } };
  assert.deepEqual(await setUserKnowledgeAccess("milk", true), ALL_KNOWLEDGE_KEYS);
  assert.deepEqual(
    calls.created[0]?.map((row) => row.permissionId),
    ALL_KNOWLEDGE_KEYS.map((key) => `id:${key}`),
  );

  calls.created.length = 0;
  assert.deepEqual(await setUserKnowledgeAccess("milk", false), []);
  assert.equal(calls.created.length, 0);
  assert.deepEqual(calls.authVersionBumps, ["milk", "milk"]);
});

test("legacy ADMIN without an app role keeps the full set; a missing user fails loudly", async () => {
  const { setUserKnowledgeAccess } = await import("@/lib/access-control");
  users["legacy-admin"] = { role: "ADMIN", appRole: null };
  assert.deepEqual(await setUserKnowledgeAccess("legacy-admin", true), ALL_KNOWLEDGE_KEYS);
  await assert.rejects(() => setUserKnowledgeAccess("nobody", true), /USER_NOT_FOUND/);
});

const read = (relativePath: string): string => readFileSync(path.join(process.cwd(), relativePath), "utf8");

test("knowledge approve/sync/archive buttons render only with the matching permission", () => {
  const actions = read("app/admin/(protected)/knowledge/KnowledgeActions.tsx");
  assert.match(actions, /permissions\.canApprove && status === "PENDING_APPROVAL"/);
  assert.match(actions, /permissions\.canSync && status === "SYNC_FAILED"/);
  assert.match(actions, /permissions\.canArchive && hasActive/);

  const gapActions = read("app/admin/(protected)/knowledge/quality/QualityGapActions.tsx");
  assert.match(gapActions, /if \(!permissions\.canApprove\) return null;/);

  for (const page of ["[id]/page.tsx", "approval/page.tsx", "sync/page.tsx"]) {
    assert.match(read(`app/admin/(protected)/knowledge/${page}`), /permissions=\{(getKnowledgeActionPermissions\(session\)|actionPermissions)\}/, page);
  }
});

test("migrate/check scripts no longer hand approve/sync/archive to every active user", () => {
  const migrate = read("prisma/scripts/migrate-knowledge-cms.ts");
  assert.match(migrate, /getKnowledgePermissionKeysForUser\(\{ role: user\.role, appRoleName: user\.appRole\?\.name \}\)/);
  const check = read("prisma/scripts/check-knowledge-cms.ts");
  assert.doesNotMatch(check, /ACTIVE_USER_KNOWLEDGE_GRANTS_INCOMPLETE/);
  assert.match(check, /isKnowledgeAdminUser\(\{ role: user\.role, appRoleName: user\.appRole\?\.name \}\)/);
  assert.match(check, /resolveUserPermissionKeys\(/);
  assert.match(check, /NO_ACTIVE_ADMIN_WITH_FULL_KNOWLEDGE_GRANTS/);
});
