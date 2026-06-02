import { db, dbTx } from "@/lib/db";
import { type AuditLogActor, safeWriteAuditLog } from "@/lib/audit-log";
import { generateSaleNo } from "@/lib/doc-number";
import {
  AuditAction,
  CashBankDirection,
  CashBankSourceType,
  FulfillmentType,
  Prisma,
  SaleChannel,
  SalePaymentType,
  ShopeeOrderImportStatus,
  VatType,
} from "@/lib/generated/prisma";
import { replaceCashBankSourceMovements } from "@/lib/cash-bank";
import { isInventoryTracked, resolveSaleUnitCost } from "@/lib/inventory-tracking";
import {
  validateLotRows,
  writeSaleLots,
  writeStockMovementLots,
  type LotSubRow,
} from "@/lib/lot-control";
import { rebuildSaleProfitFacts } from "@/lib/profit-fact";
import {
  assertLotBalanceAvailable,
  createWarrantySnapshots,
  resolveSalePaymentMethod,
} from "@/lib/sale-core";
import {
  extractShopeeCarrier,
  extractShopeeTrackingNo,
  mapShopeeCarrierToShippingMethod,
  mapShopeeOrderStatusToShippingStatus,
} from "@/lib/shopee/logistics-utils";
import { writeStockCard } from "@/lib/stock-card";
import { calcItemSubtotal } from "@/lib/vat";

/**
 * Shopee order → internal Sale (Phase F).
 *
 * ARCHITECTURE: reuses the SAME canonical primitives as the manual sale flow
 * (writeStockCard, writeSaleLots, createWarrantySnapshots, rebuildSaleProfitFacts,
 * replaceCashBankSourceMovements) so stock / MAVG / lot / profit / cash results
 * are identical. It does NOT touch sales/actions.ts.
 *
 * SAFETY: `buildShopeeSaleDraft()` is a dry-run preview — the human reviews the
 * parsed lines + prices BEFORE `createSaleFromShopeeOrder()` writes anything.
 * That approval gate is the safeguard against any Shopee price-field mismatch.
 *
 * NOTE: order item price is read defensively from the Shopee payload
 * (`model_discounted_price` → `model_original_price`). Verify against the live
 * API; the preview lets staff catch a wrong number before confirming.
 */

const SHOPEE_SALE_PREFIX = "SP";

type RawOrderItem = {
  item_id?: number;
  model_id?: number;
  item_name?: string;
  model_quantity_purchased?: number;
  model_discounted_price?: number;
  model_original_price?: number;
};
type RawOrder = {
  order_sn?: string;
  order_status?: string;
  buyer_username?: string;
  create_time?: number;
  item_list?: RawOrderItem[];
};

export type ShopeeSaleDraftLine = {
  itemId: string;
  modelId: string;
  productId: string | null;
  productCode: string | null;
  productName: string;
  unitName: string;
  unitScale: number;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  isLotControl: boolean;
  isTracked: boolean;
  error: string | null;
};

export type ShopeeSaleDraft = {
  orderImportId: string;
  orderSn: string;
  buyerUsername: string | null;
  docDate: Date;
  lines: ShopeeSaleDraftLine[];
  totalAmount: number;
  settlementAccountId: string | null;
  alreadyImported: boolean;
  blockers: string[];
};

function lineKey(itemId: string, modelId: string): string {
  return `${itemId}::${modelId}`;
}

function parseRawOrder(rawPayload: Prisma.JsonValue | null): RawOrder | null {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return null;
  return rawPayload as RawOrder;
}

function normalizeModelId(modelId: number | undefined): string {
  return typeof modelId === "number" && modelId !== 0 ? String(modelId) : "0";
}

function resolveUnitPrice(item: RawOrderItem): number {
  if (typeof item.model_discounted_price === "number") return item.model_discounted_price;
  if (typeof item.model_original_price === "number") return item.model_original_price;
  return 0;
}

/**
 * Builds a dry-run preview of the Sale that would be created from a queued
 * Shopee order. No writes. Surfaces blockers (unmapped SKU, missing settlement
 * account, lot-controlled lines that need manual lot selection).
 */
