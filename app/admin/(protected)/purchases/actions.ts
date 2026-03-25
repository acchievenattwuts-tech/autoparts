"use server";

import { db } from "@/lib/db";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeStockCard } from "@/lib/stock-card";
import { generateDocNo } from "@/lib/doc-number";

const purchaseItemSchema = z.object({
  productId:   z.string().min(1).max(50),
  unitName:    z.string().min(1).max(20),
  qty:         z.coerce.number().positive("จำนวนต้องมากกว่า 0"),
  costPrice:   z.coerce.number().min(0, "ราคาต้องไม่ติดลบ"),   // per selected unit
  landedCost:  z.coerce.number().min(0).default(0),             // per selected unit
});

const purchaseSchema = z.object({
  supplierId:   z.string().max(50).optional(),
  purchaseDate: z.string().min(1),
  discount:     z.coerce.number().min(0).default(0),
  note:         z.string().max(500).optional(),
  items:        z.array(purchaseItemSchema).min(1, "ต้องมีรายการสินค้าอย่างน้อย 1 รายการ").max(100),
});

export async function createPurchase(
  formData: FormData
): Promise<{ success?: boolean; purchaseNo?: string; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  let items: z.infer<typeof purchaseItemSchema>[] = [];
  try {
    const raw = formData.get("items");
    if (typeof raw === "string") items = JSON.parse(raw);
  } catch { return { error: "รูปแบบข้อมูลรายการไม่ถูกต้อง" }; }

  const parsed = purchaseSchema.safeParse({
    supplierId:   formData.get("supplierId") || undefined,
    purchaseDate: formData.get("purchaseDate"),
    discount:     formData.get("discount") || 0,
    note:         formData.get("note") || undefined,
    items,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { supplierId, purchaseDate, discount, note, items: validItems } = parsed.data;

  // Calculate totals
  const totalAmount = validItems.reduce((sum, item) => sum + item.qty * item.costPrice, 0);
  const netAmount   = Math.max(0, totalAmount - discount);

  const purchaseNo = await generateDocNo("PO", new Date(purchaseDate));

  try {
    await db.$transaction(async (tx) => {
      // 1. Create Purchase header
      const purchase = await tx.purchase.create({
        data: {
          purchaseNo,
          supplierId:   supplierId || null,
          userId:       session.user!.id!,
          totalAmount:  totalAmount,
          discount:     discount,
          netAmount:    netAmount,
          note,
          purchaseDate: new Date(purchaseDate),
        },
      });

      // 2. Process each line item
      for (const item of validItems) {
        // Get unit scale
        const unit = await tx.productUnit.findUnique({
          where: { productId_name: { productId: item.productId, name: item.unitName } },
        });
        if (!unit) throw new Error(`ไม่พบหน่วยนับ ${item.unitName} ของสินค้า`);

        const scale       = Number(unit.scale);
        const qtyInBase   = item.qty * scale;
        const costPerBase = item.costPrice / scale;  // convert to base unit cost
        const lcPerBase   = item.landedCost / scale;  // landed cost per base unit

        // Create PurchaseItem
        const purchaseItem = await tx.purchaseItem.create({
          data: {
            purchaseId:  purchase.id,
            productId:   item.productId,
            supplierId:  supplierId || null,
            quantity:    Math.round(qtyInBase),
            costPrice:   costPerBase,
            totalAmount: item.qty * item.costPrice,
            landedCost:  item.landedCost,
          },
        });

        // 3. Write StockCard with MAVG
        await writeStockCard(tx, {
          productId:   item.productId,
          docNo:       purchaseNo,
          docDate:     new Date(purchaseDate),
          source:      "PURCHASE",
          qtyIn:       qtyInBase,
          qtyOut:      0,
          priceIn:     costPerBase,
          landedCost:  lcPerBase * qtyInBase, // total landed cost for this line
          detail:      `ซื้อเข้า ${item.qty} ${item.unitName}`,
          referenceId: purchaseItem.id,
        });
      }
    });

    revalidatePath("/admin/purchases");
    revalidatePath("/admin/products");
    return { success: true, purchaseNo };
  } catch (err) {
    console.error("[createPurchase]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
