import { db } from "@/lib/db";
import {
  Prisma,
  CreditNoteType,
  DocStatus,
  MarketplaceSettlementDocType,
  ProfitSourceType,
  SaleChannel,
} from "@/lib/generated/prisma";
import { allocateMoneyByWeights, allocateSaleProfitRevenue } from "@/lib/sale-profit-revenue";
import { getVatRegisteredFrom, isInputVatRecoverable } from "@/lib/input-vat";
import {
  resolveReturnUnitCost,
  returnDispositionReversesStockCost,
} from "@/lib/credit-note-return";
import {
  findDistributionLockingAtRecording,
  loadMonthDistributions,
  SETTLEMENT_SALE_LINE_ORDER,
  type MonthDistribution,
  type SettlementFactDating,
  type SettlementMovedAmount,
} from "@/lib/marketplace/settlement-fee-dating";
import {
  isValueOnlyStockSource, PURCHASE_ALLOWANCE_LABEL, PURCHASE_ALLOWANCE_SOURCE, valueOnlyStockSources,
} from "@/lib/stock-value-only-source";

type ProfitFactTx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/**
 * DISCOUNT/OTHER credit notes reduce revenue only: their SALE_RETURN facts carry no
 * returned quantity and no cost reversal. The fact's sourceSubtype holds the CN type.
 */
export function isValueOnlyCreditNoteType(type: string | null | undefined): boolean {
  return type === CreditNoteType.DISCOUNT || type === CreditNoteType.OTHER;
}

/** Label of a SALE_RETURN fact by its sourceSubtype; facts without a subtype are returns. */
export function getCreditNoteProfitLabel(type: string | null | undefined): string {
  if (type === CreditNoteType.DISCOUNT) return "ลดหนี้ (ส่วนลด)";
  if (type === CreditNoteType.OTHER) return "ลดหนี้ (อื่นๆ)";
  return "คืนสินค้า";
}

type FactProfitRowInput = {
  businessDate: Date;
  sourceType: ProfitSourceType;
  channel?: SaleChannel | null;
  sourceSubtype?: string | null;
  sourceId: string;
  sourceLineId?: string | null;
  sourceDocNo: string;
  referenceDocNo?: string | null;
  sourceStatus: DocStatus;
  versionNo: number;
  productId?: string | null;
  productCode?: string | null;
  productName?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  lineLabel?: string | null;
  quantity: number;
  salesAmountExVat: number;
  salesAmountIncVat: number;
  salesAmount: number;
  costAmount: number;
  expenseAmount: number;
  grossProfit: number;
  netProfitAmount: number;
  unitSalePriceExVat: number;
  unitSalePriceIncVat: number;
  unitSalePrice: number;
  unitCostPrice: number;
  unitProfit: number;
  marginPct: number;
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundPct(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQty(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2));
}

function toQtyDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(4));
}

function calcMarginPct(grossProfit: number, salesAmount: number): number {
  if (Math.abs(salesAmount) < 0.0001) {
    return 0;
  }

  return roundPct((grossProfit / salesAmount) * 100);
}

function calcUnitPrice(amount: number, quantity: number): number {
  if (Math.abs(quantity) < 0.0001) {
    return 0;
  }

  return roundMoney(amount / Math.abs(quantity));
}

function allocateByWeights(total: number, weights: number[]): number[] {
  if (weights.length === 0) {
    return [];
  }

  const totalWeight = weights.reduce((sum, weight) => sum + Math.max(weight, 0), 0);
  if (totalWeight <= 0) {
    const equalShare = roundMoney(total / weights.length);
    const allocations = weights.map((_, index) =>
      index === weights.length - 1 ? 0 : equalShare,
    );
    const allocatedBeforeLast = allocations.reduce((sum, value) => sum + value, 0);
    allocations[weights.length - 1] = roundMoney(total - allocatedBeforeLast);
    return allocations;
  }

  const allocations: number[] = [];
  let remaining = roundMoney(total);

  for (let index = 0; index < weights.length; index += 1) {
    if (index === weights.length - 1) {
      allocations.push(roundMoney(remaining));
      continue;
    }

    const allocated = roundMoney((total * Math.max(weights[index], 0)) / totalWeight);
    allocations.push(allocated);
    remaining = roundMoney(remaining - allocated);
  }

  return allocations;
}

async function getNextVersion(
  tx: ProfitFactTx,
  sourceType: ProfitSourceType,
  sourceId: string,
): Promise<number> {
  const current = await tx.factProfit.aggregate({
    _max: { versionNo: true },
    where: { sourceType, sourceId },
  });

  return (current._max.versionNo ?? 0) + 1;
}

async function deactivateCurrentFacts(
  tx: ProfitFactTx,
  sourceType: ProfitSourceType,
  sourceId: string,
): Promise<void> {
  await tx.factProfit.updateMany({
    where: {
      sourceType,
      sourceId,
      isActive: true,
    },
    data: {
      isActive: false,
      supersededAt: new Date(),
    },
  });
}

