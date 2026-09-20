import { db } from "@/lib/db";
import {
  CreditNoteType,
  DocStatus,
  ProfitSourceType,
  SaleChannel,
  type Prisma,
} from "@/lib/generated/prisma";
import {
  formatDateOnlyForInput,
  getThailandDateKey,
  getThailandMonthStartDateKey,
  isDateOnlyString,
  parseDateOnlyToEndOfDay,
  parseDateOnlyToStartOfDay,
} from "@/lib/th-date";

const SCREEN_DETAIL_LIMIT = 500;
const SCREEN_BILL_LIMIT = 500;
export const SALES_LINE_PROFIT_EXPORT_LIMIT = 10_000;

type SupportedSourceType = "SALE" | "SALE_RETURN";
type SupportedChannel = "ALL" | "STORE" | "SHOPEE" | "LAZADA";
type SupportedStatus = "ACTIVE" | "CANCELLED";

export type SalesLineProfitFilters = {
  from: Date;
  to: Date;
  fromStr: string;
  toStr: string;
  channel: SupportedChannel;
  customerIds: string[];
  categoryId?: string;
  productCodeFrom?: string;
  productCodeTo?: string;
  productIds: string[];
  status: SupportedStatus;
  includeReturns: boolean;
};

export type SalesBillProfitRow = {
  sourceType: SupportedSourceType;
  sourceId: string;
  docNo: string;
  referenceDocNo: string | null;
  docDate: Date;
  customerName: string;
  channel: SaleChannel;
  quantity: number;
  netSalesIncVat: number;
  netSalesExVat: number;
  costAmount: number;
  grossProfit: number;
  marginPct: number;
  billDiscount: number;
  href: string;
};

export type SalesLineProfitRow = {
  sourceType: SupportedSourceType;
  sourceId: string;
  sourceLineId: string;
  docNo: string;
  referenceDocNo: string | null;
  docDate: Date;
  customerName: string;
  channel: SaleChannel;
  productCode: string;
  productName: string;
  quantity: number;
  unitName: string;
  unitListPrice: number | null;
  amountBeforeLineDiscount: number | null;
  lineDiscount: number | null;
  amountAfterLineDiscount: number;
  allocatedBillDiscount: number | null;
  netSalesIncVat: number;
  netSalesExVat: number;
  costAmount: number;
  grossProfit: number;
  marginPct: number;
  href: string;
};

export type SalesLineProfitTotals = {
  amountBeforeLineDiscount: number | null;
  lineDiscount: number | null;
  amountAfterLineDiscount: number | null;
  allocatedBillDiscount: number | null;
  shippingAmountIncVat: number;
  netSalesIncVat: number;
  netSalesExVat: number;
  costAmount: number;
  grossProfit: number;
  marginPct: number;
};

export type SalesLineProfitData = {
  bills: SalesBillProfitRow[];
  lines: SalesLineProfitRow[];
  totals: SalesLineProfitTotals;
  totalLineCount: number;
  billRowsTruncated: boolean;
  lineRowsTruncated: boolean;
};

const EMPTY_TOTALS: SalesLineProfitTotals = {
  amountBeforeLineDiscount: null,
  lineDiscount: null,
  amountAfterLineDiscount: null,
  allocatedBillDiscount: null,
  shippingAmountIncVat: 0,
  netSalesIncVat: 0,
  netSalesExVat: 0,
  costAmount: 0,
  grossProfit: 0,
  marginPct: 0,
};

const EMPTY_FACT_SUMS = {
  salesAmountIncVat: 0,
  salesAmountExVat: 0,
  costAmount: 0,
  grossProfit: 0,
};

function splitIds(value: string | undefined): string[] {
  return [...new Set((value ?? "").split(",").map((item) => item.trim()).filter(Boolean))].slice(
    0,
    100,
  );
}

function parseDateKey(value: string | undefined, fallback: string): string {
  return value && isDateOnlyString(value) ? value : fallback;
}

