import { db } from "@/lib/db";
import {
  PurchaseReturnSettlementType,
  PurchaseType,
} from "@/lib/generated/prisma";

export type SupplierPaymentSupplierOption = {
  id: string;
  name: string;
  code: string | null;
  phone: string | null;
  amountRemain: number;
};

export const getSupplierPaymentSupplierOptions = async (
  currentSupplierId?: string,
): Promise<SupplierPaymentSupplierOption[]> => {
  const [purchaseBalances, creditBalances, advanceBalances] = await Promise.all([
    db.purchase.groupBy({
      by: ["supplierId"],
      where: {
        status: "ACTIVE",
        purchaseType: PurchaseType.CREDIT_PURCHASE,
        amountRemain: { gt: 0 },
      },
      _sum: { amountRemain: true },
    }),
    db.purchaseReturn.groupBy({
      by: ["supplierId"],
      where: {
        status: "ACTIVE",
        settlementType: PurchaseReturnSettlementType.SUPPLIER_CREDIT,
        amountRemain: { gt: 0 },
      },
      _sum: { amountRemain: true },
    }),
    db.supplierAdvance.groupBy({
      by: ["supplierId"],
      where: {
        status: "ACTIVE",
        amountRemain: { gt: 0 },
      },
      _sum: { amountRemain: true },
    }),
  ]);

  const supplierIds = [
    ...new Set(
      [
        ...purchaseBalances.map((balance) => balance.supplierId),
        ...creditBalances.map((balance) => balance.supplierId),
        ...advanceBalances.map((balance) => balance.supplierId),
        currentSupplierId,
      ].filter((supplierId): supplierId is string => !!supplierId),
    ),
  ];

  if (supplierIds.length === 0) {
    return [];
  }

  const suppliers = await db.supplier.findMany({
    where: currentSupplierId
      ? {
          OR: [
            {
              id: { in: supplierIds },
              isActive: true,
            },
            { id: currentSupplierId },
          ],
        }
      : {
          id: { in: supplierIds },
          isActive: true,
        },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      code: true,
      phone: true,
    },
  });

  const purchaseBalanceMap = new Map(
    purchaseBalances.map((balance) => [balance.supplierId, Number(balance._sum.amountRemain ?? 0)]),
  );
  const creditBalanceMap = new Map(
    creditBalances.map((balance) => [balance.supplierId, Number(balance._sum.amountRemain ?? 0)]),
  );
  const advanceBalanceMap = new Map(
    advanceBalances.map((balance) => [balance.supplierId, Number(balance._sum.amountRemain ?? 0)]),
  );

  return suppliers
    .map((supplier) => {
      const purchaseOutstanding = purchaseBalanceMap.get(supplier.id) ?? 0;
      const creditOutstanding = creditBalanceMap.get(supplier.id) ?? 0;
      const advanceOutstanding = advanceBalanceMap.get(supplier.id) ?? 0;

      return {
        ...supplier,
        amountRemain: purchaseOutstanding - creditOutstanding - advanceOutstanding,
      };
    })
    .filter((supplier) => supplier.id === currentSupplierId || supplier.amountRemain !== 0);
};