async function createFactProfitRows(
  tx: ProfitFactTx,
  rows: FactProfitRowInput[],
): Promise<void> {
  for (const row of rows) {
    await tx.factProfit.create({
      data: {
        businessDate: row.businessDate,
        sourceType: row.sourceType,
        channel: row.channel ?? null,
        sourceSubtype: row.sourceSubtype ?? null,
        sourceId: row.sourceId,
        sourceLineId: row.sourceLineId ?? null,
        sourceDocNo: row.sourceDocNo,
        referenceDocNo: row.referenceDocNo ?? null,
        sourceStatus: row.sourceStatus,
        isActive: row.sourceStatus === DocStatus.ACTIVE,
        versionNo: row.versionNo,
        productId: row.productId ?? null,
        productCode: row.productCode ?? null,
        productName: row.productName ?? null,
        customerId: row.customerId ?? null,
        customerName: row.customerName ?? null,
        supplierId: row.supplierId ?? null,
        supplierName: row.supplierName ?? null,
        lineLabel: row.lineLabel ?? null,
        quantity: toQtyDecimal(row.quantity),
        salesAmountExVat: toDecimal(row.salesAmountExVat),
        salesAmountIncVat: toDecimal(row.salesAmountIncVat),
        salesAmount: toDecimal(row.salesAmount),
        costAmount: toDecimal(row.costAmount),
        expenseAmount: toDecimal(row.expenseAmount),
        grossProfit: toDecimal(row.grossProfit),
        netProfitAmount: toDecimal(row.netProfitAmount),
        unitSalePriceExVat: toDecimal(row.unitSalePriceExVat),
        unitSalePriceIncVat: toDecimal(row.unitSalePriceIncVat),
        unitSalePrice: toDecimal(row.unitSalePrice),
        unitCostPrice: toDecimal(row.unitCostPrice),
        unitProfit: toDecimal(row.unitProfit),
        marginPct: toDecimal(row.marginPct),
      },
    });
  }
}

function buildWeightedSaleCostMap(
  saleItems: { productId: string; quantity: number; costPrice: number }[],
): Map<string, number> {
  const totals = new Map<string, { qty: number; cost: number }>();

  for (const item of saleItems) {
    const existing = totals.get(item.productId) ?? { qty: 0, cost: 0 };
    existing.qty += item.quantity;
    existing.cost += item.quantity * item.costPrice;
    totals.set(item.productId, existing);
  }

  return new Map(
    Array.from(totals.entries()).map(([productId, value]) => [
      productId,
      value.qty > 0 ? roundMoney(value.cost / value.qty) : 0,
    ]),
  );
}

/** A StockCard row whose stock value the replay wrote off (lib/stock-card.ts, T3). */
export type StockValueResidual = { stockCardId: string; productId: string; docDate: Date; source: string; amount: number };

export const STOCK_VALUE_RESIDUAL_LABEL = "ผลต่างมูลค่าสต็อก";

type ActiveResidualFact = { sourceId: string; sourceLineId: string | null; businessDate: Date; costAmount: Prisma.Decimal };

const residualKey = (stockCardId: string | null, businessDate: Date, amount: number): string =>
  `${stockCardId ?? ""}|${businessDate.getTime()}|${amount.toFixed(2)}`;

/** Products whose active facts differ from the residual rows the replay now reports. */
function findChangedResidualProducts(productIds: string[], residuals: readonly StockValueResidual[],
  active: ActiveResidualFact[]): string[] {
  const wanted = new Map<string, string[]>();
  for (const row of residuals) wanted.set(row.productId, [...(wanted.get(row.productId) ?? []), residualKey(row.stockCardId, row.docDate, row.amount)]);
  const current = new Map<string, string[]>();
  for (const fact of active) {
    current.set(fact.sourceId, [...(current.get(fact.sourceId) ?? []), residualKey(fact.sourceLineId, fact.businessDate, Number(fact.costAmount))]);
  }
  return productIds.filter((productId) => {
    const next = [...(wanted.get(productId) ?? [])].sort();
    const now = [...(current.get(productId) ?? [])].sort();
    return next.length !== now.length || next.some((key, index) => key !== now[index]);
  });
}

async function createResidualFacts(tx: ProfitFactTx, productIds: string[], residuals: readonly StockValueResidual[]): Promise<void> {
  const rows = residuals.filter((row) => productIds.includes(row.productId));
  if (rows.length === 0) return;
  // Sequential: one transaction connection runs one query at a time.
  const cards = await tx.stockCard.findMany({ where: { id: { in: rows.map((row) => row.stockCardId) } }, select: { id: true, docNo: true } });
  const products = await tx.product.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.productId))] } },
    select: { id: true, code: true, name: true } });
  const docNoById = new Map(cards.map((card) => [card.id, card.docNo]));
  const productById = new Map(products.map((product) => [product.id, product]));
  for (const productId of [...new Set(rows.map((row) => row.productId))]) {
    const versionNo = await getNextVersion(tx, ProfitSourceType.STOCK_VALUE_RESIDUAL, productId);
    const product = productById.get(productId);
    await createFactProfitRows(tx, rows.filter((row) => row.productId === productId).map((row) => ({
      businessDate: row.docDate, sourceType: ProfitSourceType.STOCK_VALUE_RESIDUAL, sourceSubtype: row.source,
      sourceId: productId, sourceLineId: row.stockCardId, sourceDocNo: docNoById.get(row.stockCardId) ?? "-",
      sourceStatus: DocStatus.ACTIVE, versionNo, productId, productCode: product?.code ?? null, productName: product?.name ?? null,
      lineLabel: STOCK_VALUE_RESIDUAL_LABEL, quantity: 0, salesAmountExVat: 0, salesAmountIncVat: 0, salesAmount: 0,
      costAmount: row.amount, expenseAmount: 0, grossProfit: roundMoney(-row.amount), netProfitAmount: roundMoney(-row.amount),
      unitSalePriceExVat: 0, unitSalePriceIncVat: 0, unitSalePrice: 0, unitCostPrice: 0, unitProfit: 0, marginPct: 0,
    })));
  }
}

/**
 * T3: keeps a product's STOCK_VALUE_RESIDUAL facts equal to its written-off StockCard rows.
 * sourceId = productId and sourceLineId = StockCard id. One indexed read when nothing changed
 * (no residual now and none active before); otherwise the product's facts are superseded and
 * one fact per residual row is written (businessDate = row date, cost = residual, sales 0).
 */
