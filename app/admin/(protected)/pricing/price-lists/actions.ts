"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuditAction, SaleChannel } from "@/lib/generated/prisma";
import { db, dbTx } from "@/lib/db";
import { getAuditActorFromSession, getRequestContext, safeWriteAuditLog } from "@/lib/audit-log";
import { requirePermission } from "@/lib/require-auth";
import { parsePriceImportCsv } from "@/lib/pricing/price-import";
import { isLegacyFieldPriceListCode } from "@/lib/pricing/price-lists";

const priceListSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,30}$/, "รหัสใช้ A-Z, 0-9 และ _ เท่านั้น"),
  name: z.string().trim().min(1, "กรุณากรอกชื่อ").max(100),
  channel: z.enum(["SHOPEE", "LAZADA"]).nullable(),
  sortOrder: z.coerce.number().int().min(0).max(9999),
});

const parseForm = (formData: FormData) =>
  priceListSchema.safeParse({
    code: formData.get("code"),
    name: formData.get("name"),
    channel: formData.get("channel") || null,
    sortOrder: formData.get("sortOrder") ?? 0,
  });

export async function createPriceList(formData: FormData): Promise<{ error?: string }> {
  const session = await requirePermission("price_lists.create").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };
  const parsed = parseForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const created = await db.priceList.create({
      data: {
        ...parsed.data,
        channel: parsed.data.channel as SaleChannel | null,
        isSystem: false,
      },
    });
    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...(await getRequestContext()),
      action: AuditAction.CREATE,
      entityType: "PriceList",
      entityId: created.id,
      entityRef: created.code,
      after: created,
    });
    revalidatePath("/admin/pricing/price-lists");
    return {};
  } catch {
    return { error: "รหัส ชื่อ หรือช่องทางนี้มีระดับราคาอยู่แล้ว" };
  }
}

export async function setPriceListActive(id: string, isActive: boolean): Promise<{ error?: string }> {
  const session = await requirePermission(isActive ? "price_lists.update" : "price_lists.cancel").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };
  // Guard and write share one transaction: a Customer Type pointed at a
  // deactivated Price List silently falls back to the legacy tier at sale time,
  // so the reference must be gone before the row can be closed. Inactive Customer
  // Types count too — reopening one would resurrect that dangling reference.
  const outcome = await dbTx(async (tx) => {
    const current = await tx.priceList.findUnique({
      where: { id },
      select: { id: true, code: true, isSystem: true, isActive: true },
    });
    if (!current) return { error: "ไม่พบระดับราคา" as const };
    if (current.isSystem && !isActive) return { error: "ระดับราคาระบบไม่สามารถปิดใช้งานได้" as const };
    if (!isActive) {
      const [customerTypeCount, promotionCount] = await Promise.all([
        tx.customerType.count({ where: { priceListId: id } }),
        tx.pricePromotion.count({ where: { priceListId: id, status: { not: "CANCELLED" } } }),
      ]);
      if (customerTypeCount > 0 || promotionCount > 0) {
        return {
          error:
            "ยังมีประเภทลูกค้าหรือโปรโมชั่นที่อ้างอิงระดับราคานี้ กรุณาย้ายประเภทลูกค้าไประดับราคาอื่นและยกเลิกโปรโมชั่นก่อน" as const,
        };
      }
    }
    return { current, updated: await tx.priceList.update({ where: { id }, data: { isActive } }) };
  }).catch((error: unknown) => {
    console.error("setPriceListActive failed", error);
    return { error: "เปลี่ยนสถานะระดับราคาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" as const };
  });
  if ("error" in outcome) return { error: outcome.error };
  const { current, updated } = outcome;
  await safeWriteAuditLog({
    ...getAuditActorFromSession(session),
    ...(await getRequestContext()),
    action: isActive ? AuditAction.UPDATE : AuditAction.CANCEL,
    entityType: "PriceList",
    entityId: updated.id,
    entityRef: updated.code,
    before: current,
    after: updated,
    meta: { isActive },
  });
  revalidatePath("/admin/pricing/price-lists");
  return {};
}

