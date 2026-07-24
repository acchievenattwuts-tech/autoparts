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

export async function recalculateAllStockCards(): Promise<{
  success?: boolean;
  count?: number;
  error?: string;
}> {
  const session = await requirePermission("stock.card.manage").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const requestContext = await getRequestContext();

  // Get all products that have at least 1 stock card
  const products = await db.product.findMany({
    where: { stockCards: { some: {} } },
    select: { id: true },
  });

  if (products.length === 0) return { success: true, count: 0 };

  try {
    // Recalculate in batches: recalculateStockCardMany() is the batched
    // equivalent of looping recalculateStockCard() (same MAVG engine, identical
    // result) but uses a constant number of round-trips per batch instead of
    // ~4 per product — 900+ products drop from ~900 transactions to ~9.
    // Batches stay bounded so a single transaction never holds the Supabase
    // pooler connection longer than necessary.
    for (let i = 0; i < products.length; i += RECALCULATE_BATCH_SIZE) {
      const batch = products.slice(i, i + RECALCULATE_BATCH_SIZE);
      await dbTx(async (tx) => {
        await recalculateStockCardMany(tx, batch.map((product) => product.id));
      });
    }

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
      },
    });

    revalidatePath("/admin/stock/card");
    return { success: true, count: products.length };
  } catch (err) {
    console.error("[recalculateAllStockCards]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