export async function syncStockValueResidualFacts(tx: ProfitFactTx, productIdsInput: readonly string[],
  residuals: readonly StockValueResidual[]): Promise<void> {
  try {
    const productIds = [...new Set(productIdsInput.filter(Boolean))];
    if (productIds.length === 0) return;
    const active = await tx.factProfit.findMany({
      where: { sourceType: ProfitSourceType.STOCK_VALUE_RESIDUAL, sourceId: { in: productIds }, isActive: true },
      select: { sourceId: true, sourceLineId: true, businessDate: true, costAmount: true },
    });
    if (active.length === 0 && residuals.length === 0) return;
    const changed = findChangedResidualProducts(productIds, residuals, active);
    if (changed.length === 0) return;
    await tx.factProfit.updateMany({
      where: { sourceType: ProfitSourceType.STOCK_VALUE_RESIDUAL, sourceId: { in: changed }, isActive: true },
      data: { isActive: false, supersededAt: new Date() },
    });
    await createResidualFacts(tx, changed, residuals);
  } catch (error) {
    console.error("[syncStockValueResidualFacts]", error);
    throw error;
  }
}

/**
 * Rebuilds residual facts from the stored StockCard rows (append path and backfill). A negative value-only row's
 * write-off ("ปรับยอด DN" or ลดราคาซื้อ) is not stored on the row (its costVariance is the posted variance) and only a
 * replay can recompute it, so its current fact is carried over: an appended row never changes an earlier row's valuation.
 */
export async function rebuildStockValueResidualFactsForProducts(tx: ProfitFactTx, productIdsInput: readonly string[],
  since: Date): Promise<void> {
  try {
    const productIds = [...new Set(productIdsInput.filter(Boolean))];
    if (productIds.length === 0) return;
    const rows = await tx.stockCard.findMany({
      where: { productId: { in: productIds }, docDate: { gte: since }, source: { notIn: valueOnlyStockSources() }, costVariance: { not: 0 } },
      orderBy: [{ productId: "asc" }, { docDate: "asc" }, { sorder: "asc" }],
      select: { id: true, productId: true, docDate: true, source: true, costVariance: true },
    });
    const debitRows = await tx.factProfit.findMany({
      where: { sourceType: ProfitSourceType.STOCK_VALUE_RESIDUAL, sourceId: { in: productIds }, isActive: true,
        sourceSubtype: { in: valueOnlyStockSources() } },
      select: { sourceId: true, sourceSubtype: true, sourceLineId: true, businessDate: true, costAmount: true },
    });
    await syncStockValueResidualFacts(tx, productIds, [
      ...rows.map((row) => ({ stockCardId: row.id, productId: row.productId,
        docDate: row.docDate, source: row.source, amount: Number(row.costVariance) })),
      ...debitRows.filter((fact) => isValueOnlyStockSource(fact.sourceSubtype) && fact.sourceLineId).map((fact) => ({
        stockCardId: fact.sourceLineId ?? "", productId: fact.sourceId, docDate: fact.businessDate,
        source: fact.sourceSubtype ?? "SUPPLIER_DEBIT", amount: Number(fact.costAmount) })),
    ]);
  } catch (error) {
    console.error("[rebuildStockValueResidualFactsForProducts]", error);
    throw error;
  }
}

/** Fact subtype and dashboard label of a "ปรับยอด DN" document's cost variance (a regular DN is "SUPPLIER_DN"). */
export const SUPPLIER_DEBIT_ADJUSTMENT_FACT_SUBTYPE = "SUPPLIER_DN_ADJUSTMENT";
/**
 * V8 (W4): a DISCOUNT/OTHER purchase return's uncovered allowance is a PURCHASE_COST_VARIANCE fact with this subtype;
 * its sourceId is the purchase return (dashboard link /admin/purchase-returns/{id}).
 */
export const PURCHASE_ALLOWANCE_FACT_SUBTYPE = PURCHASE_ALLOWANCE_SOURCE;
export const isPurchaseAllowanceFactSubtype = (subtype: string | null | undefined): boolean =>
  subtype === PURCHASE_ALLOWANCE_FACT_SUBTYPE;
export const getSupplierDebitProfitLabel = (subtype: string | null | undefined): string => {
  if (isPurchaseAllowanceFactSubtype(subtype)) return PURCHASE_ALLOWANCE_LABEL;
  return subtype === SUPPLIER_DEBIT_ADJUSTMENT_FACT_SUBTYPE ? "ปรับยอด DN" : "Supplier DN";
};

/** Rebuild from the posted allocation snapshot; never allocate DN costs again. */
export async function rebuildSupplierDebitProfitFacts(tx: ProfitFactTx, debitNoteId: string): Promise<void> {
  try {
    const debit = await tx.supplierDebitNote.findUnique({
      where: { id: debitNoteId },
      select: { id: true, debitNo: true, postingDate: true, status: true, supplierId: true, adjustsDebitNoteId: true,
        supplier: { select: { name: true } }, purchase: { select: { purchaseNo: true } },
        items: { orderBy: { lineNo: "asc" }, select: { id: true, varianceAmount: true,
          productId: true, product: { select: { code: true, name: true } } } } },
    });
    if (!debit) return;
    await deactivateCurrentFacts(tx, ProfitSourceType.PURCHASE_COST_VARIANCE, debitNoteId);
    if (debit.status !== DocStatus.ACTIVE) return;
    const versionNo = await getNextVersion(tx, ProfitSourceType.PURCHASE_COST_VARIANCE, debitNoteId);
    const adjustment = Boolean(debit.adjustsDebitNoteId);
    const rows: FactProfitRowInput[] = debit.items.map((item) => {
      const variance = Number(item.varianceAmount);
      return { businessDate: debit.postingDate, sourceType: ProfitSourceType.PURCHASE_COST_VARIANCE,
        sourceSubtype: adjustment ? SUPPLIER_DEBIT_ADJUSTMENT_FACT_SUBTYPE : "SUPPLIER_DN", sourceId: debit.id,
        sourceLineId: item.id, sourceDocNo: debit.debitNo,
        referenceDocNo: debit.purchase.purchaseNo, sourceStatus: debit.status, versionNo,
        productId: item.productId, productCode: item.product.code, productName: item.product.name,
        supplierId: debit.supplierId, supplierName: debit.supplier.name,
        lineLabel: adjustment ? "ปรับยอด DN · ส่วนต่างต้นทุน" : "Supplier DN cost variance",
        quantity: 0, salesAmountExVat: 0, salesAmountIncVat: 0, salesAmount: 0, costAmount: variance,
        expenseAmount: 0, grossProfit: -variance, netProfitAmount: -variance,
        unitSalePriceExVat: 0, unitSalePriceIncVat: 0, unitSalePrice: 0, unitCostPrice: 0, unitProfit: 0, marginPct: 0 };
    });
    await createFactProfitRows(tx, rows);
  } catch (error) {
    console.error("[rebuildSupplierDebitProfitFacts]", error);
    throw error;
  }
}