export async function updatePriceList(
  id: string,
  input: { name: string; sortOrder: number },
): Promise<{ error?: string }> {
  const session = await requirePermission("price_lists.update").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };
  const parsed = z.object({ name: z.string().trim().min(1).max(100), sortOrder: z.number().int().min(0).max(9999) }).safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const current = await db.priceList.findUnique({ where: { id } });
  if (!current) return { error: "ไม่พบระดับราคา" };
  try {
    const updated = await db.priceList.update({ where: { id }, data: parsed.data });
    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...(await getRequestContext()),
      action: AuditAction.UPDATE,
      entityType: "PriceList",
      entityId: updated.id,
      entityRef: updated.code,
      before: current,
      after: updated,
    });
    revalidatePath("/admin/pricing/price-lists");
    return {};
  } catch {
    return { error: "ชื่อระดับราคานี้ถูกใช้แล้ว" };
  }
}

type PriceImportPreview = {
  rowCount: number;
  createCount: number;
  updateCount: number;
  unchangedCount: number;
  missingProductCodes: string[];
  errors: string[];
  totalActiveProducts: number;
  coveredAfterImport: number;
};

const emptyPreview = (errors: string[], rowCount = 0): PriceImportPreview => ({
  rowCount, createCount: 0, updateCount: 0, unchangedCount: 0,
  missingProductCodes: [], errors, totalActiveProducts: 0, coveredAfterImport: 0,
});

/** Amounts for these codes are rewritten from the Product columns on every product
 *  save, so importing into them would be reverted without warning. */
const LEGACY_IMPORT_BLOCKED_MESSAGE =
  "ระดับราคาขายส่ง / สมาชิก / ขายปลีก แก้ราคาได้จากหน้าสินค้าเท่านั้น ไม่รองรับการนำเข้า CSV";

async function buildPriceImportPreview(priceListId: string, csv: string): Promise<PriceImportPreview> {
  const parsed = parsePriceImportCsv(csv);
  const priceList = await db.priceList.findFirst({ where: { id: priceListId, isActive: true }, select: { id: true, code: true } });
  if (!priceList) return emptyPreview(["ระดับราคาไม่ได้เปิดใช้งาน"]);
  if (isLegacyFieldPriceListCode(priceList.code)) return emptyPreview([LEGACY_IMPORT_BLOCKED_MESSAGE]);
  if (parsed.errors.length > 0) return emptyPreview(parsed.errors, parsed.rows.length);

  const normalizedCodes = parsed.rows.map((row) => row.productCode.toLocaleUpperCase("en-US"));
  const [products, currentPrices, totalActiveProducts, currentCoverage] = await Promise.all([
    db.product.findMany({ where: { code: { in: parsed.rows.map((row) => row.productCode), mode: "insensitive" } }, select: { id: true, code: true, isActive: true } }),
    db.productPrice.findMany({ where: { priceListId, product: { code: { in: parsed.rows.map((row) => row.productCode), mode: "insensitive" } } }, select: { productId: true, amount: true } }),
    db.product.count({ where: { isActive: true } }),
    db.productPrice.count({ where: { priceListId, product: { isActive: true } } }),
  ]);
  const productByCode = new Map(products.map((product) => [product.code.toLocaleUpperCase("en-US"), product]));
  const currentByProduct = new Map(currentPrices.map((price) => [price.productId, Number(price.amount)]));
  const missingProductCodes = parsed.rows.filter((row) => !productByCode.has(row.productCode.toLocaleUpperCase("en-US"))).map((row) => row.productCode);
  let createCount = 0;
  let updateCount = 0;
  let unchangedCount = 0;
  let activeCreateCount = 0;
  for (let index = 0; index < normalizedCodes.length; index += 1) {
    const product = productByCode.get(normalizedCodes[index]);
    if (!product) continue;
    const current = currentByProduct.get(product.id);
    if (current === undefined) {
      createCount += 1;
      if (product.isActive) activeCreateCount += 1;
    }
    else if (current === parsed.rows[index].amount) unchangedCount += 1;
    else updateCount += 1;
  }
  return {
    rowCount: parsed.rows.length,
    createCount,
    updateCount,
    unchangedCount,
    missingProductCodes,
    errors: missingProductCodes.length > 0 ? [`ไม่พบรหัสสินค้า ${missingProductCodes.length} รายการ`] : [],
    totalActiveProducts,
    coveredAfterImport: Math.min(totalActiveProducts, currentCoverage + activeCreateCount),
  };
}

