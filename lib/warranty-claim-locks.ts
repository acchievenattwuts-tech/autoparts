import { Prisma } from "@/lib/generated/prisma";

/**
 * Row locks shared by the claim, warranty and sale flows. Lock order is always
 * Sale → Warranty, so createClaim (sale claim), cancelClaim (sale claim) and
 * updateSale / cancelSale — which lock the Sale row first via
 * prepareSaleQuotationReference — serialize instead of racing.
 */
export async function lockSaleRowForClaim(
  tx: Prisma.TransactionClient,
  saleId: string,
): Promise<void> {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "Sale" WHERE id = ${saleId} FOR UPDATE`);
}

export async function lockWarrantyRow(
  tx: Prisma.TransactionClient,
  warrantyId: string,
): Promise<void> {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "Warranty" WHERE id = ${warrantyId} FOR UPDATE`);
}
