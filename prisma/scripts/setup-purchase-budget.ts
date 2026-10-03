/**
 * Purchase budget (owner request 2026-10-03): registers purchase_budget.view and purchase_budget.manage
 * and grants both to the ADMIN role, with an AuditLog entry. Other roles get them from the role screen.
 * Safe to re-run: permissions and grants use skipDuplicates.
 *
 *   npx tsx --env-file=.env.local prisma/scripts/setup-purchase-budget.ts
 */
import { db, dbTx } from "../../lib/db";
import { PERMISSION_CATALOG } from "../../lib/access-control";
import { writeAuditLogTx } from "../../lib/audit-log";

const PERMISSION_PREFIX = "purchase_budget.";

async function registerPermissions(): Promise<{ inserted: number; granted: number; keys: string[] }> {
  return dbTx(async (tx) => {
    const catalog = PERMISSION_CATALOG.filter((permission) => permission.key.startsWith(PERMISSION_PREFIX));
    const inserted = await tx.permission.createMany({
      data: catalog.map(({ key, group, label }) => ({ key, group, label })),
      skipDuplicates: true,
    });

    const role = await tx.appRole.findUnique({ where: { name: "ADMIN" }, select: { id: true } });
    const permissions = await tx.permission.findMany({
      where: { key: { in: catalog.map((row) => row.key) } },
      select: { id: true },
    });
    const granted = role
      ? await tx.appRolePermission.createMany({
          data: permissions.map((permission) => ({ appRoleId: role.id, permissionId: permission.id })),
          skipDuplicates: true,
        })
      : { count: 0 };

    if (inserted.count || granted.count) {
      await writeAuditLogTx(tx, {
        userName: "System",
        action: "UPDATE",
        entityType: "Permission",
        entityRef: "purchase-budget",
        after: { permissions: catalog.map((row) => row.key), role: "ADMIN", inserted: inserted.count, granted: granted.count },
      });
    }
    return { inserted: inserted.count, granted: granted.count, keys: catalog.map((row) => row.key) };
  });
}

async function main(): Promise<void> {
  const result = await registerPermissions();
  console.log(JSON.stringify(result));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Setup failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
