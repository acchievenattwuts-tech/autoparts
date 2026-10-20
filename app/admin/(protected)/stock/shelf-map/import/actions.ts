"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  getAuditActorFromSession,
  getRequestContext,
  writeAuditLogManyTx,
  type AuditLogActor,
  type AuditLogInput,
  type AuditRequestContext,
} from "@/lib/audit-log";
import { db, dbTx } from "@/lib/db";
import { AuditAction, type Prisma } from "@/lib/generated/prisma";
import { requirePermission } from "@/lib/require-auth";
import {
  buildShelfImportContext,
  buildShelfImportPreview,
  checkShelfImportFileMeta,
  checkShelfImportFileSignature,
  collectShelfImportLookups,
  parseShelfLocationWorkbook,
  planShelfLocationImport,
  type ShelfImportContext,
  type ShelfImportCounts,
  type ShelfImportPlan,
  type ShelfImportPreview,
  type ShelfImportRow,
} from "@/lib/shelf-location-excel";
import { applyShelfLocationDiffs, buildShelfLocationAuditInput, loadProductShelfDrafts, loadShelfRackLookup } from "@/lib/shelf-map";
import { describeShelfLocations } from "@/lib/shelf-location-rules";

/**
 * Import of a filled survey / recheck sheet (ผังชั้นวาง). Preview and apply both re-read the
 * uploaded file and re-plan from the current database state; the preview is never trusted.
 */

type Client = Prisma.TransactionClient;

const IMPORT_TX_TIMEOUT_MS = 60_000;
const FILE_NAME_MAX_LENGTH = 120;
const SIGNATURE_BYTES = 4;

const NO_PERMISSION_MESSAGE = "ไม่มีสิทธิ์นำเข้าตำแหน่งสินค้า";
const NO_FILE_MESSAGE = "กรุณาเลือกไฟล์ .xlsx";

const uploadSchema = z.object({ file: z.instanceof(File, { error: NO_FILE_MESSAGE }) });

export type ShelfImportPreviewResult = { ok: true; preview: ShelfImportPreview } | { ok: false; error: string };
export type ShelfImportApplyResult =
  | { ok: true; message: string; counts: ShelfImportCounts }
  | { ok: false; error: string };

type UploadReading = { ok: true; fileName: string; rows: ShelfImportRow[] } | { ok: false; error: string };

const sanitizeFileName = (name: string): string =>
  name
    .replace(/[^A-Za-z0-9ก-๙ ._()-]/g, "_")
    .slice(0, FILE_NAME_MAX_LENGTH) || "shelf-locations.xlsx";

/** Server-side upload checks (extension, type, size, zip signature, header), then the rows. */
const readShelfImportUpload = async (formData: FormData): Promise<UploadReading> => {
  const parsed = uploadSchema.safeParse({ file: formData.get("file") });
  if (!parsed.success) return { ok: false, error: NO_FILE_MESSAGE };
  const { file } = parsed.data;
  const metaError = checkShelfImportFileMeta({ name: file.name, type: file.type, size: file.size });
  if (metaError) return { ok: false, error: metaError };
  try {
    const data = await file.arrayBuffer();
    const signatureError = checkShelfImportFileSignature(new Uint8Array(data, 0, Math.min(data.byteLength, SIGNATURE_BYTES)));
    if (signatureError) return { ok: false, error: signatureError };
    const workbook = await parseShelfLocationWorkbook(data);
    if (!workbook.ok) return workbook;
    return { ok: true, fileName: sanitizeFileName(file.name), rows: workbook.rows };
  } catch (error) {
    console.error("[shelf-import] read failed", { error });
    return { ok: false, error: "อ่านไฟล์ไม่สำเร็จ กรุณาลองใหม่" };
  }
};

/** Racks, plus only the products (and their locations) that rows with an instruction refer to. */
const loadShelfImportContext = async (
  client: Client,
  rows: readonly ShelfImportRow[],
  now: Date,
): Promise<ShelfImportContext> => {
  const lookups = collectShelfImportLookups(rows);
  const racks = await loadShelfRackLookup(client);
  const products =
    lookups.productIds.length + lookups.productCodes.length === 0
      ? []
      : await client.product.findMany({
          where: { OR: [{ id: { in: lookups.productIds } }, { code: { in: lookups.productCodes } }] },
          select: { id: true, code: true, name: true, isActive: true },
        });
  const drafts = await loadProductShelfDrafts(
    client,
    products.map((product) => product.id),
  );
  return buildShelfImportContext({ racks: racks.list, products, drafts, now });
};

