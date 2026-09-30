import type { AuditAction } from "@/lib/generated/prisma";
import {
  ADMIN_UNLINK_AUDIT_ACTIONS,
  isAdminLineUnlinkAudit,
  LIFF_LINK_AUDIT_ACTIONS,
  type LinkStateAudit,
} from "@/lib/liff-customer";

/**
 * "Relinked" for the bell list uses the same rule as the LIFF link flow
 * (isCustomerPreviouslyUnlinkedByAdmin in lib/liff-customer.ts): among the LINE link-state
 * events that happened before the customer's current link, the newest one wins — an admin
 * unlink (flagged UPDATE/CANCEL, or a legacy before/after that cleared lineUserId) means the
 * current link is a relink; a LIFF link/registration means it is not.
 */

/** Audit actions that can carry a LINE link-state event. */
export const LINE_LINK_STATE_AUDIT_ACTIONS: AuditAction[] = [...ADMIN_UNLINK_AUDIT_ACTIONS, ...LIFF_LINK_AUDIT_ACTIONS];

export type CustomerLinkStateAudit = LinkStateAudit & {
  action: AuditAction;
  entityId: string | null;
  createdAt: Date;
};

const isLineLinkStateAudit = (log: CustomerLinkStateAudit): boolean =>
  LIFF_LINK_AUDIT_ACTIONS.includes(log.action) || isAdminLineUnlinkAudit(log);

export function findRelinkedCustomerIds(
  customers: ReadonlyArray<{ id: string; lineLinkedAt: Date | null }>,
  logs: readonly CustomerLinkStateAudit[],
): Set<string> {
  const newestFirst = [...logs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const relinked = new Set<string>();
  for (const customer of customers) {
    const linkedAt = customer.lineLinkedAt?.getTime();
    if (linkedAt === undefined) continue;
    const newestEvent = newestFirst.find(
      (log) => log.entityId === customer.id && log.createdAt.getTime() < linkedAt && isLineLinkStateAudit(log),
    );
    if (newestEvent && isAdminLineUnlinkAudit(newestEvent)) relinked.add(customer.id);
  }
  return relinked;
}