/**
 * V8 (W1/W4): one PURCHASE_COST_VARIANCE fact per posted ลดราคาซื้อ row of a DISCOUNT/OTHER purchase return, dated at
 * the row's posting date, cost = the row's (negative) posted variance. Rebuilt from the stored rows, never re-allocated;
 * a cancelled return (whose rows are deleted) keeps no active fact.
 */
export async function rebuildPurchaseAllowanceProfitFacts(tx: ProfitFactTx, purchaseReturnId: string): Promise<void> {
  try {
    const purchaseReturn = await tx.purchaseReturn.findUnique({
      where: { id: purchaseReturnId },
      select: { id: true, returnNo: true, status: true, supplierId: true, supplier: { select: { name: true } },
        purchase: { select: { purchaseNo: true } } },
    });
    if (!purchaseReturn) return;
    await deactivateCurrentFacts(tx, ProfitSourceType.PURCHASE_COST_VARIANCE, purchaseReturnId);
    if (purchaseReturn.status !== DocStatus.ACTIVE) return;
    const rows = await tx.stockCard.findMany({
      where: { docNo: purchaseReturn.returnNo, source: PURCHASE_ALLOWANCE_SOURCE },
      orderBy: [{ docDate: "asc" }, { sorder: "asc" }],
      select: { id: true, docDate: true, referenceId: true, costVariance: true, productId: true,
        product: { select: { code: true, name: true } } },
    });
    if (rows.length === 0) return;
    const versionNo = await getNextVersion(tx, ProfitSourceType.PURCHASE_COST_VARIANCE, purchaseReturnId);
    await createFactProfitRows(tx, rows.map((row): FactProfitRowInput => {
      const variance = roundMoney(Number(row.costVariance));
      return { businessDate: row.docDate, sourceType: ProfitSourceType.PURCHASE_COST_VARIANCE,
        sourceSubtype: PURCHASE_ALLOWANCE_FACT_SUBTYPE, sourceId: purchaseReturn.id, sourceLineId: row.referenceId ?? row.id,
        sourceDocNo: purchaseReturn.returnNo, referenceDocNo: purchaseReturn.purchase?.purchaseNo ?? null,
        sourceStatus: purchaseReturn.status, versionNo, productId: row.productId, productCode: row.product.code,
        productName: row.product.name, supplierId: purchaseReturn.supplierId, supplierName: purchaseReturn.supplier?.name ?? null,
        lineLabel: `${PURCHASE_ALLOWANCE_LABEL} · ส่วนต่างต้นทุน`,
        quantity: 0, salesAmountExVat: 0, salesAmountIncVat: 0, salesAmount: 0, costAmount: variance,
        expenseAmount: 0, grossProfit: roundMoney(-variance), netProfitAmount: roundMoney(-variance),
        unitSalePriceExVat: 0, unitSalePriceIncVat: 0, unitSalePrice: 0, unitCostPrice: 0, unitProfit: 0, marginPct: 0 };
    }));
  } catch (error) {
    console.error("[rebuildPurchaseAllowanceProfitFacts]", error);
    throw error;
  }
}

