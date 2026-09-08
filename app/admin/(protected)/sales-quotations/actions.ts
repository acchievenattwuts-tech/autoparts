"use server";
import { quotationProductOption } from "@/lib/quotation-product";
import { quotationToFormData } from "@/lib/sales-quotation-data";
import { quotationFingerprint, formatQuotationReference } from "@/lib/sales-quotation-form";
import { revalidatePath } from "next/cache";
import { db, dbTx } from "@/lib/db";
import { requireAnyPermission, requirePermission } from "@/lib/require-auth";
import { getAuditActorFromSession, getRequestContext, writeAuditLogTx } from "@/lib/audit-log";
import { quotationSchema, quotationTotals, generateQuotationNo, assertQuotationAvailable, QuotationError, type QuotationInput } from "@/lib/sales-quotation";
import { parseDateOnlyToDate, formatDateOnlyForInput } from "@/lib/th-date";
import { searchTransactionProductDetailRows } from "@/lib/transaction-product-search";
import { getSaleProductOptionsByIds } from "@/lib/transaction-options";

export async function searchQuotationProducts(query: string) {
  await requireAnyPermission(["sales_quotations.create", "sales_quotations.update"]);
  const rows = await searchTransactionProductDetailRows(query);
  return rows.map(quotationProductOption);
}

export async function saveQuotation(input: QuotationInput, id?: string, expectedRevision?: number) {
  const session = await requirePermission(id ? "sales_quotations.update" : "sales_quotations.create").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์บันทึกใบเสนอราคา" };
  const parsed = quotationSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  try {
    const data = parsed.data;
    const context = await getRequestContext();
    const result = await dbTx(async (tx) => {
      if (id) await assertQuotationAvailable(tx, id);
      const before = id ? await tx.salesQuotation.findUnique({ where: { id }, include: { items: { include: { product: { select: { code: true, name: true } } } } } }) : null;
      if (before && before.revision !== expectedRevision) throw new QuotationError("ใบเสนอราคามี Revision ใหม่แล้ว กรุณาโหลดหน้าใหม่ก่อนแก้ไข");
      if (before && quotationFingerprint(data) === quotationFingerprint(quotationToFormData(before))) return { id: before.id, quotationNo: formatQuotationReference(before.quotationNo, before.revision) };
      const customer = await tx.customer.findUnique({ where: { id: data.customerId }, select: { isActive: true } });
      if (!customer || (!customer.isActive && before?.customerId !== data.customerId)) throw new QuotationError("ลูกค้าที่เลือกไม่พร้อมใช้งาน");
      const products = await tx.product.findMany({ where: { id: { in: data.items.map((row) => row.productId) } }, select: { id: true, code: true, name: true, isActive: true, units: { select: { name: true, scale: true } } } });
      const items = data.items.map((row, lineNo) => {
        const product = products.find((candidate) => candidate.id === row.productId);
        const unit = product?.units.find((candidate) => candidate.name === row.unitName);
        if (!product || (!product.isActive && !before?.items.some((item) => item.productId === row.productId)) || !unit) throw new QuotationError("สินค้า/หน่วยที่เลือกไม่พร้อมใช้งาน");
        const unitListPrice = Math.max(row.unitListPrice, row.salePrice);
        return { lineNo, productId: row.productId, quantity: row.qty * Number(unit.scale), showQty: row.qty,
          showUnitName: row.unitName, unitScale: unit.scale, salePrice: row.salePrice, unitListPrice,
          lineDiscount: Math.round((unitListPrice - row.salePrice) * row.qty * 100) / 100,
          totalAmount: Math.round(row.qty * row.salePrice * 100) / 100, moreDetail: row.moreDetail,
          priceListId: row.priceListId ?? null, pricePromotionId: row.pricePromotionId ?? null,
          priceSource: "MANUAL" as const };
      });
      const { items: _items, quotationDate: date, ...header } = data;
      void _items;
      const quotationDate = parseDateOnlyToDate(date);
      const values = { ...header, quotationDate, ...quotationTotals(data), updatedById: session.user.id, updatedByName: session.user.name ?? "-" };
      const quote = id
        ? await tx.salesQuotation.update({ where: { id }, data: { ...values, revision: { increment: 1 }, items: { deleteMany: {}, create: items } } })
        : await tx.salesQuotation.create({ data: { ...values, quotationNo: await generateQuotationNo(tx, quotationDate), createdById: session.user.id, items: { create: items } } });
      const auditItems = items.map((item) => ({ ...item, product: products.find((row) => row.id === item.productId) }));
      await writeAuditLogTx(tx, { ...getAuditActorFromSession(session), ...context, action: id ? "UPDATE" : "CREATE", entityType: "SalesQuotation", entityId: quote.id, entityRef: formatQuotationReference(quote.quotationNo, quote.revision), before, after: { ...quote, items: auditItems }, meta: { revision: quote.revision, previousRevision: before?.revision ?? null } });
      return { id: quote.id, quotationNo: formatQuotationReference(quote.quotationNo, quote.revision) };
    });
    revalidatePath("/admin/sales-quotations");
    revalidatePath(`/admin/sales-quotations/${result.id}`);
    revalidatePath("/admin/sales");
    return result;
  } catch (error) {
    // QuotationError is expected control flow (referenced/cancelled documents);
    // anything else is a real failure the generic Thai message would otherwise hide.
    if (!(error instanceof QuotationError)) console.error("[saveQuotation]", error);
    return { error: error instanceof QuotationError ? error.message : "บันทึกใบเสนอราคาไม่สำเร็จ กรุณาลองอีกครั้ง", references: error instanceof QuotationError ? error.references : [] };
  }
}

