import { db } from "@/lib/db";
import { getBangkokDayKey } from "@/lib/storefront-visitor";
import {
  addThailandDays,
  parseDateOnlyToEndOfDay,
  parseDateOnlyToStartOfDay,
} from "@/lib/th-date";

export type PendingDeliveryItem = {
  id: string;
  saleNo: string;
  saleDate: Date;
  customerName: string;
  netAmount: number;
  itemCount: number;
  shippingMethod: string;
};

export type CodWaitingItem = {
  id: string;
  saleNo: string;
  saleDate: Date;
  customerName: string;
  amountRemain: number;
  netAmount: number;
  shippingStatus: string;
};

export type OverdueBucketCounts = {
  oneToSeven: number;
  eightToThirty: number;
  overThirty: number;
};

export type OverdueArItem = {
  id: string;
  saleNo: string;
  customerName: string;
  dueDate: Date;
  amountRemain: number;
  daysOverdue: number;
  fulfillmentType: "PICKUP" | "DELIVERY";
};

export type DueApItem = {
  id: string;
  purchaseNo: string;
  supplierName: string;
  dueDate: Date;
  amountRemain: number;
  daysOverdue: number;
};

export type SupplierClaimItem = {
  id: string;
  claimNo: string;
  claimDate: Date;
  supplierName: string;
  productName: string;
  customerName: string;
};

export type LowStockItem = {
  id: string;
  code: string;
  name: string;
  stock: number;
  minStock: number;
  unitName: string;
};

export type ExpiryBucketCounts = {
  withinThirtyDays: number;
  withinSixtyDays: number;
  withinNinetyDays: number;
};

export type ExpiringLotItem = {
  productId: string;
  productCode: string;
  productName: string;
  lotNo: string;
  expDate: Date;
  qtyOnHand: number;
  unitName: string;
  daysLeft: number;
};

export type CashBankBelowItem = {
  id: string;
  code: string;
  name: string;
  type: "CASH" | "BANK";
  currentBalance: number;
  threshold: number;
};

export type WorkboardData = {
  generatedAt: Date;
  todayStart: Date;
  pendingDeliveries: {
    count: number;
    items: PendingDeliveryItem[];
  };
  codWaiting: {
    count: number;
    totalAmountRemain: number;
    items: CodWaitingItem[];
  };
  overdueAr: {
    count: number;
    totalAmountRemain: number;
    buckets: OverdueBucketCounts;
    items: OverdueArItem[];
  };
  dueAp: {
    count: number;
    totalAmountRemain: number;
    items: DueApItem[];
  };
  supplierClaims: {
    count: number;
    items: SupplierClaimItem[];
  };
  lowStock: {
    count: number;
    items: LowStockItem[];
  };
  expiringLots: {
    count: number;
    buckets: ExpiryBucketCounts;
    items: ExpiringLotItem[];
  };
  cashBankBelow: {
    count: number;
    items: CashBankBelowItem[];
  };
};

const DAY_MS = 86_400_000;

function toStartOfDay(date: Date): Date {
  return parseDateOnlyToStartOfDay(getBangkokDayKey(date));
}

function getDayDiff(from: Date, to: Date): number {
  return Math.floor((toStartOfDay(from).getTime() - toStartOfDay(to).getTime()) / DAY_MS);
}

function buildOverdueBuckets(rows: Array<{ daysOverdue: number }>): OverdueBucketCounts {
  return rows.reduce<OverdueBucketCounts>(
    (accumulator, row) => {
      if (row.daysOverdue <= 7) {
        accumulator.oneToSeven += 1;
      } else if (row.daysOverdue <= 30) {
        accumulator.eightToThirty += 1;
      } else {
        accumulator.overThirty += 1;
      }
      return accumulator;
    },
    { oneToSeven: 0, eightToThirty: 0, overThirty: 0 },
  );
}

