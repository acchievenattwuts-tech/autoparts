"use server";

import { db } from "@/lib/db";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeStockCard } from "@/lib/stock-card";
import { generateDocNo } from "@/lib/doc-number";
import { CNSettlementType, CreditNoteType } from "@/lib/generated/prisma";

const cnItemSchema = z.object({
  productId: z.string().min(1).max(50),
  unitName:  z.string().min(1).max(20),
  qty:       z.coerce.number().positive("จำนวนต้องมากกว่า 0"),
  salePrice: z.coerce.number().min(0, "ราคาต้องไม่ติดลบ"),
});

const cnSchema = z.object({
  cnDate:         z.string().min(1, "กรุณาระบุวันที่"),
  saleId:         z.string().max(50).optional(),
  type:           z.nativeEnum(CreditNoteType),
  settlementType: z.nativeEnum(CNSettlementType).default(CNSettlementType.CASH_REFUND),
  note:           z.string().max(500).optional(),
  items:          z.array(cnItemSchema).min(1, "ต้องมีรายการสินค้าอย่างน้อย 1 รายการ").max(100),
});

export async function createCreditNote(
  formData: FormData
): Promise<{ success?: boolean; cnNo?: string; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  let items: z.infer<typeof cnItemSchema>[] = [];
  try {
    const raw = formData.get("items");
    if (typeof raw === "string") items = JSON.parse(raw);
  } catch {
    return { error: "รูปแบบข้อมูลรายการไม่ถูกต้อง" };
  }

  const parsed = cnSchema.safeParse({
    cnDate:         formData.get("cnDate"),
    saleId:         formData.get("saleId") || undefined,
    type:           formData.get("type"),
    settlementType: formData.get("settlementType") || CNSettlementType.CASH_REFUND,
    note:           formData.get("note") || undefined,
    items,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { cnDate, saleId, type, settlementType, note, items: validItems } = parsed.data;

  const totalAmount = validItems.reduce((sum, item) => sum + item.qty * item.salePrice, 0);

  const docDate = new Date(cnDate);
  const cnNo    = await generateDocNo("CN", docDate);

  try {
    await db.$transaction(async (tx) => {
      // Create CreditNote header
      const cn = await tx.creditNote.create({
        data: {
          cnNo,
          saleId:         saleId || null,
          userId:         session.user!.id!,
          type,
          settlementType,
          totalAmount,
          note:           note ?? null,
          cnDate:         docDate,
        },
      });

      // Process each line item
      for (const item of validItems) {
        // Get unit scale
        const unit = await tx.productUnit.findUnique({
          where: { productId_name: { productId: item.productId, name: item.unitName } },
        });
        if (!unit) throw new Error(`ไม่พบหน่วยนับ ${item.unitName} ของสินค้า`);

        const scale     = Number(unit.scale);
        const qtyInBase = item.qty * scale;
        const itemTotal = item.qty * item.salePrice;

        // Create CreditNoteItem (real DB field names: creditNoteId, qty, unitPrice, amount)
        await tx.creditNoteItem.create({
          data: {
            creditNoteId: cn.id,
            productId:    item.productId,
            qty:          Math.round(qtyInBase),
            unitPrice:    item.salePrice,
            amount:       itemTotal,
          },
        });

        // Write StockCard only for RETURN type
        if (type === CreditNoteType.RETURN) {
          await writeStockCard(tx, {
            productId:   item.productId,
            docNo:       cnNo,
            docDate,
            source:      "RETURN_IN",
            qtyIn:       qtyInBase,
            qtyOut:      0,
            priceIn:     0,
            detail:      `รับคืน ${item.qty} ${item.unitName}`,
            referenceId: cn.id,
          });
        }
      }
    });

    revalidatePath("/admin/credit-notes");
    revalidatePath("/admin/products");
    return { success: true, cnNo };
  } catch (err) {
    console.error("[createCreditNote]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
