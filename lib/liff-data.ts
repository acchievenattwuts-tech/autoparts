import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { getLiffCustomerSession } from "@/lib/liff-session";

export async function requireLiffCustomer() {
  const session = await getLiffCustomerSession();

  if (!session) {
    redirect("/liff/link");
  }

  const customer = await db.customer.findFirst({
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

  if (!customer) {
    redirect("/liff/link");
  }

  return customer;
}
