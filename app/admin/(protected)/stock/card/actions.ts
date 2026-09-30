"use server";

import {
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { db, dbTx } from "@/lib/db";
import { AuditAction } from "@/lib/generated/prisma";
import { requirePermission } from "@/lib/require-auth";
import { revalidatePath } from "next/cache";
import { recalculateStockCardMany } from "@/lib/stock-card";

/** จำนวนสินค้าต่อ 1 transaction ตอนคำนวณสต็อกการ์ดใหม่ทั้งระบบ */
const RECALCULATE_BATCH_SIZE = 100;
/** Failed product codes listed in the user-facing summary; the rest are counted. */
const MAX_FAILED_CODES_IN_MESSAGE = 20;

type RecalculateProduct = { id: string; code: string };

async function recalculateInOwnTransaction(productIds: string[]): Promise<void> {
  try {
    await dbTx(async (tx) => {
      await recalculateStockCardMany(tx, productIds);
    });
  } catch (error) {
    console.error("[recalculateAllStockCards] transaction failed", { productIds }, error);
    throw error;
  }
}

/**
 * Recalculate one batch in a single transaction. If it fails (e.g. a DN replay on a SKU whose stock
 * went non-positive), the whole batch rolled back, so retry each product in its own transaction and
 * return only the products that still fail — one bad SKU no longer stops the rest of the run.
 */
async function recalculateBatch(batch: RecalculateProduct[]): Promise<RecalculateProduct[]> {
  try {
    await recalculateInOwnTransaction(batch.map((product) => product.id));
    return [];
  } catch {
    const failed: RecalculateProduct[] = [];
    for (const product of batch) {
      try {
        await recalculateInOwnTransaction([product.id]);
      } catch {
        console.error("[recalculateAllStockCards] product failed", { productId: product.id, code: product.code });
        failed.push(product);
      }
    }
    return failed;
  }
}

function describeFailedProducts(failed: RecalculateProduct[]): string {
  const listed = failed.slice(0, MAX_FAILED_CODES_IN_MESSAGE).map((product) => product.code).join(", ");
  const more = failed.length > MAX_FAILED_CODES_IN_MESSAGE ? ` และอีก ${failed.length - MAX_FAILED_CODES_IN_MESSAGE} รายการ` : "";
  return `คำนวณไม่สำเร็จ ${failed.length} สินค้า: ${listed}${more} กรุณาตรวจสอบสต็อกการ์ดของสินค้าเหล่านี้`;
}

export async function recalculateAllStockCards(): Promise<{
  success?: boolean;
  count?: number;
  error?: string;
}> {
  const session = await requirePermission("stock.card.manage").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  try {
    const requestContext = await getRequestContext();

    // Get all products that have at least 1 stock card
    const products: RecalculateProduct[] = await db.product.findMany({
      where: { stockCards: { some: {} } },
      select: { id: true, code: true },
    });

    if (products.length === 0) return { success: true, count: 0 };

    // Recalculate in batches: recalculateStockCardMany() is the batched
    // equivalent of looping recalculateStockCard() (same MAVG engine, identical
    // result) but uses a constant number of round-trips per batch instead of
    // ~4 per product — 900+ products drop from ~900 transactions to ~9.
    // Batches stay bounded so a single transaction never holds the Supabase
    // pooler connection longer than necessary.
    const failed: RecalculateProduct[] = [];
    for (let i = 0; i < products.length; i += RECALCULATE_BATCH_SIZE) {
      failed.push(...await recalculateBatch(products.slice(i, i + RECALCULATE_BATCH_SIZE)));
    }
    const recalculatedCount = products.length - failed.length;

    if (recalculatedCount > 0) {
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.RECALCULATE,
        entityType: "StockCard",
        entityId: "all-products",
        entityRef: `products:${products.length}`,
        meta: {
          productCount: products.length,
          productIds: products.map((product) => product.id),
          recalculatedCount,
          failedProductIds: failed.map((product) => product.id),
        },
      });
      revalidatePath("/admin/stock/card");
    }

    if (failed.length > 0) {
      // count stays undefined when nothing succeeded so the button shows no success badge.
      return { success: false, count: recalculatedCount > 0 ? recalculatedCount : undefined, error: describeFailedProducts(failed) };
    }
    return { success: true, count: products.length };
  } catch (err) {
    console.error("[recalculateAllStockCards]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
