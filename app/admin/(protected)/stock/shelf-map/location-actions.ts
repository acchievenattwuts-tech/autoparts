"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getAuditActorFromSession, getRequestContext, writeAuditLogTx } from "@/lib/audit-log";
import { dbTx } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { buildShelfLocationAuditInput, changeProductShelfLocation, type ShelfAuditSource } from "@/lib/shelf-map";
import {
  MAX_SHELF_RACK_LEVELS,
  SHELF_LOCATION_NOTE_MAX_LENGTH,
  SHELF_RULE_ERROR_MESSAGES,
  type ShelfLocationChange,
} from "@/lib/shelf-location-rules";

/**
 * Single-product location changes made from the shared badge menu, the shelf map and
 * (phase 1b) the put-away page. Every call is permission-checked, runs the shared rules
 * in one transaction and writes one audit entry for the product.
 */

const idSchema = z.string().regex(/^[a-z0-9]{1,50}$/, "รหัสไม่ถูกต้อง");
const targetSchema = z.object({ rackId: idSchema, level: z.number().int().min(1).max(MAX_SHELF_RACK_LEVELS) });

const changeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("place"), target: targetSchema }),
  z.object({ kind: z.literal("confirm"), locationId: idSchema }),
  z.object({ kind: z.literal("addSecondary"), target: targetSchema }),
  z.object({ kind: z.literal("movePrimary"), target: targetSchema, keepOldAsSecondary: z.boolean() }),
  z.object({ kind: z.literal("promote"), locationId: idSchema }),
  z.object({ kind: z.literal("remove"), locationId: idSchema }),
  z.object({ kind: z.literal("relocate"), locationId: idSchema, target: targetSchema }),
  z.object({
    kind: z.literal("setNote"),
    locationId: idSchema,
    note: z.string().max(SHELF_LOCATION_NOTE_MAX_LENGTH).nullable(),
  }),
]);

const actionSchema = z.object({
  productId: idSchema,
  change: changeSchema,
  source: z.enum(["shelf_badge", "put_away"]).default("shelf_badge"),
});

export type ShelfLocationActionInput = z.input<typeof actionSchema>;
export type ShelfLocationActionResult = { ok: true; message: string } | { ok: false; error: string };

const SUCCESS_MESSAGES: Record<ShelfLocationChange["kind"], string> = {
  place: "บันทึกที่เก็บแล้ว",
  confirm: "ยืนยันตำแหน่งแล้ว",
  addSecondary: "เพิ่มที่เก็บแล้ว",
  movePrimary: "ย้ายที่เก็บประจำแล้ว",
  promote: "ตั้งเป็นที่เก็บประจำแล้ว",
  remove: "เอาตำแหน่งออกแล้ว",
  relocate: "ย้ายตำแหน่งแล้ว",
  setNote: "บันทึกหมายเหตุตำแหน่งแล้ว",
};

const revalidateShelfPaths = (productId: string): void => {
  revalidatePath("/admin/stock/shelf-map");
  revalidatePath("/admin/stock/put-away");
  revalidatePath("/admin/products");
  revalidatePath("/admin/products/search");
  revalidatePath(`/admin/products/${productId}/preview`);
  revalidatePath(`/admin/products/${productId}/edit`);
};

export const changeShelfLocationAction = async (input: ShelfLocationActionInput): Promise<ShelfLocationActionResult> => {
  const session = await requirePermission("stock.shelf_map.manage").catch(() => null);
  if (!session?.user?.id) return { ok: false, error: "ไม่มีสิทธิ์จัดการตำแหน่งสินค้า" };

  const parsed = actionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "ข้อมูลตำแหน่งไม่ถูกต้อง กรุณาโหลดหน้าใหม่" };
  const { productId, change } = parsed.data;
  const source: ShelfAuditSource = parsed.data.source;

  try {
    const requestContext = await getRequestContext();
    const result = await dbTx(async (tx): Promise<ShelfLocationActionResult> => {
      const product = await tx.product.findUnique({ where: { id: productId }, select: { code: true } });
      if (!product) return { ok: false, error: "ไม่พบสินค้า" };
      const outcome = await changeProductShelfLocation(tx, { productId, changes: [change], now: new Date() });
      if (!outcome.ok) return { ok: false, error: SHELF_RULE_ERROR_MESSAGES[outcome.error] };
      await writeAuditLogTx(
        tx,
        buildShelfLocationAuditInput({
          actor: getAuditActorFromSession(session),
          requestContext,
          productId,
          productCode: product.code,
          before: outcome.before,
          after: outcome.after,
          changed: outcome.changed,
          source,
          meta: { change: change.kind },
        }),
      );
      return { ok: true, message: SUCCESS_MESSAGES[change.kind] };
    });
    if (result.ok) revalidateShelfPaths(productId);
    return result;
  } catch (error) {
    console.error("[shelf-location] change failed", { productId, kind: change.kind, error });
    return { ok: false, error: "บันทึกตำแหน่งไม่สำเร็จ กรุณาลองใหม่" };
  }
};