async function queryPendingDeliveries(todayEnd: Date) {
  const where = {
    status: "ACTIVE" as const,
    fulfillmentType: "DELIVERY" as const,
    saleDate: { lte: todayEnd },
    shippingStatus: { in: ["PENDING", "OUT_FOR_DELIVERY"] satisfies Array<"PENDING" | "OUT_FOR_DELIVERY"> },
  };

  const [count, rows] = await Promise.all([
    db.sale.count({ where }),
    db.sale.findMany({
      where,
      orderBy: [{ saleDate: "asc" }, { saleNo: "asc" }],
      take: 5,
      select: {
        id: true,
        saleNo: true,
        saleDate: true,
        customerName: true,
        netAmount: true,
        shippingMethod: true,
        customer: { select: { name: true } },
        _count: { select: { items: true } },
      },
    }),
  ]);

  return {
    count,
    items: rows.map((row) => ({
      id: row.id,
      saleNo: row.saleNo,
      saleDate: row.saleDate,
      customerName: row.customer?.name ?? row.customerName ?? "-",
      netAmount: Number(row.netAmount),
      itemCount: row._count.items,
      shippingMethod: row.shippingMethod,
    })),
  };
}

async function queryCodWaiting() {
  const where = {
    status: "ACTIVE" as const,
    paymentType: "CREDIT_SALE" as const,
    fulfillmentType: "DELIVERY" as const,
    amountRemain: { gt: 0 },
  };

  const [summary, rows] = await Promise.all([
    db.sale.aggregate({
      where,
      _count: { id: true },
      _sum: { amountRemain: true },
    }),
    db.sale.findMany({
      where,
      orderBy: [{ amountRemain: "desc" }, { saleDate: "asc" }, { saleNo: "asc" }],
      take: 5,
      select: {
        id: true,
        saleNo: true,
        saleDate: true,
        customerName: true,
        netAmount: true,
        amountRemain: true,
        shippingStatus: true,
        customer: { select: { name: true } },
      },
    }),
  ]);

  return {
    count: summary._count.id,
    totalAmountRemain: Number(summary._sum.amountRemain ?? 0),
    items: rows.map((row) => ({
      id: row.id,
      saleNo: row.saleNo,
      saleDate: row.saleDate,
      customerName: row.customer?.name ?? row.customerName ?? "-",
      amountRemain: Number(row.amountRemain),
      netAmount: Number(row.netAmount),
      shippingStatus: row.shippingStatus,
    })),
  };
}

async function queryOverdueAr(todayStart: Date, todayEnd: Date) {
  const rows = await db.sale.findMany({
    where: {
      status: "ACTIVE",
      paymentType: "CREDIT_SALE",
      amountRemain: { gt: 0 },
      saleDate: { lte: todayEnd },
    },
    orderBy: [{ saleDate: "asc" }, { saleNo: "asc" }],
    select: {
      id: true,
      saleNo: true,
      saleDate: true,
      customerName: true,
      amountRemain: true,
      creditTerm: true,
      fulfillmentType: true,
      customer: { select: { name: true } },
    },
  });

  const overdueRows = rows
    .map((row) => {
      const dueDate = addThailandDays(row.saleDate, row.creditTerm ?? 0);
      const daysOverdue = getDayDiff(todayStart, dueDate);
      if (daysOverdue <= 0) return null;

      return {
        id: row.id,
        saleNo: row.saleNo,
        customerName: row.customer?.name ?? row.customerName ?? "-",
        dueDate,
        amountRemain: Number(row.amountRemain),
        daysOverdue,
        fulfillmentType: row.fulfillmentType,
      } satisfies OverdueArItem;
    })
    .filter((row): row is OverdueArItem => row !== null)
    .sort(
      (left, right) =>
        right.daysOverdue - left.daysOverdue ||
        left.dueDate.getTime() - right.dueDate.getTime() ||
        right.amountRemain - left.amountRemain,
    );

  return {
    count: overdueRows.length,
    totalAmountRemain: overdueRows.reduce((sum, row) => sum + row.amountRemain, 0),
    buckets: buildOverdueBuckets(overdueRows),
    items: overdueRows.slice(0, 5),
  };
}

