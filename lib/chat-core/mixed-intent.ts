import type {
  ChatReplyHistoryItem,
  ChatSearchIntent,
} from "@/lib/chat-core/ai-service";
import {
  groupToRoute,
  intentToGroup,
  type ChatMessageGroup,
} from "@/lib/chat-core/intent-groups";
import {
  routeChatIntent,
  type ChatIntentRouteResult,
} from "@/lib/chat-core/intent-router";
import { LineMessageType } from "@/lib/generated/prisma";

type ClassifiedMixedSegment = {
  text: string;
  group: ChatMessageGroup;
  searchIntent: ChatSearchIntent | null;
  route: ChatIntentRouteResult;
};

export type MixedProductAdminTurn = {
  productText: string;
  productSearchIntent: ChatSearchIntent | null;
  adminText: string;
  adminGroup: ChatMessageGroup;
  adminRoute: ChatIntentRouteResult;
};

const classifySegment = async (input: {
  text: string;
  history: ChatReplyHistoryItem[];
  classify: (input: {
    intent: ChatIntentRouteResult["intent"];
    latestText: string;
    history: ChatReplyHistoryItem[];
  }) => Promise<ChatSearchIntent | null>;
}): Promise<ClassifiedMixedSegment> => {
  const route = routeChatIntent({ messageType: LineMessageType.TEXT, text: input.text });
  if (route.requiresAdmin) {
    return {
      text: input.text,
      group: intentToGroup(route.intent),
      searchIntent: null,
      route,
    };
  }

  const searchIntent = await input
    .classify({ intent: route.intent, latestText: input.text, history: input.history })
    .catch(() => null);
  const group = searchIntent?.group ?? intentToGroup(route.intent);
  return {
    text: input.text,
    group,
    searchIntent,
    route: groupToRoute(group) ?? route,
  };
};

/**
 * Detects a coalesced burst that contains both product discovery and a separate
 * admin-owned operation. Message boundaries are intentionally preserved: a later
 * shipping/payment/status message must not relabel an earlier product query and
 * suppress its catalog search.
 *
 * The caller owns delivery. When this returns a plan it should search/reply using
 * `productText`, append the admin acknowledgement last, then transition the room
 * to WAITING_ADMIN.
 */
export async function resolveMixedProductAdminTurn(input: {
  segments: Array<string | null | undefined>;
  history: ChatReplyHistoryItem[];
  classify: (input: {
    intent: ChatIntentRouteResult["intent"];
    latestText: string;
    history: ChatReplyHistoryItem[];
  }) => Promise<ChatSearchIntent | null>;
}): Promise<MixedProductAdminTurn | null> {
  const segments = input.segments.map((text) => text?.trim() ?? "").filter(Boolean);
  if (segments.length < 2) return null;

  const classified = await Promise.all(
    segments.map((text) => classifySegment({ text, history: input.history, classify: input.classify })),
  );
  const productSegments = classified.filter((segment) => segment.group === "product");
  const adminSegments = classified.filter((segment) => segment.route.requiresAdmin);
  if (productSegments.length === 0 || adminSegments.length === 0) return null;

  const lastAdmin = adminSegments[adminSegments.length - 1];
  return {
    productText: productSegments.map((segment) => segment.text).join("\n"),
    // A single product message already has a safely isolated classifier result.
    // Multiple product messages are re-classified together by the normal pipeline
    // so its existing multi-subject/context consolidation remains authoritative.
    productSearchIntent:
      productSegments.length === 1 ? productSegments[0].searchIntent : null,
    adminText: adminSegments.map((segment) => segment.text).join("\n"),
    adminGroup: lastAdmin.group,
    adminRoute: lastAdmin.route,
  };
}