export async function cancelQuotation(id: string, note: string) {
  const session = await requirePermission("sales_quotations.cancel").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์ยกเลิกใบเสนอราคา" };
  if (!id || typeof note !== "string" || note.length > 2000) return { error: "ข้อมูลไม่ถูกต้อง" };
  try {
    const context = await getRequestContext();
    await dbTx(async (tx) => {
      await assertQuotationAvailable(tx, id);
      const before = await tx.salesQuotation.findUnique({ where: { id } });
      const after = await tx.salesQuotation.update({ where: { id }, data: { status: "CANCELLED", cancelNote: note, cancelledAt: new Date(), updatedById: session.user.id, updatedByName: session.user.name ?? "-" } });
      await writeAuditLogTx(tx, { ...getAuditActorFromSession(session), ...context, action: "CANCEL", entityType: "SalesQuotation", entityId: id, entityRef: after.quotationNo, before, after });
    });
    revalidatePath("/admin/sales-quotations");
    revalidatePath(`/admin/sales-quotations/${id}`);
    return { success: true };
  } catch (error) {
    if (!(error instanceof QuotationError)) console.error("[cancelQuotation]", error);
    return { error: error instanceof QuotationError ? error.message : "ยกเลิกไม่สำเร็จ กรุณาลองอีกครั้ง", references: error instanceof QuotationError ? error.references : [] };
  }
}

export async function searchAvailableQuotations(query: string, currentSaleId?: string) {
  await requireAnyPermission(["sales.create", "sales.update"]);
  await requirePermission("sales_quotations.view");
  const rows = await db.salesQuotation.findMany({ where: { status: "ACTIVE", OR: [{ activeSale: null }, ...(currentSaleId ? [{ activeSale: { id: currentSaleId } }] : [])],
    AND: [{ OR: [{ quotationNo: { contains: query, mode: "insensitive" } }, { customerName: { contains: query, mode: "insensitive" } }] }] },
    select: { id: true, quotationNo: true, revision: true, customerName: true, quotationDate: true, netAmount: true }, orderBy: { quotationDate: "desc" }, take: 50 });
  // Decimal ส่งข้าม client boundary ไม่ได้ — แปลงเป็น number ตั้งแต่ฝั่ง server
  return rows.map((row) => ({ ...row, netAmount: Number(row.netAmount) }));
}

export async function loadQuotationForSale(id: string, currentSaleId?: string) {
  await requireAnyPermission(["sales.create", "sales.update"]);
  await requirePermission("sales_quotations.view");
  const quote = await db.salesQuotation.findUnique({ where: { id }, include: { activeSale: { select: { id: true } }, items: { orderBy: { lineNo: "asc" } } } });
  if (!quote || quote.status !== "ACTIVE" || (quote.activeSale && quote.activeSale.id !== currentSaleId)) return { error: "ใบเสนอราคานี้ไม่พร้อมให้อ้างอิง" };
  const products = await getSaleProductOptionsByIds(quote.items.map((item) => item.productId));
  return { quotationNo: formatQuotationReference(quote.quotationNo, quote.revision), products, data: {
    customerId: quote.customerId, customerName: quote.customerName, customerPhone: quote.customerPhone ?? "",
    shippingAddress: quote.customerAddress ?? "", creditTerm: quote.creditTerm, discount: Number(quote.discount),
    vatType: quote.vatType, vatRate: Number(quote.vatRate), note: quote.note ?? "", saleType: quote.saleType,
    quotationDate: formatDateOnlyForInput(quote.quotationDate),
    items: quote.items.map((item) => { const product = products.find((row) => row.id === item.productId);
      // SQ ไม่มีช่องเลือกผู้จำหน่าย — ดึง preferred supplier เหมือนตอนเลือกสินค้าในหน้าขายปกติ
      return { productId: item.productId, unitName: item.showUnitName, qty: Number(item.showQty), salePrice: Number(item.salePrice), unitListPrice: Number(item.unitListPrice), lineDiscount: Number(item.lineDiscount), moreDetail: item.moreDetail ?? "", warrantyDays: product?.warrantyDays ?? 0, supplierId: product?.preferredSupplierId ?? "", supplierName: product?.preferredSupplierName ?? "", lotItems: [] }; }),
  } };
}
