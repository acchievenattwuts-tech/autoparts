/** Run after sales-quotation-schema.sql: registers only SQ permissions. */
import { db, dbTx } from "../../lib/db";
import { PERMISSION_CATALOG } from "../../lib/access-control";
import { writeAuditLogTx } from "../../lib/audit-log";

async function main() {
  const catalog = PERMISSION_CATALOG.filter((permission) => permission.key.startsWith("sales_quotations."));
  await dbTx(async (tx) => {
    const inserted = await tx.permission.createMany({ data: catalog.map(({ key, group, label }) => ({ key, group, label })), skipDuplicates: true });
    const role = await tx.appRole.findUnique({ where: { name: "ADMIN" }, select: { id: true } });
    const permissions = await tx.permission.findMany({ where: { key: { in: catalog.map((row) => row.key) } }, select: { id: true } });
    const granted = role ? await tx.appRolePermission.createMany({ data: permissions.map((permission) => ({ appRoleId: role.id, permissionId: permission.id })), skipDuplicates: true }) : { count: 0 };
    if (inserted.count || granted.count) await writeAuditLogTx(tx, { userName: "System", action: "UPDATE", entityType: "Permission", entityRef: "sales_quotations", after: { permissions: catalog.map((row) => row.key), role: "ADMIN", inserted: inserted.count, granted: granted.count } });
    console.log(JSON.stringify({ permissions: permissions.length, inserted: inserted.count, granted: granted.count }));
  });
  const indexes = await db.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE indexname IN ('idx_knowledge_documents_search_document', 'idx_knowledge_documents_search_text_trgm', 'idx_product_search_documents_keyword_trgm', 'idx_product_search_documents_oem_trgm', 'idx_psd_embedding_hnsw', 'Sale_activeQuotationId_key')`;
  const columns = await db.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'product_search_documents' AND column_name = 'trgm_text'`;
  console.log(JSON.stringify({ quotationCount: await db.salesQuotation.count(), verifiedIndexes: indexes.map((row) => row.indexname), searchColumnPreserved: columns.length === 1 }));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Setup failed"); process.exitCode = 1; }).finally(() => db.$disconnect());
