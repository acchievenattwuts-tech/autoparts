import { db } from "@/lib/db";

export type ReceiptCustomerOption = {
  id: string;
  name: string;
  code: string | null;
  amountRemain: number;
};

export const getReceiptCustomerOptions = async (
  currentCustomerId?: string,
): Promise<ReceiptCustomerOption[]> => {
  const [saleBalances, cnBalances] = await Promise.all([
    db.sale.groupBy({
      by: ["customerId"],
      where: {
        customerId: { not: null },
        status: "ACTIVE",
        paymentType: "CREDIT_SALE",
        amountRemain: { gt: 0 },
      },
      _sum: { amountRemain: true },
    }),
    db.creditNote.groupBy({
      by: ["customerId"],
      where: {
        customerId: { not: null },
        status: "ACTIVE",
        settlementType: "CREDIT_DEBT",
        amountRemain: { gt: 0 },
      },
      _sum: { amountRemain: true },
    }),
  ]);

  const customerIds = [
    ...new Set(
      [
        ...saleBalances.map((balance) => balance.customerId),
        ...cnBalances.map((balance) => balance.customerId),
        currentCustomerId,
      ].filter((customerId): customerId is string => !!customerId),
    ),
  ];

  if (customerIds.length === 0) {
    return [];
  }

  const customers = await db.customer.findMany({
    where: currentCustomerId
      ? {
          OR: [
            {
              id: { in: customerIds },
              isActive: true,
            },
            { id: currentCustomerId },
          ],
        }
      : {
          id: { in: customerIds },
          isActive: true,
        },
    select: {
      id: true,
      name: true,
      code: true,
    },
    orderBy: { name: "asc" },
  });

  const saleBalanceMap = new Map(
    saleBalances
      .filter((balance): balance is typeof balance & { customerId: string } => balance.customerId !== null)
      .map((balance) => [balance.customerId, Number(balance._sum.amountRemain ?? 0)]),
  );
  const cnBalanceMap = new Map(
    cnBalances
      .filter((balance): balance is typeof balance & { customerId: string } => balance.customerId !== null)
      .map((balance) => [balance.customerId, Number(balance._sum.amountRemain ?? 0)]),
  );

  return customers
    .map((customer) => {
      const saleOutstanding = saleBalanceMap.get(customer.id) ?? 0;
      const cnOutstanding = cnBalanceMap.get(customer.id) ?? 0;

      return {
        ...customer,
        amountRemain: saleOutstanding - cnOutstanding,
      };
    })
    .filter((customer) => customer.id === currentCustomerId || customer.amountRemain !== 0);
};
