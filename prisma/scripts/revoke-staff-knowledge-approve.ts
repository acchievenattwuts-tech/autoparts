/**
 * Removes the admin-only knowledge grants (knowledge.approve / knowledge.sync /
 * knowledge.archive) from every user who is not a knowledge admin. A knowledge
 * admin is a user whose app role is ADMIN, or a legacy role=ADMIN user without an
 * app role (isKnowledgeAdminUser in lib/access-control.ts). The first run of
 * migrate-knowledge-cms.ts and the old users-page checkbox granted these keys to
 * every active user.
 *
 * Per affected user, in one transaction:
 *   - delete the direct UserPermissionGrant rows for the admin-only keys
 *     (view/create/update are kept)
 *   - bump User.authVersion so the current session is revoked and the next login
 *     carries the reduced permission set (same as the users page)
 *   - write an AuditLog PERMISSION_CHANGE entry with the knowledge keys before/after
 *
 * App roles are never changed here. A non-ADMIN app role that itself contains an
 * admin-only key is listed so it can be fixed on the roles page.
 *
 * Dry run (default, read-only):
 *   npx tsx --env-file=.env.local prisma/scripts/revoke-staff-knowledge-approve.ts
 * Write:
 *   npx tsx --env-file=.env.local prisma/scripts/revoke-staff-knowledge-approve.ts --apply
 */
import { AuditAction } from "../../lib/generated/prisma";
import { db } from "../../lib/db";
import {
  isKnowledgeAdminOnlyPermission,
  isKnowledgeAdminUser,
  isKnowledgePermission,
  KNOWLEDGE_ADMIN_APP_ROLE_NAME,
  KNOWLEDGE_ADMIN_ONLY_PERMISSION_KEYS,
} from "../../lib/access-control";

const SCRIPT_PATH = "prisma/scripts/revoke-staff-knowledge-approve.ts";
const AUDIT_ACTOR_NAME = "maintenance-script";

type AffectedUser = {
  id: string;
  ref: string;
  name: string;
  role: string;
  appRoleName: string | null;
  isActive: boolean;
  knowledgeBefore: string[];
  knowledgeAfter: string[];
  revokeGrantIds: string[];
  revokeKeys: string[];
};

type KeptUser = { ref: string; role: string; appRoleName: string | null; keys: string[] };

async function scanDirectGrants(): Promise<{ affected: AffectedUser[]; kept: KeptUser[] }> {
  const users = await db.user.findMany({
    where: {
      directPermissionGrants: {
        some: { permission: { key: { in: [...KNOWLEDGE_ADMIN_ONLY_PERMISSION_KEYS] } } },
      },
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      role: true,
      isActive: true,
      appRole: { select: { name: true } },
      directPermissionGrants: {
        select: { id: true, permission: { select: { key: true } } },
      },
    },
  });

  const affected: AffectedUser[] = [];
  const kept: KeptUser[] = [];
  for (const user of users) {
    const appRoleName = user.appRole?.name ?? null;
    const ref = user.username ?? user.email;
    const knowledgeGrants = user.directPermissionGrants.filter((grant) => isKnowledgePermission(grant.permission.key));
    const revoked = knowledgeGrants.filter((grant) => isKnowledgeAdminOnlyPermission(grant.permission.key));
    if (isKnowledgeAdminUser({ role: user.role, appRoleName })) {
      kept.push({ ref, role: user.role, appRoleName, keys: revoked.map((grant) => grant.permission.key).sort() });
      continue;
    }
    affected.push({
      id: user.id,
      ref,
      name: user.name,
      role: user.role,
      appRoleName,
      isActive: user.isActive,
      knowledgeBefore: knowledgeGrants.map((grant) => grant.permission.key).sort(),
      knowledgeAfter: knowledgeGrants
        .filter((grant) => !isKnowledgeAdminOnlyPermission(grant.permission.key))
        .map((grant) => grant.permission.key)
        .sort(),
      revokeGrantIds: revoked.map((grant) => grant.id),
      revokeKeys: revoked.map((grant) => grant.permission.key).sort(),
    });
  }
  return { affected, kept };
}

