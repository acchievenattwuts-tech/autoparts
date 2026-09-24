import type { Session } from "next-auth";

/**
 * Which knowledge buttons the signed-in user may see. UX only: every server
 * action still calls requirePermission() with the matching key.
 */
export type KnowledgeActionPermissions = {
  canUpdate: boolean;
  canApprove: boolean;
  canSync: boolean;
  canArchive: boolean;
};

export const getKnowledgeActionPermissions = (session: Session): KnowledgeActionPermissions => {
  const permissions = session.user.permissions ?? [];
  return {
    canUpdate: permissions.includes("knowledge.update"),
    canApprove: permissions.includes("knowledge.approve"),
    canSync: permissions.includes("knowledge.sync"),
    canArchive: permissions.includes("knowledge.archive"),
  };
};
