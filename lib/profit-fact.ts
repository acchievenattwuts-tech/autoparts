import { db } from "@/lib/db";
import { Prisma, CreditNoteType, DocStatus, ProfitSourceType } from "@/lib/generated/prisma";

type ProfitFactTx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

type FactProfitRowInput = {
  businessDate: Date;
  sourceType: ProfitSourceType;
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

export async function rebuildSaleProfitFacts(tx: ProfitFactTx, saleId: string): Promise<void> {
  const sale = await tx.sale.findUnique({
    where: { id: saleId },
    select: {
      id: true,
      saleNo: true,
      saleDate: true,
      status: true,
      customerId: true,
      customerName: true,
      subtotalAmount: true,
      vatAmount: true,
      customer: { select: { name: true } },
      netAmount: true,
      items: {
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
  const totalRevenueExVat = roundMoney(Number(sale.subtotalAmount));
  const totalRevenueIncVat = roundMoney(Number(sale.netAmount));
  const itemWeights = sale.items.map((item) => Number(item.totalAmount));
  const allocatedRevenueExVat = allocateByWeights(totalRevenueExVat, itemWeights);
  const allocatedRevenueIncVat = allocateByWeights(totalRevenueIncVat, itemWeights);
  const customerName = sale.customer?.name ?? sale.customerName ?? null;

  const rows: FactProfitRowInput[] = sale.items.map((item, index) => {
    const quantity = roundQty(Number(item.quantity));
    const salesAmountExVat = roundMoney(allocatedRevenueExVat[index] ?? 0);
    const salesAmountIncVat = roundMoney(allocatedRevenueIncVat[index] ?? 0);
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
      totalAmount: true,
      subtotalAmount: true,
      customerId: true,
      customerName: true,
      sale: {
        select: {
          saleNo: true,
          items: {
            select: {
              productId: true,
              quantity: true,
              costPrice: true,
            },
          },
        },
      },
      customer: { select: { name: true } },
      items: {
        select: {
          id: true,
          productId: true,
          qty: true,
          amount: true,
          unitPrice: true,
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
  if (
    creditNote.status !== DocStatus.ACTIVE ||
    creditNote.type !== CreditNoteType.RETURN ||
    creditNote.items.length === 0
  ) {
    return;
  }

  const versionNo = await getNextVersion(tx, ProfitSourceType.SALE_RETURN, creditNoteId);
  const totalRevenueExVat = roundMoney(Number(creditNote.subtotalAmount));
  const totalRevenueIncVat = roundMoney(Number(creditNote.totalAmount));
  const itemWeights = creditNote.items.map((item) => Number(item.amount));
  const allocatedRevenueExVat = allocateByWeights(totalRevenueExVat, itemWeights);
  const allocatedRevenueIncVat = allocateByWeights(totalRevenueIncVat, itemWeights);
  const saleCostMap = buildWeightedSaleCostMap(
    (creditNote.sale?.items ?? []).map((item) => ({
      productId: item.productId,
      quantity: Number(item.quantity),
      costPrice: Number(item.costPrice),
    })),
  );
  const customerName = creditNote.customer?.name ?? creditNote.customerName ?? null;

  const rows: FactProfitRowInput[] = creditNote.items.map((item, index) => {
    const quantityAbs = roundQty(Number(item.qty));
    const quantity = roundQty(-quantityAbs);
    const salesAmountExVat = roundMoney(-(allocatedRevenueExVat[index] ?? 0));
    const salesAmountIncVat = roundMoney(-(allocatedRevenueIncVat[index] ?? 0));
    const salesAmount = salesAmountExVat;
    const resolvedCost =
      creditNote.type === CreditNoteType.RETURN
        ? saleCostMap.get(item.productId ?? "") ?? roundMoney(Number(item.product?.avgCost ?? 0))
        : 0;
    const costAmount =
      creditNote.type === CreditNoteType.RETURN
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
      lineLabel: item.product?.name ?? null,
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

  await createFactProfitRows(tx, rows);
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
      netAmount: true,
      items: {
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
  const totalExpense = Number(expense.netAmount);
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
