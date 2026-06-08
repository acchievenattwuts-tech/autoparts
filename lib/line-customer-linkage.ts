import { db } from "@/lib/db";
import { DocStatus } from "@/lib/generated/prisma";

/**
 * Customer linkage policy for LINE conversations.
 *
 * - "linked": a unique, active Customer is matched by the strong `lineUserId`
 *   signal (Customer.lineUserId is unique). This is the only signal trusted for
 *   automatic linkage.
 * - "unlinked": no Customer matches the LINE user id.
 * - "ambiguous": weak signals (e.g. phone) match more than one candidate. The
 *   system NEVER auto-merges on weak evidence — these are surfaced to an admin
 *   for manual linking only.
 */
export type LineCustomerLinkageState = "linked" | "unlinked" | "ambiguous";

export type LineCustomerLinkage = {
  state: LineCustomerLinkageState;
  customerId: string | null;
  customer: { id: string; name: string; phone: string | null } | null;
};

export async function resolveLineCustomerLinkage(input: {
  lineUserId: string;
}): Promise<LineCustomerLinkage> {
  const customer = await db.customer.findUnique({
    where: { lineUserId: input.lineUserId },
    select: { id: true, name: true, phone: true, isActive: true },
  });

  if (customer?.isActive) {
    return {
      state: "linked",
      customerId: customer.id,
      customer: { id: customer.id, name: customer.name, phone: customer.phone },
    };
  }

  return { state: "unlinked", customerId: null, customer: null };
}

/**
 * Weak-signal candidate lookup for admin-assisted manual linking. Returns
 * candidates by phone WITHOUT linking anything automatically. More than one
 * candidate is reported as "ambiguous" so the admin resolves it by hand.
 */
export async function findLineCustomerCandidatesByPhone(input: {
  phone: string;
}): Promise<{ state: LineCustomerLinkageState; candidates: Array<{ id: string; name: string; phone: string | null }> }> {
  const phone = input.phone.trim();
  if (!phone) {
    return { state: "unlinked", candidates: [] };
  }

  const candidates = await db.customer.findMany({
    where: { phone, isActive: true },
    select: { id: true, name: true, phone: true },
    take: 5,
  });

  if (candidates.length === 0) return { state: "unlinked", candidates: [] };
  if (candidates.length === 1) return { state: "linked", candidates };
  return { state: "ambiguous", candidates };
}

/**
 * Read-only recent orders for an already-linked customer, for admin context when
 * answering order-status questions. Scoped strictly to the given customerId — it
 * never returns another customer's data and never mutates anything. Uses the
 * `[customerId, status, saleDate desc]` index.
 */
export async function getLinkedCustomerRecentOrders(input: {
  customerId: string;
  take?: number;
}) {
  const take = Math.min(10, Math.max(1, input.take ?? 5));
  return db.sale.findMany({
    where: { customerId: input.customerId, status: DocStatus.ACTIVE },
    select: {
      id: true,
      saleNo: true,
      saleDate: true,
      netAmount: true,
      amountRemain: true,
      shippingStatus: true,
      trackingNo: true,
    },
    orderBy: { saleDate: "desc" },
    take,
  });
}