export async function rebuildSaleProfitFacts(tx: ProfitFactTx, saleId: string): Promise<void> {
  const sale = await tx.sale.findUnique({
    where: { id: saleId },
    select: {
      id: true,
      saleNo: true,
      saleDate: true,
      status: true,
      channel: true,
      customerId: true,
      customerName: true,
      subtotalAmount: true,
      vatAmount: true,
      netAmount: true,
      customer: { select: { name: true } },
      discount: true,
      shippingFee: true,
      vatRate: true,
      vatType: true,
      items: {
        orderBy: { lineNo: "asc" },
        select: {
          id: true,
          productId: true,
          quantity: true,
          salePrice: true,
          costPrice: true,
          totalAmount: true,
          supplierId: true,
          supplierName: true,
          product: {
            select: {
              code: true,
              name: true,
            },
          },
        },
      },
    },
  });

  if (!sale) {
    return;
  }

  await deactivateCurrentFacts(tx, ProfitSourceType.SALE, saleId);
  if (sale.status !== DocStatus.ACTIVE || sale.items.length === 0) {
    return;
  }

  const versionNo = await getNextVersion(tx, ProfitSourceType.SALE, saleId);
  const revenue = allocateSaleProfitRevenue({
    itemAmounts: sale.items.map((item) => Number(item.totalAmount)),
    discount: Number(sale.discount),
    shippingFee: Number(sale.shippingFee),
    subtotalAmount: Number(sale.subtotalAmount),
    netAmount: Number(sale.netAmount),
  });
  const customerName = sale.customer?.name ?? sale.customerName ?? null;

  const rows: FactProfitRowInput[] = sale.items.map((item, index) => {
    const quantity = roundQty(Number(item.quantity));
    const salesAmountIncVat = revenue.items[index].incVat;
    const salesAmountExVat = revenue.items[index].exVat;
    const salesAmount = salesAmountExVat;
    const costAmount = roundMoney(quantity * Number(item.costPrice));
    const grossProfit = roundMoney(salesAmountExVat - costAmount);
    const unitSalePriceExVat = calcUnitPrice(salesAmountExVat, quantity);
    const unitSalePriceIncVat = calcUnitPrice(salesAmountIncVat, quantity);
    const unitSalePrice = unitSalePriceExVat;
    const unitCostPrice = roundMoney(Number(item.costPrice));
    const unitProfit =
      Math.abs(quantity) > 0.0001 ? roundMoney(grossProfit / Math.abs(quantity)) : 0;

    return {
      businessDate: sale.saleDate,
      sourceType: ProfitSourceType.SALE,
      sourceId: sale.id,
      sourceLineId: item.id,
      sourceDocNo: sale.saleNo,
      sourceStatus: sale.status,
      versionNo,
      productId: item.productId,
      productCode: item.product.code,
      productName: item.product.name,
      customerId: sale.customerId ?? null,
      customerName,
      supplierId: item.supplierId ?? null,
      supplierName: item.supplierName ?? null,
      lineLabel: item.product.name,
      quantity,
      salesAmountExVat,
      salesAmountIncVat,
      salesAmount,
      costAmount,
      expenseAmount: 0,
      grossProfit,
      netProfitAmount: grossProfit,
      unitSalePriceExVat,
      unitSalePriceIncVat,
      unitSalePrice,
      unitCostPrice,
      unitProfit,
      marginPct: calcMarginPct(grossProfit, salesAmount),
    };
  });

  if (revenue.shipping.incVat > 0) {
    const shippingRevenueIncVat = revenue.shipping.incVat;
    const shippingRevenueExVat = revenue.shipping.exVat;
    rows.push({
      businessDate: sale.saleDate,
      sourceType: ProfitSourceType.SALE,
      sourceId: sale.id,
      sourceLineId: `${sale.id}:shipping`,
      sourceDocNo: sale.saleNo,
      sourceStatus: sale.status,
      versionNo,
      customerId: sale.customerId ?? null,
      customerName,
      lineLabel: "ค่าจัดส่ง",
      quantity: 0,
      salesAmountExVat: shippingRevenueExVat,
      salesAmountIncVat: shippingRevenueIncVat,
      salesAmount: shippingRevenueExVat,
      costAmount: 0,
      expenseAmount: 0,
      grossProfit: shippingRevenueExVat,
      netProfitAmount: shippingRevenueExVat,
      unitSalePriceExVat: 0,
      unitSalePriceIncVat: 0,
      unitSalePrice: 0,
      unitCostPrice: 0,
      unitProfit: 0,
      marginPct: 0,
    });
  }

  // All rows belong to this sale → tag them with its channel (denormalized for
  // fast channel-split reporting without loading every sale id).
  for (const row of rows) row.channel = sale.channel;

  await createFactProfitRows(tx, rows);
}

export async function rebuildCreditNoteProfitFacts(
  tx: ProfitFactTx,
  creditNoteId: string,
): Promise<void> {
  const creditNote = await tx.creditNote.findUnique({
    where: { id: creditNoteId },
    select: {
      id: true,
      cnNo: true,
      cnDate: true,
      status: true,
      type: true,
      saleId: true,
      channel: true,
      totalAmount: true,
      subtotalAmount: true,
      customerId: true,
      customerName: true,
      sale: {
        select: {
          saleNo: true,
          channel: true,
          items: {
            orderBy: { lineNo: "asc" },
            select: {
              id: true,
              productId: true,
              quantity: true,
              costPrice: true,
            },
          },
        },
      },
      customer: { select: { name: true } },
      items: {
        orderBy: { lineNo: "asc" },
        select: {
          id: true,
          saleItemId: true,
          productId: true,
          qty: true,
          amount: true,
          unitPrice: true,
          stockDisposition: true,
          product: {
            select: {
              code: true,
              name: true,
              avgCost: true,
            },
          },
        },
      },
    },
  });

  if (!creditNote) {
    return;
  }

  await deactivateCurrentFacts(tx, ProfitSourceType.SALE_RETURN, creditNoteId);
  if (creditNote.status !== DocStatus.ACTIVE || creditNote.items.length === 0) {
    return;
  }

  // Every CN type reduces revenue on cnDate; only RETURN also returns quantity and cost.
  const isValueOnly = isValueOnlyCreditNoteType(creditNote.type);
  const versionNo = await getNextVersion(tx, ProfitSourceType.SALE_RETURN, creditNoteId);
  const totalRevenueExVat = roundMoney(Number(creditNote.subtotalAmount));
  const totalRevenueIncVat = roundMoney(Number(creditNote.totalAmount));
  const itemWeights = creditNote.items.map((item) => Number(item.amount));
  // Satang allocation shared with SALE facts: base and VAT are split separately, so each
  // line's inclusive amount is its base plus tax and no residual line flips sign.
  const allocatedRevenueExVat = allocateMoneyByWeights(totalRevenueExVat, itemWeights);
  const allocatedVat = allocateMoneyByWeights(
    roundMoney(totalRevenueIncVat - totalRevenueExVat),
    itemWeights,
  );
  const allocatedRevenueIncVat = allocatedRevenueExVat.map((base, index) =>
    roundMoney(base + (allocatedVat[index] ?? 0)),
  );
  const saleCostMap = buildWeightedSaleCostMap(
    (creditNote.sale?.items ?? []).map((item) => ({
      productId: item.productId,
      quantity: Number(item.quantity),
      costPrice: Number(item.costPrice),
    })),
  );
  const saleItemCostMap = new Map(
    (creditNote.sale?.items ?? []).map((item) => [item.id, Number(item.costPrice)]),
  );
  const customerName = creditNote.customer?.name ?? creditNote.customerName ?? null;

  const rows: FactProfitRowInput[] = creditNote.items.map((item, index) => {
    const quantityAbs = isValueOnly ? 0 : roundQty(Number(item.qty));
    const quantity = roundQty(-quantityAbs);
    const salesAmountExVat = roundMoney(-(allocatedRevenueExVat[index] ?? 0));
    const salesAmountIncVat = roundMoney(-(allocatedRevenueIncVat[index] ?? 0));
    const salesAmount = salesAmountExVat;
    const reversesStockCost =
      creditNote.type === CreditNoteType.RETURN &&
      returnDispositionReversesStockCost(item.stockDisposition);
    const resolvedCost =
      reversesStockCost
        ? resolveReturnUnitCost({
            saleItemId: item.saleItemId,
            productId: item.productId,
            saleItemCostById: saleItemCostMap,
            productCostById: saleCostMap,
            fallbackCost: roundMoney(Number(item.product?.avgCost ?? 0)),
          }) ?? 0
        : 0;
    const costAmount =
      reversesStockCost
        ? roundMoney(-(quantityAbs * resolvedCost))
        : 0;
    const grossProfit = roundMoney(salesAmountExVat - costAmount);
    const unitSalePriceExVat = calcUnitPrice(salesAmountExVat, quantity);
    const unitSalePriceIncVat = calcUnitPrice(salesAmountIncVat, quantity);
    const unitSalePrice = unitSalePriceExVat;
    const unitCostPrice = roundMoney(resolvedCost);
    const unitProfit =
      Math.abs(quantity) > 0.0001 ? roundMoney(grossProfit / Math.abs(quantity)) : 0;

    return {
      businessDate: creditNote.cnDate,
      sourceType: ProfitSourceType.SALE_RETURN,
      sourceSubtype: creditNote.type,
      sourceId: creditNote.id,
      sourceLineId: item.id,
      sourceDocNo: creditNote.cnNo,
      referenceDocNo: creditNote.sale?.saleNo ?? null,
      sourceStatus: creditNote.status,
      versionNo,
      productId: item.productId ?? null,
      productCode: item.product?.code ?? null,
      productName: item.product?.name ?? null,
      customerId: creditNote.customerId ?? null,
      customerName,
      lineLabel: item.product?.name ?? (isValueOnly ? getCreditNoteProfitLabel(creditNote.type) : null),
      quantity,
      salesAmountExVat,
      salesAmountIncVat,
      salesAmount,
      costAmount,
      expenseAmount: 0,
      grossProfit,
      netProfitAmount: grossProfit,
      unitSalePriceExVat,
      unitSalePriceIncVat,
      unitSalePrice,
      unitCostPrice,
      unitProfit,
      marginPct: calcMarginPct(grossProfit, salesAmount),
    };
  });

  // ยอดคืนต้องถูกหักออกจากกำไรของช่องทางเดียวกับใบขายต้นทาง ไม่งั้นรายงานแยกช่องทาง
  // จะเห็นแต่ยอดขาย ทำให้กำไรขั้นต้นสูงเกินจริงเท่ากับยอดที่คืนไปทั้งจำนวน
  const channel = creditNote.channel ?? creditNote.sale?.channel ?? null;
  for (const row of rows) row.channel = channel;

  await createFactProfitRows(tx, rows);
}

