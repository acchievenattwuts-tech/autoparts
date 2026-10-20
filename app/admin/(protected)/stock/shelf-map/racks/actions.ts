"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  diffEntity,
  getAuditActorFromSession,
  getRequestContext,
  writeAuditLogTx,
  type AuditLogActor,
  type AuditRequestContext,
} from "@/lib/audit-log";
import { dbTx } from "@/lib/db";
import { isUniqueViolationOn } from "@/lib/doc-number-retry";
import { AuditAction, type Prisma } from "@/lib/generated/prisma";
import { requirePermission } from "@/lib/require-auth";
import { MAX_SHELF_RACK_LEVELS, normalizeShelfRackCode, SHELF_RACK_CODE_PATTERN } from "@/lib/shelf-location-rules";
import { formatShelfBlockingList, loadShelfRackBlockingLocations } from "@/lib/shelf-map-queries";

/**
 * Rack setup (ตั้งค่าชั้นวาง). Racks are deactivated, never deleted. A rack that still
 * holds products cannot be deactivated or lose the levels those products sit on; the
 * guard runs inside the write transaction and names the products to move first.
 */

const SHELF_RACK_NAME_MAX_LENGTH = 50;
const SHELF_RACK_SORT_ORDER_MAX = 9999;
const NO_PERMISSION_ERROR = "ไม่มีสิทธิ์จัดการชั้นวาง";
const LEVELS_ERROR = `จำนวนชั้นต้องเป็นเลข 1–${MAX_SHELF_RACK_LEVELS}`;
const SORT_ORDER_ERROR = `ลำดับต้องเป็นเลข 0–${SHELF_RACK_SORT_ORDER_MAX}`;

const idSchema = z.string().regex(/^[a-z0-9]{1,50}$/, "รหัสไม่ถูกต้อง");

const rackSchema = z.object({
  code: z
    .string()
    .transform(normalizeShelfRackCode)
    .pipe(z.string().regex(SHELF_RACK_CODE_PATTERN, "รหัสชั้นวางต้องเป็นตัวอักษร A–Z หรือตัวเลข ยาว 1–4 ตัว")),
  name: z
    .string()
    .trim()
    .max(SHELF_RACK_NAME_MAX_LENGTH, `ชื่อชั้นวางยาวได้ไม่เกิน ${SHELF_RACK_NAME_MAX_LENGTH} ตัวอักษร`)
    .transform((value) => value || null),
  levels: z.coerce
    .number({ error: LEVELS_ERROR })
    .int(LEVELS_ERROR)
    .min(1, LEVELS_ERROR)
    .max(MAX_SHELF_RACK_LEVELS, LEVELS_ERROR),
  sortOrder: z.coerce
    .number({ error: SORT_ORDER_ERROR })
    .int(SORT_ORDER_ERROR)
    .min(0, SORT_ORDER_ERROR)
    .max(SHELF_RACK_SORT_ORDER_MAX, SORT_ORDER_ERROR),
});

type ShelfRackInput = z.output<typeof rackSchema>;

const toggleSchema = z.object({ id: idSchema, isActive: z.boolean() });

export type ShelfRackActionResult = { error?: string };

const RACK_AUDIT_SELECT = {
  id: true,
  code: true,
  name: true,
  levels: true,
  sortOrder: true,
  isActive: true,
} as const satisfies Prisma.ShelfRackSelect;

type RackSnapshot = Prisma.ShelfRackGetPayload<{ select: typeof RACK_AUDIT_SELECT }>;

type AuditContext = { actor: AuditLogActor; requestContext: AuditRequestContext };

const readFormText = (formData: FormData, key: string): string => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

const parseRackForm = (formData: FormData) =>
  rackSchema.safeParse({
    code: readFormText(formData, "code"),
    name: readFormText(formData, "name"),
    levels: readFormText(formData, "levels"),
    sortOrder: readFormText(formData, "sortOrder") || "0",
  });

const refreshShelfPaths = (): void => {
  revalidatePath("/admin/stock/shelf-map");
  revalidatePath("/admin/stock/shelf-map/racks");
};

const duplicateCodeError = (code: string): string => `รหัสชั้นวาง ${code} มีอยู่แล้ว`;

const getAuditContext = async (session: Parameters<typeof getAuditActorFromSession>[0]): Promise<AuditContext> => ({
  actor: getAuditActorFromSession(session),
  requestContext: await getRequestContext(),
});

const writeRackAudit = async (
  tx: Prisma.TransactionClient,
  context: AuditContext,
  input: { action: AuditAction; rack: RackSnapshot; before?: unknown; after: unknown; meta?: Record<string, unknown> },
): Promise<void> => {
  await writeAuditLogTx(tx, {
    ...context.actor,
    ...context.requestContext,
    action: input.action,
    entityType: "ShelfRack",
    entityId: input.rack.id,
    entityRef: input.rack.code,
    ...(input.before !== undefined ? { before: input.before } : {}),
    after: input.after,
    ...(input.meta ? { meta: input.meta } : {}),
  });
};

/** Blocks reducing levels below a level that still holds products. */
const checkLevelReduction = async (
  tx: Prisma.TransactionClient,
  before: RackSnapshot,
  levels: number,
): Promise<string | null> => {
  if (levels >= before.levels) return null;
  const blocking = await loadShelfRackBlockingLocations(tx, { rackId: before.id, rackCode: before.code, aboveLevel: levels });
  if (blocking.total === 0) return null;
  return `ลดชั้นวาง ${before.code} เหลือ ${levels} ชั้นไม่ได้ ยังมีสินค้าอยู่ชั้นที่สูงกว่า: ${formatShelfBlockingList(blocking)} — ย้ายหรือเอาตำแหน่งออกก่อน`;
};