/** Non-ADMIN app roles that grant an admin-only key themselves (not changed here). */
async function findNonAdminAppRolesWithAdminOnlyKeys(): Promise<Array<{ name: string; keys: string[]; users: number }>> {
  const roles = await db.appRole.findMany({
    where: {
      name: { not: KNOWLEDGE_ADMIN_APP_ROLE_NAME },
      permissions: { some: { permission: { key: { in: [...KNOWLEDGE_ADMIN_ONLY_PERMISSION_KEYS] } } } },
    },
    select: {
      name: true,
      permissions: { select: { permission: { select: { key: true } } } },
      _count: { select: { users: true } },
    },
  });
  return roles.map((role) => ({
    name: role.name,
    keys: role.permissions.map((item) => item.permission.key).filter(isKnowledgeAdminOnlyPermission).sort(),
    users: role._count.users,
  }));
}

async function revokeForUser(user: AffectedUser): Promise<number> {
  return db.$transaction(async (tx) => {
    const deleted = await tx.userPermissionGrant.deleteMany({
      where: { id: { in: user.revokeGrantIds }, userId: user.id },
    });
    if (deleted.count === 0) return 0;
    await tx.user.update({ where: { id: user.id }, data: { authVersion: { increment: 1 } } });
    await tx.auditLog.create({
      data: {
        userName: AUDIT_ACTOR_NAME,
        action: AuditAction.PERMISSION_CHANGE,
        entityType: "User",
        entityId: user.id,
        entityRef: user.ref,
        before: { knowledgePermissions: user.knowledgeBefore },
        after: { knowledgePermissions: user.knowledgeAfter },
        meta: {
          script: SCRIPT_PATH,
          reason: "อนุมัติ/Sync/ยกเลิกเผยแพร่คลังความรู้ AI ให้เฉพาะผู้ที่มีบทบาทการใช้งาน ADMIN",
          role: user.role,
          appRole: user.appRoleName,
          revokedPermissions: user.revokeKeys,
          sessionRevoked: true,
        },
      },
      select: { id: true },
    });
    return deleted.count;
  });
}

const describeRoles = (role: string, appRoleName: string | null): string =>
  `role=${role} appRole=${appRoleName ?? "-"}`;

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const [{ affected, kept }, appRoles] = await Promise.all([scanDirectGrants(), findNonAdminAppRolesWithAdminOnlyKeys()]);

  console.log(apply ? "Mode: APPLY (writes)" : "Mode: DRY RUN (read-only, pass --apply to write)");
  console.log(`Knowledge admins keeping ${KNOWLEDGE_ADMIN_ONLY_PERMISSION_KEYS.join(" / ")}: ${kept.length}`);
  for (const user of kept) {
    console.log(`  = ${user.ref} ${describeRoles(user.role, user.appRoleName)} keep=[${user.keys.join(", ")}]`);
  }
  console.log(`Non-admin users to revoke: ${affected.length}`);
  for (const user of affected) {
    console.log(
      `  - ${user.ref} (${user.name}) ${describeRoles(user.role, user.appRoleName)} active=${user.isActive} revoke=[${user.revokeKeys.join(", ")}] keep=[${user.knowledgeAfter.join(", ")}]`,
    );
  }
  console.log(`Non-ADMIN app roles granting admin-only knowledge keys (not changed): ${appRoles.length}`);
  for (const role of appRoles) {
    console.log(`  ! ${role.name}: [${role.keys.join(", ")}] users=${role.users}`);
  }

  if (!apply || affected.length === 0) return;

  let revokedGrants = 0;
  for (const user of affected) {
    revokedGrants += await revokeForUser(user);
  }
  console.log(`Revoked ${revokedGrants} grant(s) from ${affected.length} user(s); their sessions were revoked.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
