import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { getLiffCustomerSession } from "@/lib/liff-session";

export async function getLiffCustomer() {
  const session = await getLiffCustomerSession();

  if (!session) {
    return null;
  }

  return db.customer.findFirst({
    where: {
      id: session.customerId,
      lineUserId: session.lineUserId,
      isActive: true,
    },
    select: {
      id: true,
      code: true,
      name: true,
      phone: true,
      address: true,
      shippingAddress: true,
      taxId: true,
      creditTerm: true,
      source: true,
      lineLinkedAt: true,
    },
  });
}

export async function requireLiffCustomer() {
  const customer = await getLiffCustomer();

  if (!customer) {
    redirect("/liff/link");
  }

  return customer;
}
