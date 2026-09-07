import { Prisma } from "@/lib/generated/prisma";
import { writeAuditLogTx, type AuditLogActor } from "@/lib/audit-log";
export { quotationSchema, quotationTotals } from "./sales-quotation-form";
export type { QuotationInput, QuotationData } from "./sales-quotation-form";

export class QuotationError extends Error {
  constructor(message: string, public references: { href: string; label: string }[] = []) { super(message); }
}

/** Shared by SQ edits and sale reference changes; locks precede every mutation. */
export async function lockQuotation(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "SalesQuotation" WHERE id = ${id} FOR UPDATE`);
}

export async function assertQuotationAvailable(tx: Prisma.TransactionClient, id: string, saleId?: string) {
  await lockQuotation(tx, id);
  const quote = await tx.salesQuotation.findUnique({ where: { id }, select: {
    id: true, status: true, activeSale: { select: { id: true, saleNo: true } },
  } });
  if (!quote || quote.status !== "ACTIVE") throw new QuotationError("ไม่พบใบเสนอราคาที่ใช้งานได้");
  if (quote.activeSale && quote.activeSale.id !== saleId) throw new QuotationError(`ใบเสนอราคาถูกใช้ในใบขาย ${quote.activeSale.saleNo} แล้ว`, [{ href: `/admin/sales/${quote.activeSale.id}`, label: quote.activeSale.saleNo }]);
}

export { generateSalesQuotationNo as generateQuotationNo } from "./doc-number";

export async function prepareSaleQuotationReference(tx: Prisma.TransactionClient, saleId: string | null, quotationId: string | null, expectedUpdatedAt?: Date) {
  if (saleId) await tx.$queryRaw(Prisma.sql`SELECT id FROM "Sale" WHERE id = ${saleId} FOR UPDATE`);
  const sale = saleId ? await tx.sale.findUnique({ where: { id: saleId }, select: { quotationId: true, status: true, updatedAt: true } }) : null;
  if (saleId && (!sale || sale.status !== "ACTIVE")) throw new QuotationError("ใบขายไม่อยู่ในสถานะที่แก้ไขได้");
  if (expectedUpdatedAt && sale?.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new QuotationError("ใบขายถูกแก้ไขระหว่างดำเนินการ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง");
  const ids = [...new Set([sale?.quotationId, quotationId].filter((id): id is string => !!id))].sort();
  for (const id of ids) await lockQuotation(tx, id);
  if (quotationId) await assertQuotationAvailable(tx, quotationId, saleId ?? undefined);
  return sale?.quotationId ?? null;
}

export async function auditSaleQuotationReference(tx: Prisma.TransactionClient, actor: AuditLogActor, saleId: string, saleNo: string, previous: string | null, next: string | null, cancelled = false) {
  if (previous === next && !cancelled) return;
  for (const id of [...new Set([previous, next].filter((value): value is string => !!value))]) {
    const quote = await tx.salesQuotation.findUnique({ where: { id }, select: { quotationNo: true } });
    await writeAuditLogTx(tx, { ...actor, action: "UPDATE", entityType: "SalesQuotation", entityId: id, entityRef: quote?.quotationNo,
      meta: { summary: cancelled ? `ปลดล็อก: ใบขาย ${saleNo} ถูกยกเลิก` : next === id ? `อ้างอิงโดยใบขาย ${saleNo}` : `ถอดการอ้างอิงจากใบขาย ${saleNo}`, saleId, saleNo, previous, next } });
  }
}
