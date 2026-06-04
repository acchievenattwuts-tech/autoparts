import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma";

const uniqueIds = (ids: Array<string | null | undefined>): string[] =>
  [...new Set(ids.filter((id): id is string => Boolean(id)))];

export const activeOrReferencedWhere = (
  referencedIds: Array<string | null | undefined> = [],
): Prisma.ProductWhereInput => {
  const ids = uniqueIds(referencedIds);
  return ids.length > 0
    ? { OR: [{ isActive: true }, { id: { in: ids } }] }
    : { isActive: true };
};

export const getTransactionCustomers = (
  referencedIds: Array<string | null | undefined> = [],
) => {
  const ids = uniqueIds(referencedIds);
  return db.customer.findMany({
    where: ids.length > 0
      ? { OR: [{ isActive: true }, { id: { in: ids } }] }
      : { isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      phone: true,
      code: true,
      shippingAddress: true,
      creditTerm: true,
      defaultLatitude: true,
      defaultLongitude: true,
      isActive: true,
    },
  });
};

export const getTransactionSuppliers = (
  referencedIds: Array<string | null | undefined> = [],
) => {
  const ids = uniqueIds(referencedIds);
  return db.supplier.findMany({
    where: ids.length > 0
      ? { OR: [{ isActive: true }, { id: { in: ids } }] }
      : { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, code: true, phone: true, creditTerm: true, isActive: true },
  });
};