async function queryDueAp(todayStart: Date, todayEnd: Date) {
  const rows = await db.purchase.findMany({
    where: {
      status: "ACTIVE",
      purchaseType: "CREDIT_PURCHASE",
      amountRemain: { gt: 0 },
      purchaseDate: { lte: todayEnd },
    },
    orderBy: [{ purchaseDate: "asc" }, { purchaseNo: "asc" }],
    select: {
      id: true,
      purchaseNo: true,
      purchaseDate: true,
      amountRemain: true,
      creditTerm: true,
      supplier: { select: { name: true, creditTerm: true } },
    },
  });

  const dueRows = rows
    .map((row) => {
      const creditTerm = row.creditTerm ?? row.supplier?.creditTerm ?? 0;
      const dueDate = addThailandDays(row.purchaseDate, creditTerm);
      const daysOverdue = getDayDiff(todayStart, dueDate);
      if (daysOverdue <= 0) return null;

      return {
        id: row.id,
        purchaseNo: row.purchaseNo,
        supplierName: row.supplier?.name ?? "-",
        dueDate,
        amountRemain: Number(row.amountRemain),
        daysOverdue,
      } satisfies DueApItem;
    })
    .filter((row): row is DueApItem => row !== null)
    .sort(
      (left, right) =>
        right.daysOverdue - left.daysOverdue ||
        left.dueDate.getTime() - right.dueDate.getTime() ||
        right.amountRemain - left.amountRemain,
    );

  return {
    count: dueRows.length,
    totalAmountRemain: dueRows.reduce((sum, row) => sum + row.amountRemain, 0),
    items: dueRows.slice(0, 5),
  };
}

async function querySupplierClaims() {
  const where = {
    status: "SENT_TO_SUPPLIER" as const,
  };

  const [count, rows] = await Promise.all([
    db.warrantyClaim.count({ where }),
    db.warrantyClaim.findMany({
      where,
      orderBy: [{ claimDate: "asc" }, { claimNo: "asc" }],
      take: 5,
      select: {
        id: true,
        claimNo: true,
        claimDate: true,
        supplierName: true,
        warranty: {
          select: {
            product: { select: { name: true } },
            sale: { select: { customerName: true } },
          },
        },
      },
    }),
  ]);

  return {
    count,
    items: rows.map((row) => ({
      id: row.id,
      claimNo: row.claimNo,
      claimDate: row.claimDate,
      supplierName: row.supplierName ?? "-",
      productName: row.warranty.product.name,
      customerName: row.warranty.sale.customerName ?? "-",
    })),
  };
}

async function queryLowStock() {
  const where = {
    isActive: true,
    stock: { lte: db.product.fields.minStock },
  };

  const [count, rows] = await Promise.all([
    db.product.count({ where }),
    db.product.findMany({
      where,
      orderBy: [{ stock: "asc" }, { minStock: "asc" }, { name: "asc" }],
      take: 5,
      select: {
        id: true,
        code: true,
        name: true,
        stock: true,
        minStock: true,
        reportUnitName: true,
      },
    }),
  ]);

  return {
    count,
    items: rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      stock: row.stock,
      minStock: row.minStock,
      unitName: row.reportUnitName,
    })),
  };
}

