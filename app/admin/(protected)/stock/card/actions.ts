"use server";

import { db, dbTx } from "@/lib/db";
import { requireAdmin } from "@/lib/require-auth";
import { revalidatePath } from "next/cache";
import { recalculateStockCard } from "@/lib/stock-card";

export async function recalculateAllStockCards(): Promise<{
  success?: boolean;
  count?: number;
  error?: string;
}> {
  const session = await requireAdmin().catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  // Get all products that have at least 1 stock card
  const products = await db.product.findMany({
    where: { stockCards: { some: {} } },
    select: { id: true },
  });

  if (products.length === 0) return { success: true, count: 0 };

  try {
    // Recalculate each product sequentially inside its own transaction
    for (const product of products) {
      await dbTx(async (tx) => {
        await recalculateStockCard(tx, product.id);
      });
    }

    revalidatePath("/admin/stock/card");
    return { success: true, count: products.length };
  } catch (err) {
    console.error("[recalculateAllStockCards]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