export async function buildShopeeSaleDraft(orderImportId: string): Promise<ShopeeSaleDraft | null> {
  const orderImport = await db.shopeeOrderImport.findUnique({
    where: { id: orderImportId },
    select: {
      id: true,
      orderSn: true,
      buyerUsername: true,
      orderCreatedAt: true,
      rawPayload: true,
      importStatus: true,
      saleId: true,
      shopRecordId: true,
      shop: { select: { settlementCashBankAccountId: true } },
    },
  });
  if (!orderImport) return null;

  const order = parseRawOrder(orderImport.rawPayload);
  const rawItems = order?.item_list ?? [];

  // Resolve mappings → internal products.
  const mappings = await db.shopeeProductMapping.findMany({
    where: { shopRecordId: orderImport.shopRecordId },
    select: {
      itemId: true,
      modelId: true,
      productId: true,
      productUnitId: true,
      product: {
        select: {
          id: true,
          code: true,
          name: true,
          saleUnitName: true,
          inventoryTracking: true,
          isLotControl: true,
          units: { select: { name: true, scale: true, isBase: true } },
        },
      },
    },
  });
  const mappingByKey = new Map(mappings.map((m) => [lineKey(m.itemId, m.modelId), m]));

  const lines: ShopeeSaleDraftLine[] = [];
  let totalAmount = 0;

  for (const item of rawItems) {
    const itemId = typeof item.item_id === "number" ? String(item.item_id) : "";
    const modelId = normalizeModelId(item.model_id);
    const qty = typeof item.model_quantity_purchased === "number" ? item.model_quantity_purchased : 0;
    const unitPrice = resolveUnitPrice(item);
    const mapping = mappingByKey.get(lineKey(itemId, modelId));

    if (!mapping) {
      lines.push({
        itemId, modelId, productId: null, productCode: null,
        productName: item.item_name ?? `item ${itemId}`,
        unitName: "-", unitScale: 1, qty, unitPrice, lineTotal: qty * unitPrice,
        isLotControl: false, isTracked: false,
        error: "ยังไม่ได้ map สินค้า",
      });
      continue;
    }

    const product = mapping.product;
    const chosenUnit = mapping.productUnitId
      ? product.units.find((u) => u.name === product.saleUnitName) ?? product.units.find((u) => u.isBase)
      : product.units.find((u) => u.isBase) ?? product.units[0];
    const unitName = chosenUnit?.name ?? product.saleUnitName;
    const unitScale = chosenUnit ? Number(chosenUnit.scale) : 1;
    const lineTotal = qty * unitPrice;
    totalAmount += lineTotal;

    lines.push({
      itemId, modelId,
      productId: product.id, productCode: product.code, productName: product.name,
      unitName, unitScale, qty, unitPrice, lineTotal,
      isLotControl: isInventoryTracked(product.inventoryTracking) && product.isLotControl,
      isTracked: isInventoryTracked(product.inventoryTracking),
      error: qty <= 0 ? "จำนวนไม่ถูกต้อง" : null,
    });
  }

  const blockers: string[] = [];
  if (orderImport.saleId || orderImport.importStatus === ShopeeOrderImportStatus.IMPORTED) {
    blockers.push("ออเดอร์นี้สร้างบิลไปแล้ว");
  }
  if (orderImport.importStatus === ShopeeOrderImportStatus.CANCELLED_REVIEW) {
    blockers.push("Shopee order นี้อยู่ในคิว review cancel/refund/return ต้องตรวจด้วยคนก่อน");
  }
  if (lines.length === 0) blockers.push("ออเดอร์ไม่มีรายการสินค้า");
  if (lines.some((l) => l.error === "ยังไม่ได้ map สินค้า")) blockers.push("มีสินค้าที่ยังไม่ได้ map");
  if (!orderImport.shop.settlementCashBankAccountId) blockers.push("ยังไม่ได้ตั้งบัญชี Shopee พักเงิน");
  if (lines.some((l) => l.isLotControl)) blockers.push("มีสินค้าคุม lot ต้องเลือก lot ก่อน");

  return {
    orderImportId: orderImport.id,
    orderSn: orderImport.orderSn,
    buyerUsername: orderImport.buyerUsername,
    docDate: orderImport.orderCreatedAt ?? new Date(),
    lines,
    totalAmount,
    settlementAccountId: orderImport.shop.settlementCashBankAccountId,
    alreadyImported: Boolean(orderImport.saleId),
    blockers,
  };
}