export function parseSalesLineProfitFilters(
  params: Record<string, string | undefined>,
): SalesLineProfitFilters {
  const today = getThailandDateKey();
  const fromStr = parseDateKey(params.from, getThailandMonthStartDateKey());
  const toStr = parseDateKey(params.to, today);
  const channel = (["STORE", "SHOPEE", "LAZADA"] as const).includes(
    params.channel as "STORE" | "SHOPEE" | "LAZADA",
  )
    ? (params.channel as Exclude<SupportedChannel, "ALL">)
    : "ALL";

  return {
    from: parseDateOnlyToStartOfDay(fromStr),
    to: parseDateOnlyToEndOfDay(toStr),
    fromStr,
    toStr,
    channel,
    customerIds: splitIds(params.customerIds),
    categoryId: params.categoryId?.trim() || undefined,
    productCodeFrom: params.productCodeFrom?.trim() || undefined,
    productCodeTo: params.productCodeTo?.trim() || undefined,
    productIds: splitIds(params.productIds),
    status: params.status === "CANCELLED" ? "CANCELLED" : "ACTIVE",
    includeReturns: params.includeReturns !== "0",
  };
}

export function buildSalesLineProfitQuery(filters: SalesLineProfitFilters): string {
  const params = new URLSearchParams({
    from: filters.fromStr,
    to: filters.toStr,
    channel: filters.channel,
    status: filters.status,
    includeReturns: filters.includeReturns ? "1" : "0",
  });
  if (filters.customerIds.length > 0) params.set("customerIds", filters.customerIds.join(","));
  if (filters.categoryId) params.set("categoryId", filters.categoryId);
  if (filters.productCodeFrom) params.set("productCodeFrom", filters.productCodeFrom);
  if (filters.productCodeTo) params.set("productCodeTo", filters.productCodeTo);
  if (filters.productIds.length > 0) params.set("productIds", filters.productIds.join(","));
  return params.toString();
}

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const number = (value: Prisma.Decimal | number | null | undefined): number => Number(value ?? 0);

function activeFactWhere(filters: SalesLineProfitFilters): Prisma.FactProfitWhereInput {
  return {
    isActive: true,
    sourceStatus: "ACTIVE",
    sourceType: {
      in: filters.includeReturns
        ? [ProfitSourceType.SALE, ProfitSourceType.SALE_RETURN]
        : [ProfitSourceType.SALE],
    },
    businessDate: { gte: filters.from, lte: filters.to },
    ...(filters.channel === "ALL" ? {} : { channel: filters.channel }),
    ...(filters.customerIds.length > 0 ? { customerId: { in: filters.customerIds } } : {}),
  };
}

function channelWhere(channel: SupportedChannel): Prisma.EnumSaleChannelFilter | undefined {
  return channel === "ALL" ? undefined : { equals: channel };
}

function groupLatestVersions(
  rows: Array<{
    sourceType: ProfitSourceType;
    sourceId: string;
    _max: { versionNo: number | null };
  }>,
): Prisma.FactProfitWhereInput[] {
  const groups = new Map<string, { sourceType: ProfitSourceType; versionNo: number; ids: string[] }>();
  for (const row of rows) {
    if (row._max.versionNo === null) continue;
    const key = `${row.sourceType}:${row._max.versionNo}`;
    const group = groups.get(key) ?? {
      sourceType: row.sourceType,
      versionNo: row._max.versionNo,
      ids: [],
    };
    group.ids.push(row.sourceId);
    groups.set(key, group);
  }
  return Array.from(groups.values()).map((group) => ({
    sourceType: group.sourceType,
    versionNo: group.versionNo,
    sourceId: { in: group.ids },
  }));
}