type ExpenseProfitAmountSource = {
  vatType: string;
  vatRate: Prisma.Decimal;
  taxInvoiceDate: Date | null;
  subtotalAmount: Prisma.Decimal;
  netAmount: Prisma.Decimal;
};

/**
 * V7 (lib/input-vat.ts): recoverable input VAT is input tax, not expense, so the expense counts subtotalAmount;
 * otherwise every baht paid (netAmount), VAT included, is expense. Without a tax-invoice date nothing is
 * recoverable, so the registration setting is read only when the expense has one.
 */
async function resolveExpenseProfitAmount(tx: ProfitFactTx, expense: ExpenseProfitAmountSource): Promise<number> {
  try {
    const registeredFrom = expense.taxInvoiceDate ? await getVatRegisteredFrom(tx) : null;
    const recoverable = isInputVatRecoverable({ vatType: expense.vatType, vatRate: Number(expense.vatRate),
      taxDocumentDate: expense.taxInvoiceDate, registeredFrom });
    return Number(recoverable ? expense.subtotalAmount : expense.netAmount);
  } catch (error) {
    throw new Error("Failed to resolve the expense profit amount", { cause: error });
  }
}

export async function rebuildExpenseProfitFacts(
  tx: ProfitFactTx,
  expenseId: string,
): Promise<void> {
  const expense = await tx.expense.findUnique({
    where: { id: expenseId },
    select: {
      id: true,
      expenseNo: true,
      expenseDate: true,
      status: true,
      channel: true,
      netAmount: true,
      subtotalAmount: true,
      vatType: true,
      vatRate: true,
      taxInvoiceDate: true,
      items: {
        orderBy: { lineNo: "asc" },
        select: {
          id: true,
          amount: true,
          description: true,
          expenseCodeId: true,
          expenseCode: {
            select: {
              code: true,
              name: true,
            },
          },
        },
      },
    },
  });

  if (!expense) {
    return;
  }

  await deactivateCurrentFacts(tx, ProfitSourceType.EXPENSE, expenseId);
  if (expense.status !== DocStatus.ACTIVE || expense.items.length === 0) {
    return;
  }

  const versionNo = await getNextVersion(tx, ProfitSourceType.EXPENSE, expenseId);
  const totalExpense = await resolveExpenseProfitAmount(tx, expense);
  const itemWeights = expense.items.map((item) => Number(item.amount));
  const allocatedExpense = allocateByWeights(totalExpense, itemWeights);

  const rows: FactProfitRowInput[] = expense.items.map((item, index) => {
    const expenseAmount = roundMoney(allocatedExpense[index] ?? 0);
    const lineLabel = item.description?.trim()
      ? item.description.trim()
      : `${item.expenseCode.code} ${item.expenseCode.name}`;

    return {
      businessDate: expense.expenseDate,
      sourceType: ProfitSourceType.EXPENSE,
      sourceId: expense.id,
      sourceLineId: item.id,
      sourceDocNo: expense.expenseNo,
      sourceStatus: expense.status,
      channel: expense.channel,
      versionNo,
      supplierId: null,
      supplierName: null,
      lineLabel,
      quantity: 0,
      salesAmountExVat: 0,
      salesAmountIncVat: 0,
      salesAmount: 0,
      costAmount: 0,
      expenseAmount,
      grossProfit: 0,
      netProfitAmount: roundMoney(-expenseAmount),
      unitSalePriceExVat: 0,
      unitSalePriceIncVat: 0,
      unitSalePrice: 0,
      unitCostPrice: 0,
      unitProfit: 0,
      marginPct: 0,
    };
  });

  await createFactProfitRows(tx, rows);
}