const createRackInTx = async (
  tx: Prisma.TransactionClient,
  input: ShelfRackInput,
  context: AuditContext,
): Promise<ShelfRackActionResult> => {
  const duplicate = await tx.shelfRack.findUnique({ where: { code: input.code }, select: { id: true } });
  if (duplicate) return { error: duplicateCodeError(input.code) };
  const created = await tx.shelfRack.create({ data: input, select: RACK_AUDIT_SELECT });
  await writeRackAudit(tx, context, { action: AuditAction.CREATE, rack: created, after: created });
  return {};
};

export const createShelfRack = async (formData: FormData): Promise<ShelfRackActionResult> => {
  const session = await requirePermission("stock.shelf_map.manage").catch(() => null);
  if (!session?.user?.id) return { error: NO_PERMISSION_ERROR };

  const parsed = parseRackForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลชั้นวางไม่ถูกต้อง" };

  try {
    const context = await getAuditContext(session);
    const result = await dbTx((tx) => createRackInTx(tx, parsed.data, context));
    if (!result.error) refreshShelfPaths();
    return result;
  } catch (error) {
    if (isUniqueViolationOn(error, "code")) return { error: duplicateCodeError(parsed.data.code) };
    console.error("[shelf-rack] create failed", { code: parsed.data.code, error });
    return { error: "เพิ่มชั้นวางไม่สำเร็จ กรุณาลองใหม่" };
  }
};

const updateRackInTx = async (
  tx: Prisma.TransactionClient,
  id: string,
  input: ShelfRackInput,
  context: AuditContext,
): Promise<ShelfRackActionResult> => {
  const before = await tx.shelfRack.findUnique({ where: { id }, select: RACK_AUDIT_SELECT });
  if (!before) return { error: "ไม่พบชั้นวาง กรุณาโหลดหน้าใหม่" };

  if (input.code !== before.code) {
    const duplicate = await tx.shelfRack.findUnique({ where: { code: input.code }, select: { id: true } });
    if (duplicate) return { error: duplicateCodeError(input.code) };
  }
  const levelError = await checkLevelReduction(tx, before, input.levels);
  if (levelError) return { error: levelError };

  const unchanged =
    input.code === before.code &&
    input.name === before.name &&
    input.levels === before.levels &&
    input.sortOrder === before.sortOrder;
  if (unchanged) return {};

  const after = await tx.shelfRack.update({ where: { id }, data: input, select: RACK_AUDIT_SELECT });
  const diff = diffEntity(before, after);
  await writeRackAudit(tx, context, { action: AuditAction.UPDATE, rack: after, before: diff.before, after: diff.after });
  return {};
};

export const updateShelfRack = async (id: string, formData: FormData): Promise<ShelfRackActionResult> => {
  const session = await requirePermission("stock.shelf_map.manage").catch(() => null);
  if (!session?.user?.id) return { error: NO_PERMISSION_ERROR };

  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { error: "รหัสไม่ถูกต้อง" };
  const parsed = parseRackForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลชั้นวางไม่ถูกต้อง" };

  try {
    const context = await getAuditContext(session);
    const result = await dbTx((tx) => updateRackInTx(tx, parsedId.data, parsed.data, context));
    if (!result.error) refreshShelfPaths();
    return result;
  } catch (error) {
    if (isUniqueViolationOn(error, "code")) return { error: duplicateCodeError(parsed.data.code) };
    console.error("[shelf-rack] update failed", { id: parsedId.data, error });
    return { error: "แก้ไขชั้นวางไม่สำเร็จ กรุณาลองใหม่" };
  }
};

const toggleRackInTx = async (
  tx: Prisma.TransactionClient,
  id: string,
  isActive: boolean,
  context: AuditContext,
): Promise<ShelfRackActionResult> => {
  const before = await tx.shelfRack.findUnique({ where: { id }, select: RACK_AUDIT_SELECT });
  if (!before) return { error: "ไม่พบชั้นวาง กรุณาโหลดหน้าใหม่" };
  if (before.isActive === isActive) return {};

  if (!isActive) {
    const blocking = await loadShelfRackBlockingLocations(tx, { rackId: before.id, rackCode: before.code });
    if (blocking.total > 0) {
      return {
        error: `ปิดใช้งานชั้นวาง ${before.code} ไม่ได้ ยังมีสินค้าวางอยู่: ${formatShelfBlockingList(blocking)} — ย้ายหรือเอาตำแหน่งออกก่อน`,
      };
    }
  }

  const after = await tx.shelfRack.update({ where: { id }, data: { isActive }, select: RACK_AUDIT_SELECT });
  const diff = diffEntity(before, after);
  await writeRackAudit(tx, context, {
    action: AuditAction.CANCEL,
    rack: after,
    before: diff.before,
    after: diff.after,
    meta: { isActive },
  });
  return {};
};

export const toggleShelfRack = async (id: string, isActive: boolean): Promise<ShelfRackActionResult> => {
  const session = await requirePermission("stock.shelf_map.manage").catch(() => null);
  if (!session?.user?.id) return { error: NO_PERMISSION_ERROR };

  const parsed = toggleSchema.safeParse({ id, isActive });
  if (!parsed.success) return { error: "ข้อมูลไม่ถูกต้อง กรุณาโหลดหน้าใหม่" };

  try {
    const context = await getAuditContext(session);
    const result = await dbTx((tx) => toggleRackInTx(tx, parsed.data.id, parsed.data.isActive, context));
    if (!result.error) refreshShelfPaths();
    return result;
  } catch (error) {
    console.error("[shelf-rack] toggle failed", { id: parsed.data.id, isActive: parsed.data.isActive, error });
    return { error: "เปลี่ยนสถานะชั้นวางไม่สำเร็จ กรุณาลองใหม่" };
  }
};