async function cancelledFactWhere(
  filters: SalesLineProfitFilters,
): Promise<{ where: Prisma.FactProfitWhereInput; truncated: boolean }> {
  const customerFilter =
    filters.customerIds.length > 0 ? { customerId: { in: filters.customerIds } } : {};
  const resolvedChannelWhere = channelWhere(filters.channel);
  const [sales, creditNotes] = await Promise.all([
    db.sale.findMany({
      where: {
        status: DocStatus.CANCELLED,
        saleDate: { gte: filters.from, lte: filters.to },
        ...customerFilter,
        ...(resolvedChannelWhere ? { channel: resolvedChannelWhere } : {}),
      },
      select: { id: true },
      take: SALES_LINE_PROFIT_EXPORT_LIMIT + 1,
    }),
    filters.includeReturns
      ? db.creditNote.findMany({
          where: {
            status: DocStatus.CANCELLED,
            type: CreditNoteType.RETURN,
            cnDate: { gte: filters.from, lte: filters.to },
            ...customerFilter,
            ...(resolvedChannelWhere ? { channel: resolvedChannelWhere } : {}),
          },
          select: { id: true },
          take: SALES_LINE_PROFIT_EXPORT_LIMIT + 1,
        })
      : Promise.resolve([]),
  ]);
  const truncated =
    sales.length > SALES_LINE_PROFIT_EXPORT_LIMIT ||
    creditNotes.length > SALES_LINE_PROFIT_EXPORT_LIMIT;
  const sourceScope = documentScopeWhere([
    ...sales.slice(0, SALES_LINE_PROFIT_EXPORT_LIMIT).map((sale) => ({
      sourceType: ProfitSourceType.SALE,
      sourceId: sale.id,
    })),
    ...creditNotes.slice(0, SALES_LINE_PROFIT_EXPORT_LIMIT).map((creditNote) => ({
      sourceType: ProfitSourceType.SALE_RETURN,
      sourceId: creditNote.id,
    })),
  ]);
  if (!sourceScope.OR || sourceScope.OR.length === 0) {
    return { where: { sourceId: { in: [] } }, truncated };
  }

  const latestVersions = await db.factProfit.groupBy({
    by: ["sourceType", "sourceId"],
    where: sourceScope,
    _max: { versionNo: true },
  });
  const versionScope = groupLatestVersions(latestVersions);
  return {
    where: versionScope.length > 0 ? { OR: versionScope } : { sourceId: { in: [] } },
    truncated,
  };
}

async function baseFactWhere(
  filters: SalesLineProfitFilters,
): Promise<{ where: Prisma.FactProfitWhereInput; truncated: boolean }> {
  return filters.status === "CANCELLED"
    ? cancelledFactWhere(filters)
    : { where: activeFactWhere(filters), truncated: false };
}

async function resolveProductScope(
  filters: SalesLineProfitFilters,
): Promise<{ ids: string[]; truncated: boolean } | null> {
  const hasScope = Boolean(
    filters.categoryId ||
      filters.productCodeFrom ||
      filters.productCodeTo ||
      filters.productIds.length > 0,
  );
  if (!hasScope) return null;

  const products = await db.product.findMany({
    where: {
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.productIds.length > 0 ? { id: { in: filters.productIds } } : {}),
      ...(filters.productCodeFrom || filters.productCodeTo
        ? {
            code: {
              ...(filters.productCodeFrom ? { gte: filters.productCodeFrom } : {}),
              ...(filters.productCodeTo ? { lte: filters.productCodeTo } : {}),
            },
          }
        : {}),
    },
    select: { id: true },
    take: SALES_LINE_PROFIT_EXPORT_LIMIT + 1,
  });
  return {
    ids: products.slice(0, SALES_LINE_PROFIT_EXPORT_LIMIT).map((product) => product.id),
    truncated: products.length > SALES_LINE_PROFIT_EXPORT_LIMIT,
  };
}

function documentScopeWhere(
  documents: Array<{ sourceType: ProfitSourceType; sourceId: string }>,
): Prisma.FactProfitWhereInput {
  const saleIds = documents
    .filter((row) => row.sourceType === ProfitSourceType.SALE)
    .map((row) => row.sourceId);
  const returnIds = documents
    .filter((row) => row.sourceType === ProfitSourceType.SALE_RETURN)
    .map((row) => row.sourceId);
  return {
    OR: [
      ...(saleIds.length > 0
        ? [{ sourceType: ProfitSourceType.SALE, sourceId: { in: saleIds } }]
        : []),
      ...(returnIds.length > 0
        ? [{ sourceType: ProfitSourceType.SALE_RETURN, sourceId: { in: returnIds } }]
        : []),
    ],
  };
}

