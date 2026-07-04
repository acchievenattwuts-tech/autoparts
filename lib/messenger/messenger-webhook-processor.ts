import { LineConversationAiStatus, LineMessageDirection, LineMessageType } from "@/lib/generated/prisma";
import { generateChatSuggestion, generateScopedConversationalReply } from "@/lib/chat-core/ai-service";
import { intentToGroup } from "@/lib/chat-core/intent-groups";
import { routeChatIntent } from "@/lib/chat-core/intent-router";
import {
  applyChatPriceVisibility,
  getChatProductSummaries,
  searchChatProductInquiry,
  type ChatMatchedProductSummary,
} from "@/lib/chat-core/product-search-bridge";
import { getProductSlug } from "@/lib/product-slug";
import { SITE_URL } from "@/lib/seo";
import {
  DuplicateMessengerEventError,
  appendMessengerMessage,
  getOrCreateMessengerConversation,
  getRecentMessengerMessagesForAi,
  resolveMessengerShowPrice,
  storeMessengerAiSuggestion,
  touchMessengerConversationActivity,
} from "@/lib/messenger/messenger-conversation-repository";
import {
  fetchMessengerUserProfile,
  sendMessengerGenericTemplate,
  sendMessengerSenderAction,
  sendMessengerText,
  type MessengerGenericElement,
} from "@/lib/messenger/messenger-messaging";

/**
 * Core Facebook Messenger inbound-message pipeline. Reuses the shared brain in
 * lib/chat-core (intent routing, product search, AI suggestion) so LINE and
 * Messenger answer identically. Transport (Send API) + persistence (Messenger*
 * tables) are the only channel-specific parts.
 *
 * Scope note (Phase D sub-stage 1): implements the text conversation flow —
 * product inquiry (search + carousel), greeting, and conservative fallbacks.
 * Image/OCR/payment-slip handling and burst coalescing are added in a later
 * sub-stage (tracked in PLAN-MESSENGER.md).
 */

const MAX_CAROUSEL_PRODUCTS = 8;
const RECENT_HISTORY_TAKE = 10;

export type MessengerInboundEvent = {
  pageId: string;
  psid: string;
  mid: string | null;
  /** Stable per-delivery id for idempotency (mid works; falls back to composite). */
  fbEventId: string | null;
  text: string | null;
  hasAttachment: boolean;
  attachmentUrls: string[];
};

export type MessengerProcessorConfig = {
  pageAccessToken: string;
};

function productToCarouselElement(
  product: ChatMatchedProductSummary,
  showPrice: boolean,
): MessengerGenericElement {
  const priceLine =
    showPrice && product.salePrice > 0
      ? `฿${product.salePrice.toLocaleString("th-TH")}`
      : "สอบถามราคา";
  const url = `${SITE_URL}/product/${getProductSlug({
    productName: product.name,
    productId: product.id,
    productCode: product.code,
  })}`;
  return {
    title: product.name.slice(0, 80),
    subtitle: [product.code ? `รหัส ${product.code}` : null, priceLine].filter(Boolean).join("  •  "),
    imageUrl: product.imageUrl ?? undefined,
    defaultActionUrl: url,
    buttons: [{ type: "web_url", title: "ดูบนเว็บ", url }],
  };
}

/**
 * Handles one inbound Messenger message end to end: idempotent persist → route →
 * (search + suggest) → send reply + optional product carousel → persist outbound.
 * Designed to run inside the webhook's `after()` background phase.
 */