async function queryExpiringLots(todayStart: Date) {
  const day90End = addThailandDays(todayStart, 90);

  const candidateLots = await db.productLot.findMany({
    where: {
      expDate: {
        gte: todayStart,
        lte: day90End,
      },
    },
    orderBy: [{ expDate: "asc" }, { lotNo: "asc" }],
    select: {
      productId: true,
      lotNo: true,
      expDate: true,
      product: {
        select: {
          code: true,
          name: true,
          reportUnitName: true,
        },
      },
    },
  });

  const productIds = [...new Set(candidateLots.map((lot) => lot.productId))];
  const balances =
    productIds.length === 0
      ? []
      : await db.lotBalance.findMany({
          where: {
            qtyOnHand: { gt: 0 },
            productId: { in: productIds },
          },
          select: {
            productId: true,
            lotNo: true,
            qtyOnHand: true,
          },
        });

  const balanceMap = new Map(
    balances.map((balance) => [`${balance.productId}::${balance.lotNo}`, Number(balance.qtyOnHand)]),
  );

  const rows = candidateLots
    .map((lot) => {
      if (!lot.expDate) return null;

      const qtyOnHand = balanceMap.get(`${lot.productId}::${lot.lotNo}`) ?? 0;
      if (qtyOnHand <= 0) return null;

      const daysLeft = getDayDiff(lot.expDate, todayStart);
      if (daysLeft < 0 || daysLeft > 90) return null;

      return {
        productId: lot.productId,
        productCode: lot.product.code,
        productName: lot.product.name,
        lotNo: lot.lotNo,
        expDate: lot.expDate,
        qtyOnHand,
        unitName: lot.product.reportUnitName,
        daysLeft,
      } satisfies ExpiringLotItem;
    })
    .filter((row): row is ExpiringLotItem => row !== null);

  const buckets = rows.reduce<ExpiryBucketCounts>(
    (accumulator, row) => {
      if (row.daysLeft <= 30) {
        accumulator.withinThirtyDays += 1;
      } else if (row.daysLeft <= 60) {
        accumulator.withinSixtyDays += 1;
      } else {
        accumulator.withinNinetyDays += 1;
      }
      return accumulator;
    },
    { withinThirtyDays: 0, withinSixtyDays: 0, withinNinetyDays: 0 },
  );

  return {
    count: rows.length,
    buckets,
    items: rows.slice(0, 5),
  };
}

async function queryCashBankBelow() {
  const accounts = await db.cashBankAccount.findMany({
    where: { isActive: true, lowBalanceThreshold: { gt: 0 } },
    orderBy: [{ type: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      openingBalance: true,
      lowBalanceThreshold: true,
      movements: {
        orderBy: [{ txnDate: "desc" }, { sorder: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { balanceAfter: true },
      },
    },
  });

  const items: CashBankBelowItem[] = accounts
    .map((account) => {
      const currentBalance = Number(account.movements[0]?.balanceAfter ?? account.openingBalance);
      const threshold = Number(account.lowBalanceThreshold);
      return {
        id: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        currentBalance,
        threshold,
      };
    })
    .filter((account) => account.currentBalance < account.threshold)
    .sort((left, right) => left.currentBalance - right.currentBalance);

  return {
    count: items.length,
    items: items.slice(0, 5),
  };
}

export async function getWorkboardData(): Promise<WorkboardData> {
  const now = new Date();
  const todayKey = getBangkokDayKey(now);
  const todayStart = parseDateOnlyToStartOfDay(todayKey);
  const todayEnd = parseDateOnlyToEndOfDay(todayKey);

  const [
    pendingDeliveries,
    codWaiting,
    overdueAr,
    dueAp,
    supplierClaims,
    lowStock,
    expiringLots,
    cashBankBelow,
  ] = await Promise.all([
    queryPendingDeliveries(todayEnd),
    queryCodWaiting(),
    queryOverdueAr(todayStart, todayEnd),
    queryDueAp(todayStart, todayEnd),
    querySupplierClaims(),
    queryLowStock(),
    queryExpiringLots(todayStart),
    queryCashBankBelow(),
  ]);

  return {
    generatedAt: now,
    todayStart,
    pendingDeliveries,
    codWaiting,
    overdueAr,
    dueAp,
    supplierClaims,
    lowStock,
    expiringLots,
    cashBankBelow,
  };
}