/**
 * เขียน FactProfit ของรอบรับเงิน marketplace (ค่าธรรมเนียม + รายรับพิเศษ)
 *
 * ค่าธรรมเนียมถูกปันกลับไปยังใบขายแต่ละใบตามสัดส่วนยอดขาย และลงวันที่เป็น "วันที่ขาย"
 * ของใบนั้น ไม่ใช่วันที่เงินเข้า — ขายสิ้นเดือนแต่แพลตฟอร์มโอนเดือนถัดไปจึงไม่ทำให้
 * กำไรเดือนที่ขายพองเกินและกำไรเดือนที่รับเงินหดผิดปกติ (matching principle)
 *
 * ยกเว้น (owner decision P2 = B): ถ้าเดือนที่ขายประกาศปันผลแล้วก่อนบันทึกรอบนี้
 * (ProfitDistribution ที่มีผลอยู่ ณ เวลาบันทึกรอบ: declaredAt <= createdAt และยังใช้งานอยู่ หรือถูกยกเลิกหลัง createdAt) ส่วนของใบขายนั้นลง
 * "วันที่รับเงิน" แทน เพื่อไม่ให้กำไรของเดือนที่ปันผลแล้วเปลี่ยน — ดู
 * lib/marketplace/settlement-fee-dating.ts กติกาอ่านเฉพาะเวลาที่บันทึกไว้ การ rebuild
 * ภายหลัง (ยกเลิก / backfill) จึงได้วันที่เดิมเสมอ
 *
 * เพราะฟังก์ชันนี้เป็นผู้เขียน EXPENSE facts ของใบค่าธรรมเนียมเอง จึงต้องไม่เรียก
 * rebuildExpenseProfitFacts() กับใบเดียวกัน มิฉะนั้นวันที่จะถูกเขียนทับกลับไปเป็น
 * expenseDate และการปันตามใบขายจะหายไป
 *
 * รายรับพิเศษ (subsidy / bonus / ชดเชย) บันทึกเป็น OTHER_INCOME แยกจากยอดขาย
 * เพื่อให้เข้ากำไรสุทธิเต็มจำนวนโดยไม่ไปเพิ่มฐานยอดขายจนทำให้ %margin เพี้ยน
 *
 * คืนค่าส่วนที่ลงวันที่รับเงินแทนวันที่ขาย (ใช้ใน audit) หรือ null เมื่อรอบไม่ ACTIVE
 */
export async function rebuildMarketplaceSettlementProfitFacts(
  tx: ProfitFactTx,
  settlementId: string,
): Promise<SettlementFactDating | null> {
  try {
    return await writeMarketplaceSettlementProfitFacts(tx, settlementId);
  } catch (error) {
    throw new Error("Failed to rebuild marketplace settlement profit facts", { cause: error });
  }
}

/** A fee / income share below half a satang writes no fact. */
const SETTLEMENT_SHARE_EPSILON = 0.005;

const SETTLEMENT_ZERO_FIELDS = {
  quantity: 0,
  salesAmountExVat: 0,
  salesAmountIncVat: 0,
  salesAmount: 0,
  costAmount: 0,
  grossProfit: 0,
  unitSalePriceExVat: 0,
  unitSalePriceIncVat: 0,
  unitSalePrice: 0,
  unitCostPrice: 0,
  unitProfit: 0,
  marginPct: 0,
};

/** One sale's share of a settlement's fee and platform income, and the date it is booked on. */
export type MarketplaceSettlementFactTarget = {
  businessDate: Date;
  referenceDocNo: string | null;
  feeAmount: number;
  incomeAmount: number;
};

export type MarketplaceSettlementFactPlan = {
  targets: MarketplaceSettlementFactTarget[];
  dating: SettlementFactDating;
};

/**
 * Pure. Splits the fee and the platform income over the settlement's sales by sale amount
 * (satang remainder on the last sale). A share is dated at its sale date unless that month was
 * already distributed when the settlement was recorded (P2 = B) — then at the settlement date.
 * A settlement without sales books everything on the settlement date.
 */
export function planMarketplaceSettlementFacts(input: {
  settlementDate: Date;
  recordedAt: Date;
  feeAmount: number;
  incomeAmount: number;
  saleLines: ReadonlyArray<{ docNo: string; docDate: Date; amount: number }>;
  distributions: ReadonlyMap<string, MonthDistribution>;
}): MarketplaceSettlementFactPlan {
  const { settlementDate, recordedAt, saleLines, distributions } = input;
  const feeAmount = roundMoney(input.feeAmount);
  const incomeAmount = roundMoney(input.incomeAmount);
  // รอบที่ไม่มีใบขายเลย (เช่น รอบที่มีแต่ใบคืนกับค่าปรับ) ไม่มีวันขายให้ปันกลับ
  // จึงรับรู้ที่วันที่ของรอบรับเงินแทน
  if (saleLines.length === 0) {
    return {
      targets: [{ businessDate: settlementDate, referenceDocNo: null, feeAmount, incomeAmount }],
      dating: { settlementDate, moved: [] },
    };
  }

  const weights = saleLines.map((line) => line.amount);
  const feeShares = feeAmount > 0 ? allocateByWeights(feeAmount, weights) : [];
  const incomeShares = incomeAmount > 0 ? allocateByWeights(incomeAmount, weights) : [];
  const moved: SettlementMovedAmount[] = [];
  const targets = saleLines.map((line, index): MarketplaceSettlementFactTarget => {
    const fee = roundMoney(feeShares[index] ?? 0);
    const income = roundMoney(incomeShares[index] ?? 0);
    const lockedBy = findDistributionLockingAtRecording(distributions, line.docDate, recordedAt);
    const hasShare = Math.abs(fee) >= SETTLEMENT_SHARE_EPSILON || Math.abs(income) >= SETTLEMENT_SHARE_EPSILON;
    if (lockedBy && hasShare) {
      moved.push({
        docNo: line.docNo,
        docDate: line.docDate,
        periodKey: lockedBy.periodKey,
        distributionNo: lockedBy.distributionNo,
        feeAmount: fee,
        incomeAmount: income,
      });
    }
    return {
      businessDate: lockedBy ? settlementDate : line.docDate,
      referenceDocNo: line.docNo,
      feeAmount: fee,
      incomeAmount: income,
    };
  });
  return { targets, dating: { settlementDate, moved } };
}