export type LotSelectionMap = Record<string, LotSubRow[]>; // keyed by `${itemId}::${modelId}`

export type CreateShopeeSaleResult =
  | { ok: true; saleId: string; saleNo: string }
  | { ok: false; error: string };

/**
 * Creates the real Sale from a queued Shopee order (after human approval).
 * Reuses the canonical sale primitives inside one transaction.
 */
export async function createSaleFromShopeeOrder(params: {
  orderImportId: string;
  approverUserId: string;
  lotSelections?: LotSelectionMap;
  actor?: AuditLogActor;
}): Promise<CreateShopeeSaleResult> {
  const draft = await buildShopeeSaleDraft(params.orderImportId);
  if (!draft) return { ok: false, error: "ไม่พบออเดอร์" };
  if (draft.alreadyImported) return { ok: false, error: "ออเดอร์นี้สร้างบิลไปแล้ว" };
  if (!draft.settlementAccountId) return { ok: false, error: "ยังไม่ได้ตั้งบัญชี Shopee พักเงิน" };
  if (draft.lines.length === 0) return { ok: false, error: "ออเดอร์ไม่มีรายการสินค้า" };
  if (draft.lines.some((l) => l.productId === null)) return { ok: false, error: "มีสินค้าที่ยังไม่ได้ map" };

  const settlementAccountId = draft.settlementAccountId;
  const docDate = draft.docDate;
  const lotSelections = params.lotSelections ?? {};

  const totalAmount = draft.totalAmount;
  const netAmount = totalAmount;
  const subtotalAmount = draft.lines.reduce(
    (sum, l) => sum + calcItemSubtotal(l.lineTotal, VatType.NO_VAT, 0),
    0,
  );

  const saleNo = await generateSaleNo(SHOPEE_SALE_PREFIX, docDate);
  const orderImport = await db.shopeeOrderImport.findUnique({
    where: { id: params.orderImportId },
    select: { rawPayload: true, shopeeStatus: true },
  });
  const rawOrder = parseRawOrder(orderImport?.rawPayload ?? null);
  const trackingNo = extractShopeeTrackingNo(orderImport?.rawPayload ?? null);
  const shippingMethod = mapShopeeCarrierToShippingMethod(extractShopeeCarrier(orderImport?.rawPayload ?? null));
  const shippingStatus = mapShopeeOrderStatusToShippingStatus(rawOrder?.order_status ?? orderImport?.shopeeStatus, trackingNo);
  let createdSaleId = "";

  try {
    await dbTx(async (tx) => {
      const paymentMethod = await resolveSalePaymentMethod(tx, settlementAccountId);

      const sale = await tx.sale.create({
        data: {
          saleNo,
          channel: SaleChannel.SHOPEE,
          channelRefNo: draft.orderSn,
          customerId: null,
          customerName: draft.buyerUsername ?? "ลูกค้า Shopee",
          customerPhone: null,
          paymentType: SalePaymentType.CASH_SALE,
          fulfillmentType: FulfillmentType.DELIVERY,
          userId: params.approverUserId,
          totalAmount: new Prisma.Decimal(totalAmount),
          discount: new Prisma.Decimal(0),
          netAmount: new Prisma.Decimal(netAmount),
          subtotalAmount: new Prisma.Decimal(subtotalAmount),
          vatType: VatType.NO_VAT,
          vatRate: new Prisma.Decimal(0),
          vatAmount: new Prisma.Decimal(0),
          paymentMethod,
          cashBankAccountId: settlementAccountId,
          saleDate: docDate,
          amountRemain: new Prisma.Decimal(0),
          shippingMethod,
          shippingStatus,
          trackingNo,
          note: `Shopee order ${draft.orderSn}`,
        },
      });
      createdSaleId = sale.id;

      for (const [index, line] of draft.lines.entries()) {
        if (!line.productId) throw new Error("unmapped line");
        const qtyInBase = line.qty * line.unitScale;
        const product = await tx.product.findUnique({
          where: { id: line.productId },
          select: { avgCost: true, costPrice: true, inventoryTracking: true, warrantyDays: true, isLotControl: true },
        });
        if (!product) throw new Error("ไม่พบสินค้า");

        const costPerBase = resolveSaleUnitCost(product);
        const itemTotal = line.lineTotal;
        const itemSubtotal = calcItemSubtotal(itemTotal, VatType.NO_VAT, 0);

        const saleItem = await tx.saleItem.create({
          data: {
            saleId: sale.id,
            lineNo: index + 1,
            productId: line.productId,
            quantity: Math.round(qtyInBase),
            salePrice: new Prisma.Decimal(line.unitPrice),
            costPrice: costPerBase,
            totalAmount: new Prisma.Decimal(itemTotal),
            subtotalAmount: new Prisma.Decimal(itemSubtotal),
            showQty: new Prisma.Decimal(line.qty),
            showUnitName: line.unitName,
            showPricePerUnit: new Prisma.Decimal(line.unitPrice),
            unitScale: line.unitScale,
            warrantyDays: product.warrantyDays,
          },
        });

        const stockCardId = line.isTracked
          ? await writeStockCard(tx, {
              productId: line.productId,
              docNo: saleNo,
              docDate,
              source: "SALE",
              qtyIn: 0,
              qtyOut: qtyInBase,
              priceIn: 0,
              detail: `ขาย Shopee ${line.qty} ${line.unitName}`,
              referenceId: saleItem.id,
            })
          : null;

        const selectedLots = lotSelections[lineKey(line.itemId, line.modelId)] ?? [];
        if (stockCardId && line.isLotControl) {
          const lotErr = validateLotRows(selectedLots, line.qty, false);
          if (lotErr) throw new Error(lotErr);
          const lotsInBase = selectedLots.map((lot) => ({
            lotNo: lot.lotNo.trim(),
            qtyInBase: lot.qty * line.unitScale,
            unitCostBase: costPerBase,
            mfgDate: null as Date | null,
            expDate: null as Date | null,
          }));
          await assertLotBalanceAvailable(tx, line.productId, lotsInBase);
          await writeSaleLots(tx, saleItem.id, line.productId, lotsInBase);
          await writeStockMovementLots(tx, stockCardId, lotsInBase, "out");
        }

        await createWarrantySnapshots(tx, {
          saleId: sale.id,
          saleItemId: saleItem.id,
          productId: line.productId,
          warrantyDays: product.warrantyDays,
          docDate,
          itemQty: line.qty,
          lotItems: selectedLots,
        });
      }

      await replaceCashBankSourceMovements(tx, CashBankSourceType.SALE, sale.id, [
        {
          accountId: settlementAccountId,
          txnDate: docDate,
          direction: CashBankDirection.IN,
          amount: netAmount,
          referenceNo: saleNo,
          note: `Shopee ${draft.orderSn}`,
        },
      ]);

      await rebuildSaleProfitFacts(tx, sale.id);

      await tx.shopeeOrderImport.update({
        where: { id: draft.orderImportId },
        data: { importStatus: ShopeeOrderImportStatus.IMPORTED, saleId: sale.id, importedAt: new Date(), lastError: null },
      });
    }, { timeout: 180_000 });

    await safeWriteAuditLog({
      ...params.actor,
      action: AuditAction.CREATE,
      entityType: "Sale",
      entityId: createdSaleId,
      entityRef: saleNo,
      meta: { event: "SHOPEE_SALE_CREATE", orderSn: draft.orderSn, channel: "SHOPEE" },
    });

    return { ok: true, saleId: createdSaleId, saleNo };
  } catch (error) {
    console.error("[shopee] create sale failed:", error instanceof Error ? error.message : "unknown");
    return { ok: false, error: error instanceof Error ? error.message : "สร้างบิลไม่สำเร็จ" };
  }
}