export async function processMessengerInbound(
  event: MessengerInboundEvent,
  config: MessengerProcessorConfig,
): Promise<{ status: "replied" | "skipped" | "duplicate"; reason?: string }> {
  const { pageAccessToken } = config;

  // Resolve the sender profile (best-effort — never block the reply on it).
  let displayName: string | null = null;
  let pictureUrl: string | null = null;
  try {
    const profile = await fetchMessengerUserProfile({ pageAccessToken, psid: event.psid });
    if (profile) {
      displayName = [profile.firstName, profile.lastName].filter(Boolean).join(" ") || null;
      pictureUrl = profile.profilePic;
    }
  } catch (error) {
    console.warn(`[messenger] profile lookup failed for ${event.psid}: ${error instanceof Error ? error.message : "unknown"}`);
  }

  const conversation = await getOrCreateMessengerConversation({
    pageId: event.pageId,
    psid: event.psid,
    displayName,
    pictureUrl,
  });

  const messageType = event.hasAttachment ? LineMessageType.IMAGE : LineMessageType.TEXT;

  // Persist inbound (idempotent via fbEventId unique index).
  try {
    await appendMessengerMessage({
      conversationId: conversation.id,
      psid: event.psid,
      mid: event.mid,
      fbEventId: event.fbEventId,
      direction: LineMessageDirection.INBOUND,
      messageType,
      text: event.text,
      imageUrl: event.attachmentUrls[0] ?? null,
      rawEvent: { attachmentUrls: event.attachmentUrls },
    });
  } catch (error) {
    if (error instanceof DuplicateMessengerEventError) {
      return { status: "duplicate" };
    }
    throw error;
  }

  await touchMessengerConversationActivity({
    conversationId: conversation.id,
    lastCustomerMessageAt: new Date(),
  });

  // Respect handoff / paused state — a human admin has taken over.
  if (conversation.aiStatus !== LineConversationAiStatus.ACTIVE) {
    return { status: "skipped", reason: `AI_${conversation.aiStatus}` };
  }

  // Image/attachment handling (OCR, payment slip) is a later sub-stage. For now
  // acknowledge conservatively so the customer is never left without a reply.
  if (event.hasAttachment && !event.text) {
    const ack = "ได้รับรูปแล้วนะคะ 🙏 เดี๋ยวจูนส่งต่อให้แอดมินช่วยตรวจสอบให้ค่ะ";
    await sendMessengerText({ pageAccessToken, psid: event.psid, text: ack });
    await persistOutbound(conversation.id, event.psid, ack, null);
    return { status: "replied", reason: "ATTACHMENT_ACK" };
  }

  const text = event.text?.trim() ?? "";
  if (!text) {
    return { status: "skipped", reason: "EMPTY_MESSAGE" };
  }

  // Typing indicator (best-effort).
  await sendMessengerSenderAction({ pageAccessToken, psid: event.psid, action: "mark_seen" }).catch(() => {});
  await sendMessengerSenderAction({ pageAccessToken, psid: event.psid, action: "typing_on" }).catch(() => {});

  const route = routeChatIntent({ messageType: LineMessageType.TEXT, text });
  const historyRows = await getRecentMessengerMessagesForAi(conversation.id, RECENT_HISTORY_TAKE);
  const history = historyRows
    .filter((row) => Boolean(row.text))
    .map((row) => ({
      role: row.direction === LineMessageDirection.INBOUND ? ("customer" as const) : ("shop" as const),
      text: row.text ?? "",
    }));

  // ── Product inquiry: search the shared catalog and present real matches ──
  if (route.allowsSearch) {
    const productSearch = await searchChatProductInquiry({ route, text });
    let products: ChatMatchedProductSummary[] = [];
    if (productSearch.searched) {
      const ids = productSearch.result.ids.slice(0, MAX_CAROUSEL_PRODUCTS);
      const showPrice = await resolveMessengerShowPrice(conversation.id);
      products = applyChatPriceVisibility(await getChatProductSummaries(ids), showPrice);

      const suggestion = await generateChatSuggestion({
        intent: route.intent,
        originalText: text,
        productSearch,
        history,
        products: products.map((p) => ({ name: p.name, code: p.code, salePrice: p.salePrice })),
      });

      await sendMessengerText({ pageAccessToken, psid: event.psid, text: suggestion.suggestedReply });
      if (products.length > 0) {
        await sendMessengerGenericTemplate({
          pageAccessToken,
          psid: event.psid,
          elements: products.map((p) => productToCarouselElement(p, showPrice)),
        });
      }
      await persistOutbound(conversation.id, event.psid, suggestion.suggestedReply, {
        intent: route.intent,
        confidence: suggestion.confidence,
        matchedProducts: products,
        reasoningSummary: suggestion.reasoningSummary,
      });
      return { status: "replied", reason: "PRODUCT_INQUIRY" };
    }
  }

  // ── Non-search intents: greeting / smalltalk / out-of-scope / conservative ──
  const group = intentToGroup(route.intent);
  let reply: string;
  if (group === "smalltalk" || group === "out_of_scope") {
    reply = await generateScopedConversationalReply({ group, latestText: text, history });
  } else {
    const suggestion = await generateChatSuggestion({ intent: route.intent, originalText: text, history });
    reply = suggestion.suggestedReply;
  }

  await sendMessengerText({ pageAccessToken, psid: event.psid, text: reply });
  await persistOutbound(conversation.id, event.psid, reply, { intent: route.intent });
  return { status: "replied", reason: `INTENT_${route.intent}` };
}

async function persistOutbound(
  conversationId: string,
  psid: string,
  text: string,
  suggestion: {
    intent?: import("@/lib/generated/prisma").LineIntent | null;
    confidence?: import("@/lib/generated/prisma").LineAiConfidence;
    matchedProducts?: unknown;
    reasoningSummary?: string | null;
  } | null,
): Promise<void> {
  const now = new Date();
  await appendMessengerMessage({
    conversationId,
    psid,
    direction: LineMessageDirection.OUTBOUND_AI,
    messageType: LineMessageType.TEXT,
    intent: suggestion?.intent ?? null,
    text,
    sentAt: now,
  });
  if (suggestion?.confidence) {
    await storeMessengerAiSuggestion({
      conversationId,
      intent: suggestion.intent ?? null,
      suggestedReply: text,
      confidence: suggestion.confidence,
      matchedProducts: (suggestion.matchedProducts as import("@/lib/generated/prisma").Prisma.InputJsonValue) ?? undefined,
      reasoningSummary: suggestion.reasoningSummary ?? null,
      sentAt: now,
    });
  }
}
