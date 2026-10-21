"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getAuditActorFromSession, getRequestContext, writeAuditLogManyTx } from "@/lib/audit-log";
import { dbTx } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { buildShelfLocationAuditInput, changeManyProductShelfLocations, type ProductShelfBatchEntry } from "@/lib/shelf-map";
import { MAX_SHELF_RACK_LEVELS, SHELF_RULE_ERROR_MESSAGES, type ShelfLocationChange } from "@/lib/shelf-location-rules";

/**
 * Bulk actions of the put-away page (ตั้งที่เก็บสินค้า). Single-product actions on a card use
 * changeShelfLocationAction from ../shelf-map/location-actions.ts with source "put_away".
 */

const PUT_AWAY_BULK_MAX = 100;

const idSchema = z.string().regex(/^[a-z0-9]{1,50}$/);
const bulkSchema = z.object({
  productIds: z
    .array(idSchema)
    .min(1)
    .max(PUT_AWAY_BULK_MAX)
    .refine((ids) => new Set(ids).size === ids.length),
  action: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("place"),
      target: z.object({ rackId: idSchema, level: z.number().int().min(1).max(MAX_SHELF_RACK_LEVELS) }),
    }),
    z.object({ kind: z.literal("keepHome") }),
  ]),
});

export type PutAwayBulkInput = z.input<typeof bulkSchema>;
export type PutAwayBulkResult =
  | { ok: true; saved: number; failed: { code: string; error: string }[] }
  | { ok: false; error: string };

const resolverFor = (action: z.infer<typeof bulkSchema>["action"]): ProductShelfBatchEntry["resolve"] => {
  if (action.kind === "place") return () => [{ kind: "place", target: action.target }];
  return (locations): ShelfLocationChange[] | "LOCATION_NOT_FOUND" => {
    const home = locations.find((location) => location.isPrimary && location.id !== null);
    return home?.id ? [{ kind: "confirm", locationId: home.id }] : "LOCATION_NOT_FOUND";
  };
};

/** "ตั้งที่เก็บให้ที่เลือก" (place) and "เก็บที่เดิมทั้งหมดที่เลือก" (keepHome) for up to 100 products. */
export const putAwayProductsAction = async (input: PutAwayBulkInput): Promise<PutAwayBulkResult> => {
  const session = await requirePermission("stock.shelf_map.manage").catch(() => null);
  if (!session?.user?.id) return { ok: false, error: "ไม่มีสิทธิ์จัดการตำแหน่งสินค้า" };

  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: `เลือกได้ครั้งละ 1–${PUT_AWAY_BULK_MAX} รายการ กรุณาโหลดหน้าใหม่` };
  const { productIds, action } = parsed.data;
  const resolve = resolverFor(action);

  try {
    const requestContext = await getRequestContext();
    const actor = getAuditActorFromSession(session);
    const result = await dbTx(async (tx): Promise<PutAwayBulkResult> => {
      const products = await tx.product.findMany({
        where: { id: { in: productIds }, isActive: true },
        select: { id: true, code: true },
      });
      const codeById = new Map(products.map((product) => [product.id, product.code]));
      const outcomes = await changeManyProductShelfLocations(tx, {
        now: new Date(),
        entries: products.map((product) => ({ productId: product.id, resolve })),
      });
      const saved = outcomes.flatMap((outcome) => (outcome.ok ? [outcome] : []));
      await writeAuditLogManyTx(
        tx,
        saved.map((outcome) =>
          buildShelfLocationAuditInput({
            actor,
            requestContext,
            productId: outcome.productId,
            productCode: codeById.get(outcome.productId) ?? outcome.productId,
            before: outcome.before,
            after: outcome.after,
            changed: outcome.changed,
            source: "put_away",
            meta: { change: action.kind, bulk: true },
          }),
        ),
      );
      const missing = productIds.filter((id) => !codeById.has(id)).map(() => ({ code: "-", error: "ไม่พบสินค้า หรือสินค้าถูกปิดใช้งาน" }));
      const failed = outcomes.flatMap((outcome) =>
        outcome.ok
          ? []
          : [{ code: codeById.get(outcome.productId) ?? outcome.productId, error: SHELF_RULE_ERROR_MESSAGES[outcome.error] }],
      );
      return { ok: true, saved: saved.length, failed: [...failed, ...missing] };
    });
    if (result.ok && result.saved > 0) {
      revalidatePath("/admin/stock/put-away");
      revalidatePath("/admin/stock/shelf-map");
      revalidatePath("/admin/products/search");
    }
    return result;
  } catch (error) {
    console.error("[put-away] bulk action failed", { count: productIds.length, kind: action.kind, error });
    return { ok: false, error: "บันทึกที่เก็บไม่สำเร็จ กรุณาลองใหม่" };
  }
};