const buildImportAuditInputs = (input: {
  plan: ShelfImportPlan;
  context: ShelfImportContext;
  actor: AuditLogActor;
  requestContext: AuditRequestContext;
  fileName: string;
}): AuditLogInput[] => {
  const { plan, context, actor, requestContext, fileName } = input;
  const perProduct = plan.products.map((product) =>
    buildShelfLocationAuditInput({
      actor,
      requestContext,
      productId: product.productId,
      productCode: product.productCode,
      before: describeShelfLocations(product.before, context.racksById),
      after: describeShelfLocations(product.after, context.racksById),
      changed: product.changed,
      source: "shelf_import",
      meta: { fileName, rows: product.rowNumbers },
    }),
  );
  const summary: AuditLogInput = {
    ...actor,
    ...requestContext,
    action: AuditAction.IMPORT,
    entityType: "ShelfLocationImport",
    entityRef: fileName,
    meta: { ...plan.counts },
  };
  return [...perProduct, summary];
};

const formatCount = (value: number): string => value.toLocaleString("en-US");

const buildSuccessMessage = (counts: ShelfImportCounts): string => {
  const skipped = counts.errorRows + counts.conflictRows;
  return [
    `บันทึกตำแหน่งแล้ว: เปลี่ยน ${formatCount(counts.changedProducts)} สินค้า`,
    `ยืนยันตำแหน่ง ${formatCount(counts.confirmedProducts)} สินค้า`,
    `ข้าม ${formatCount(skipped)} แถว`,
  ].join(" · ");
};

const revalidateShelfImportPaths = (): void => {
  revalidatePath("/admin/stock/shelf-map");
  revalidatePath("/admin/products");
  revalidatePath("/admin/products/search");
};

export const previewShelfLocationImport = async (formData: FormData): Promise<ShelfImportPreviewResult> => {
  const session = await requirePermission("stock.shelf_map.manage").catch(() => null);
  if (!session?.user?.id) return { ok: false, error: NO_PERMISSION_MESSAGE };

  const upload = await readShelfImportUpload(formData);
  if (!upload.ok) return upload;
  try {
    const context = await loadShelfImportContext(db, upload.rows, new Date());
    const plan = planShelfLocationImport(upload.rows, context);
    return { ok: true, preview: buildShelfImportPreview(plan, context.racksById, upload.fileName) };
  } catch (error) {
    console.error("[shelf-import] preview failed", { fileName: upload.fileName, error });
    return { ok: false, error: "ตรวจไฟล์ไม่สำเร็จ กรุณาลองใหม่" };
  }
};

export const applyShelfLocationImport = async (formData: FormData): Promise<ShelfImportApplyResult> => {
  const session = await requirePermission("stock.shelf_map.manage").catch(() => null);
  if (!session?.user?.id) return { ok: false, error: NO_PERMISSION_MESSAGE };

  const upload = await readShelfImportUpload(formData);
  if (!upload.ok) return upload;
  try {
    const requestContext = await getRequestContext();
    const actor = getAuditActorFromSession(session);
    const now = new Date();
    const result = await dbTx(
      async (tx): Promise<ShelfImportApplyResult> => {
        const context = await loadShelfImportContext(tx, upload.rows, now);
        const plan = planShelfLocationImport(upload.rows, context);
        if (plan.products.length === 0) return { ok: false, error: "ไม่มีรายการที่ต้องบันทึก กรุณาตรวจไฟล์อีกครั้ง" };
        await applyShelfLocationDiffs(
          tx,
          plan.products.map((product) => ({ productId: product.productId, diff: product.diff })),
          now,
        );
        await writeAuditLogManyTx(
          tx,
          buildImportAuditInputs({ plan, context, actor, requestContext, fileName: upload.fileName }),
        );
        return { ok: true, message: buildSuccessMessage(plan.counts), counts: plan.counts };
      },
      { timeout: IMPORT_TX_TIMEOUT_MS },
    );
    if (result.ok) revalidateShelfImportPaths();
    return result;
  } catch (error) {
    console.error("[shelf-import] apply failed", { fileName: upload.fileName, error });
    return { ok: false, error: "บันทึกตำแหน่งไม่สำเร็จ ข้อมูลอาจถูกแก้ไขพร้อมกัน กรุณาตรวจไฟล์แล้วลองใหม่" };
  }
};