type SettlementFactHeader = {
  id: string;
  settlementNo: string;
  channel: SaleChannel;
  expense: { expenseNo: string } | null;
};

function buildSettlementFeeRows(
  settlement: SettlementFactHeader,
  expenseId: string,
  targets: MarketplaceSettlementFactTarget[],
  versionNo: number,
): FactProfitRowInput[] {
  return targets.flatMap((target, index): FactProfitRowInput[] =>
    Math.abs(target.feeAmount) < SETTLEMENT_SHARE_EPSILON
      ? []
      : [{
          ...SETTLEMENT_ZERO_FIELDS,
          businessDate: target.businessDate,
          sourceType: ProfitSourceType.EXPENSE,
          sourceSubtype: "MARKETPLACE_FEE",
          sourceId: expenseId,
          sourceLineId: `${settlement.id}:fee:${index}`,
          sourceDocNo: settlement.expense?.expenseNo ?? settlement.settlementNo,
          referenceDocNo: target.referenceDocNo,
          sourceStatus: DocStatus.ACTIVE,
          channel: settlement.channel,
          versionNo,
          lineLabel: "ค่าธรรมเนียมช่องทางขาย",
          expenseAmount: target.feeAmount,
          netProfitAmount: roundMoney(-target.feeAmount),
        }],
  );
}

function buildSettlementIncomeRows(
  settlement: SettlementFactHeader,
  targets: MarketplaceSettlementFactTarget[],
  versionNo: number,
): FactProfitRowInput[] {
  return targets.flatMap((target, index): FactProfitRowInput[] =>
    Math.abs(target.incomeAmount) < SETTLEMENT_SHARE_EPSILON
      ? []
      : [{
          ...SETTLEMENT_ZERO_FIELDS,
          businessDate: target.businessDate,
          sourceType: ProfitSourceType.OTHER_INCOME,
          sourceSubtype: "MARKETPLACE_INCOME",
          sourceId: settlement.id,
          sourceLineId: `${settlement.id}:income:${index}`,
          sourceDocNo: settlement.settlementNo,
          referenceDocNo: target.referenceDocNo,
          sourceStatus: DocStatus.ACTIVE,
          channel: settlement.channel,
          versionNo,
          lineLabel: "รายรับพิเศษจากช่องทางขาย",
          expenseAmount: 0,
          netProfitAmount: target.incomeAmount,
        }],
  );
}

async function writeMarketplaceSettlementProfitFacts(
  tx: ProfitFactTx,
  settlementId: string,
): Promise<SettlementFactDating | null> {
  const settlement = await tx.marketplaceSettlement.findUnique({
    where: { id: settlementId },
    select: {
      id: true,
      settlementNo: true,
      settlementDate: true,
      createdAt: true,
      status: true,
      channel: true,
      expenseId: true,
      feeAmount: true,
      incomeAmount: true,
      expense: { select: { expenseNo: true } },
      lines: {
        where: { docType: MarketplaceSettlementDocType.SALE },
        orderBy: SETTLEMENT_SALE_LINE_ORDER,
        select: { docNo: true, docDate: true, amount: true },
      },
    },
  });

  if (!settlement) {
    return null;
  }

  if (settlement.expenseId) {
    await deactivateCurrentFacts(tx, ProfitSourceType.EXPENSE, settlement.expenseId);
  }
  await deactivateCurrentFacts(tx, ProfitSourceType.OTHER_INCOME, settlement.id);

  if (settlement.status !== DocStatus.ACTIVE) {
    return null;
  }

  const { expenseId } = settlement;
  // Only a fee with its Expense writes fee facts.
  const feeAmount = expenseId ? roundMoney(Number(settlement.feeAmount)) : 0;
  const incomeAmount = roundMoney(Number(settlement.incomeAmount));
  if (feeAmount <= 0 && incomeAmount <= 0) {
    return { settlementDate: settlement.settlementDate, moved: [] };
  }

  const saleLines = settlement.lines.map((line) => ({
    docNo: line.docNo,
    docDate: line.docDate,
    amount: Number(line.amount),
  }));
  const plan = planMarketplaceSettlementFacts({
    settlementDate: settlement.settlementDate,
    recordedAt: settlement.createdAt,
    feeAmount,
    incomeAmount,
    saleLines,
    distributions: await loadMonthDistributions(tx, saleLines.map((line) => line.docDate)),
  });

  const rows: FactProfitRowInput[] = [];
  if (feeAmount > 0 && expenseId) {
    const versionNo = await getNextVersion(tx, ProfitSourceType.EXPENSE, expenseId);
    rows.push(...buildSettlementFeeRows(settlement, expenseId, plan.targets, versionNo));
  }
  if (incomeAmount > 0) {
    const versionNo = await getNextVersion(tx, ProfitSourceType.OTHER_INCOME, settlement.id);
    rows.push(...buildSettlementIncomeRows(settlement, plan.targets, versionNo));
  }

  await createFactProfitRows(tx, rows);
  return plan.dating;
}