export async function querySalesLineProfitData(
  filters: SalesLineProfitFilters,
  options: {
    detailLimit?: number;
    billLimit?: number;
    mode?: "SCREEN" | "EXPORT";
  } = {},
): Promise<SalesLineProfitData> {
  const detailLimit = options.detailLimit ?? SCREEN_DETAIL_LIMIT;
  const billLimit = options.billLimit ?? SCREEN_BILL_LIMIT;
  const isExport = options.mode === "EXPORT";
  const productScope = await resolveProductScope(filters);
  const baseScope = await baseFactWhere(filters);
  const baseWhere = baseScope.where;
  let scopeTruncated = baseScope.truncated || Boolean(productScope?.truncated);
  let scopedWhere: Prisma.FactProfitWhereInput = baseWhere;

  if (productScope) {
    const matchingDocuments = await db.factProfit.groupBy({
      by: ["sourceType", "sourceId"],
      where: { ...baseWhere, productId: { in: productScope.ids } },
      orderBy: [{ sourceType: "asc" }, { sourceId: "asc" }],
      take: SALES_LINE_PROFIT_EXPORT_LIMIT + 1,
    });
    scopeTruncated ||= matchingDocuments.length > SALES_LINE_PROFIT_EXPORT_LIMIT;
    const boundedDocuments = matchingDocuments.slice(0, SALES_LINE_PROFIT_EXPORT_LIMIT);
    scopedWhere = boundedDocuments.length > 0
      ? { AND: [baseWhere, documentScopeWhere(boundedDocuments)] }
      : { sourceId: { in: [] } };
  }

  if (isExport && scopeTruncated) {
    return {
      bills: [],
      lines: [],
      totals: EMPTY_TOTALS,
      totalLineCount: SALES_LINE_PROFIT_EXPORT_LIMIT + 1,
      billRowsTruncated: true,
      lineRowsTruncated: true,
    };
  }
  const lineWhere: Prisma.FactProfitWhereInput = {
    ...scopedWhere,
    productId: productScope ? { in: productScope.ids } : { not: null },
    sourceLineId: { not: null },
  };
  const billProductWhere: Prisma.FactProfitWhereInput = {
    ...scopedWhere,
    productId: { not: null },
    sourceLineId: { not: null },
  };
  const exportLineCount = isExport ? await db.factProfit.count({ where: lineWhere }) : null;
  if (exportLineCount !== null && exportLineCount > detailLimit) {
    return {
      bills: [],
      lines: [],
      totals: EMPTY_TOTALS,
      totalLineCount: exportLineCount,
      billRowsTruncated: false,
      lineRowsTruncated: true,
    };
  }

  const [
    billGroups,
    aggregates,
    productAggregates,
    totalLineCount,
    totalBillProductLineCount,
    facts,
  ] = await Promise.all([
    db.factProfit.groupBy({
      by: [
        "sourceType",
        "sourceId",
        "sourceDocNo",
        "referenceDocNo",
        "businessDate",
        "customerName",
        "channel",
      ],
      where: scopedWhere,
      _sum: {
        quantity: true,
        salesAmountIncVat: true,
        salesAmountExVat: true,
        costAmount: true,
        grossProfit: true,
      },
      orderBy: [{ businessDate: "desc" }, { sourceDocNo: "desc" }],
      take: billLimit + 1,
    }),
    isExport
      ? Promise.resolve({ _sum: EMPTY_FACT_SUMS })
      : db.factProfit.aggregate({
          where: scopedWhere,
          _sum: {
            salesAmountIncVat: true,
            salesAmountExVat: true,
            costAmount: true,
            grossProfit: true,
          },
        }),
    isExport
      ? Promise.resolve({ _sum: { salesAmountIncVat: 0 } })
      : db.factProfit.aggregate({
          where: billProductWhere,
          _sum: { salesAmountIncVat: true },
        }),
    isExport ? Promise.resolve(exportLineCount ?? 0) : db.factProfit.count({ where: lineWhere }),
    isExport ? Promise.resolve(0) : db.factProfit.count({ where: billProductWhere }),
    db.factProfit.findMany({
      where: lineWhere,
      orderBy: [{ businessDate: "desc" }, { sourceDocNo: "desc" }, { sourceLineId: "asc" }],
      take: detailLimit + 1,
      select: {
        sourceType: true,
        sourceId: true,
        sourceLineId: true,
        sourceDocNo: true,
        referenceDocNo: true,
        businessDate: true,
        customerName: true,
        channel: true,
        productCode: true,
        productName: true,
        quantity: true,
        salesAmountIncVat: true,
        salesAmountExVat: true,
        costAmount: true,
        grossProfit: true,
      },
    }),
  ]);

  const visibleBillGroups = billGroups.slice(0, billLimit);
  const visibleFacts = facts.slice(0, detailLimit);
  const saleIds = visibleBillGroups
    .filter((row) => row.sourceType === ProfitSourceType.SALE)
    .map((row) => row.sourceId);
  const saleLineIds = visibleFacts
    .filter((row) => row.sourceType === ProfitSourceType.SALE)
    .map((row) => row.sourceLineId as string);
  const returnLineIds = visibleFacts
    .filter((row) => row.sourceType === ProfitSourceType.SALE_RETURN)
    .map((row) => row.sourceLineId as string);

  const [sales, saleItems, creditNoteItems] = await Promise.all([
    db.sale.findMany({
      where: { id: { in: saleIds } },
      select: { id: true, discount: true },
    }),
    db.saleItem.findMany({
      where: { id: { in: saleLineIds } },
      select: {
        id: true,
        quantity: true,
        showQty: true,
        showUnitName: true,
        unitListPrice: true,
        lineDiscount: true,
        totalAmount: true,
      },
    }),
    db.creditNoteItem.findMany({
      where: { id: { in: returnLineIds } },
      select: {
        id: true,
        qty: true,
        showQty: true,
        showUnitName: true,
        unitPrice: true,
        showPricePerUnit: true,
        amount: true,
      },
    }),
  ]);

  const saleById = new Map(sales.map((sale) => [sale.id, sale]));
  const saleItemById = new Map(saleItems.map((item) => [item.id, item]));
  const creditNoteItemById = new Map(creditNoteItems.map((item) => [item.id, item]));

  const canReuseVisibleFacts = !productScope && totalBillProductLineCount <= visibleFacts.length;
  const completeLineFacts = !isExport && totalBillProductLineCount <= SALES_LINE_PROFIT_EXPORT_LIMIT
    ? canReuseVisibleFacts
      ? visibleFacts
      : await db.factProfit.findMany({
          where: billProductWhere,
          orderBy: [{ businessDate: "desc" }, { sourceDocNo: "desc" }, { sourceLineId: "asc" }],
          take: SALES_LINE_PROFIT_EXPORT_LIMIT,
          select: {
            sourceType: true,
            sourceLineId: true,
            salesAmountIncVat: true,
          },
        })
    : null;
  const completeSaleLineIds = completeLineFacts
    ?.filter((row) => row.sourceType === ProfitSourceType.SALE && row.sourceLineId !== null)
    .map((row) => row.sourceLineId as string);
  const completeSaleItems = completeSaleLineIds
    ? await db.saleItem.findMany({
        where: { id: { in: completeSaleLineIds } },
        select: {
          id: true,
          quantity: true,
          showQty: true,
          unitListPrice: true,
          lineDiscount: true,
          totalAmount: true,
        },
      })
    : null;
  const completeFactByLineId = new Map(
    (completeLineFacts ?? [])
      .filter((row) => row.sourceLineId !== null)
      .map((row) => [row.sourceLineId as string, row]),
  );
  const discountBreakdown = completeSaleItems
    ? completeSaleItems.reduce(
        (totals, item) => {
          const displayQuantity = number(item.showQty ?? item.quantity);
          const amountAfterLineDiscount = number(item.totalAmount);
          const fact = completeFactByLineId.get(item.id);
          totals.amountBeforeLineDiscount += round2(number(item.unitListPrice) * displayQuantity);
          totals.lineDiscount += number(item.lineDiscount);
          totals.amountAfterLineDiscount += amountAfterLineDiscount;
          totals.allocatedBillDiscount += fact
            ? round2(amountAfterLineDiscount - number(fact.salesAmountIncVat))
            : 0;
          return totals;
        },
        {
          amountBeforeLineDiscount: 0,
          lineDiscount: 0,
          amountAfterLineDiscount: 0,
          allocatedBillDiscount: 0,
        },
      )
    : null;

  const bills: SalesBillProfitRow[] = visibleBillGroups.map((row) => {
    const netSalesExVat = number(row._sum.salesAmountExVat);
    const grossProfit = number(row._sum.grossProfit);
    const isReturn = row.sourceType === ProfitSourceType.SALE_RETURN;
    return {
      sourceType: isReturn ? "SALE_RETURN" : "SALE",
      sourceId: row.sourceId,
      docNo: row.sourceDocNo,
      referenceDocNo: row.referenceDocNo,
      docDate: row.businessDate,
      customerName: row.customerName ?? "ไม่ระบุลูกค้า",
      channel: row.channel ?? SaleChannel.STORE,
      quantity: number(row._sum.quantity),
      netSalesIncVat: number(row._sum.salesAmountIncVat),
      netSalesExVat,
      costAmount: number(row._sum.costAmount),
      grossProfit,
      marginPct: Math.abs(netSalesExVat) > 0.004 ? (grossProfit / netSalesExVat) * 100 : 0,
      billDiscount: isReturn ? 0 : number(saleById.get(row.sourceId)?.discount),
      href: isReturn
        ? `/admin/credit-notes/${row.sourceId}`
        : `/admin/sales/${row.sourceId}`,
    };
  });

  const lines: SalesLineProfitRow[] = visibleFacts.map((fact) => {
    const sourceLineId = fact.sourceLineId as string;
    const isReturn = fact.sourceType === ProfitSourceType.SALE_RETURN;
    const saleItem = isReturn ? undefined : saleItemById.get(sourceLineId);
    const creditNoteItem = isReturn ? creditNoteItemById.get(sourceLineId) : undefined;
    const quantity = isReturn
      ? -Math.abs(number(creditNoteItem?.showQty ?? creditNoteItem?.qty ?? fact.quantity))
      : number(saleItem?.showQty ?? saleItem?.quantity ?? fact.quantity);
    const unitListPrice = saleItem ? number(saleItem.unitListPrice) : null;
    const amountAfterLineDiscount = saleItem
      ? number(saleItem.totalAmount)
      : -Math.abs(number(creditNoteItem?.amount ?? fact.salesAmountIncVat));
    const netSalesExVat = number(fact.salesAmountExVat);
    const grossProfit = number(fact.grossProfit);

    return {
      sourceType: isReturn ? "SALE_RETURN" : "SALE",
      sourceId: fact.sourceId,
      sourceLineId,
      docNo: fact.sourceDocNo,
      referenceDocNo: fact.referenceDocNo,
      docDate: fact.businessDate,
      customerName: fact.customerName ?? "ไม่ระบุลูกค้า",
      channel: fact.channel ?? SaleChannel.STORE,
      productCode: fact.productCode ?? "-",
      productName: fact.productName ?? "ไม่ระบุสินค้า",
      quantity,
      unitName: saleItem?.showUnitName ?? creditNoteItem?.showUnitName ?? "ชิ้น",
      unitListPrice,
      amountBeforeLineDiscount:
        unitListPrice === null ? null : round2(unitListPrice * quantity),
      lineDiscount: saleItem ? number(saleItem.lineDiscount) : null,
      amountAfterLineDiscount,
      allocatedBillDiscount: saleItem
        ? round2(amountAfterLineDiscount - number(fact.salesAmountIncVat))
        : null,
      netSalesIncVat: number(fact.salesAmountIncVat),
      netSalesExVat,
      costAmount: number(fact.costAmount),
      grossProfit,
      marginPct: Math.abs(netSalesExVat) > 0.004 ? (grossProfit / netSalesExVat) * 100 : 0,
      href: isReturn
        ? `/admin/credit-notes/${fact.sourceId}`
        : `/admin/sales/${fact.sourceId}`,
    };
  });

  const netSalesExVat = number(aggregates._sum.salesAmountExVat);
  const grossProfit = number(aggregates._sum.grossProfit);
  return {
    bills,
    lines,
    totals: {
      amountBeforeLineDiscount: discountBreakdown
        ? round2(discountBreakdown.amountBeforeLineDiscount)
        : null,
      lineDiscount: discountBreakdown ? round2(discountBreakdown.lineDiscount) : null,
      amountAfterLineDiscount: discountBreakdown
        ? round2(discountBreakdown.amountAfterLineDiscount)
        : null,
      allocatedBillDiscount: discountBreakdown
        ? round2(discountBreakdown.allocatedBillDiscount)
        : null,
      shippingAmountIncVat: round2(
        number(aggregates._sum.salesAmountIncVat) -
          number(productAggregates._sum.salesAmountIncVat),
      ),
      netSalesIncVat: number(aggregates._sum.salesAmountIncVat),
      netSalesExVat,
      costAmount: number(aggregates._sum.costAmount),
      grossProfit,
      marginPct: Math.abs(netSalesExVat) > 0.004 ? (grossProfit / netSalesExVat) * 100 : 0,
    },
    totalLineCount,
    billRowsTruncated: scopeTruncated || billGroups.length > billLimit,
    lineRowsTruncated: scopeTruncated || facts.length > detailLimit,
  };
}

export function salesLineProfitFileDateRange(filters: SalesLineProfitFilters): string {
  return `${formatDateOnlyForInput(filters.from)}-to-${formatDateOnlyForInput(filters.to)}`;
}