export async function previewPriceImport(priceListId: string, csv: string): Promise<PriceImportPreview> {
  const session = await requirePermission("price_lists.update").catch(() => null);
  if (!session?.user?.id) return emptyPreview(["ไม่มีสิทธิ์เข้าถึง"]);
  if (csv.length > 2_000_000) return emptyPreview(["ไฟล์ใหญ่เกิน 2 MB"]);
  return buildPriceImportPreview(priceListId, csv);
}

export async function applyPriceImport(priceListId: string, csv: string): Promise<{ error?: string; updatedCount?: number }> {
  const session = await requirePermission("price_lists.update").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };
  if (csv.length > 2_000_000) return { error: "ไฟล์ใหญ่เกิน 2 MB" };
  const preview = await buildPriceImportPreview(priceListId, csv);
  if (preview.errors.length > 0) return { error: preview.errors.join("; ") };
  const parsed = parsePriceImportCsv(csv);
  let result: { code: string; count: number; created: number; updated: number; unchanged: number } | null = null;
  try {
    result = await dbTx(async (tx) => {
      const priceList = await tx.priceList.findFirst({ where: { id: priceListId, isActive: true }, select: { id: true, code: true } });
      if (!priceList) throw new Error("PRICE_LIST_NOT_ACTIVE");
      if (isLegacyFieldPriceListCode(priceList.code)) throw new Error("LEGACY_PRICE_LIST");
      const products = await tx.product.findMany({ where: { code: { in: parsed.rows.map((row) => row.productCode), mode: "insensitive" } }, select: { id: true, code: true } });
      const productByCode = new Map(products.map((product) => [product.code.toLocaleUpperCase("en-US"), product]));
      if (products.length !== parsed.rows.length) throw new Error("PRODUCT_SET_CHANGED");

      // Split the file against the rows that already exist so a full re-import
      // costs one createMany plus one update per genuinely changed price, instead
      // of one upsert round trip per line held open inside the transaction.
      const targets = parsed.rows.map((row) => {
        const product = productByCode.get(row.productCode.toLocaleUpperCase("en-US"));
        if (!product) throw new Error("PRODUCT_SET_CHANGED");
        return { productId: product.id, amount: row.amount };
      });
      const existing = await tx.productPrice.findMany({
        where: { priceListId, productId: { in: targets.map((target) => target.productId) } },
        select: { productId: true, amount: true },
      });
      const existingByProduct = new Map(existing.map((row) => [row.productId, Number(row.amount)]));

      const toCreate = targets.filter((target) => !existingByProduct.has(target.productId));
      const toUpdate = targets.filter((target) => {
        const current = existingByProduct.get(target.productId);
        return current !== undefined && current !== target.amount;
      });

      if (toCreate.length > 0) {
        await tx.productPrice.createMany({
          data: toCreate.map((target) => ({ productId: target.productId, priceListId, amount: target.amount })),
        });
      }
      for (const target of toUpdate) {
        await tx.productPrice.update({
          where: { productId_priceListId: { productId: target.productId, priceListId } },
          data: { amount: target.amount },
        });
      }
      return {
        code: priceList.code,
        count: parsed.rows.length,
        created: toCreate.length,
        updated: toUpdate.length,
        unchanged: targets.length - toCreate.length - toUpdate.length,
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "LEGACY_PRICE_LIST") return { error: LEGACY_IMPORT_BLOCKED_MESSAGE };
    if (message === "PRICE_LIST_NOT_ACTIVE" || message === "PRODUCT_SET_CHANGED") {
      return { error: "ข้อมูลเปลี่ยนหลัง preview กรุณาตรวจไฟล์ใหม่อีกครั้ง" };
    }
    console.error("applyPriceImport failed", error);
    return { error: "นำเข้าราคาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  if (!result) return { error: "ข้อมูลเปลี่ยนหลัง preview กรุณาตรวจไฟล์ใหม่อีกครั้ง" };
  await safeWriteAuditLog({
    ...getAuditActorFromSession(session),
    ...(await getRequestContext()),
    action: AuditAction.UPDATE,
    entityType: "ProductPrice",
    entityId: priceListId,
    entityRef: result.code,
    meta: {
      event: "BULK_IMPORT",
      rowCount: result.count,
      createdCount: result.created,
      updatedCount: result.updated,
      unchangedCount: result.unchanged,
    },
  });
  revalidatePath("/admin/pricing/price-lists");
  revalidatePath("/admin/products");
  return { updatedCount: result.count };
}
