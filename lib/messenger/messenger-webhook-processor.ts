import { LineConversationAiStatus, LineIntent, LineMessageDirection, LineMessageType } from "@/lib/generated/prisma";
import { generateChatSuggestion, generateScopedConversationalReply } from "@/lib/chat-core/ai-service";
import { intentToGroup } from "@/lib/chat-core/intent-groups";
import { routeChatIntent, type ChatIntentRouteResult } from "@/lib/chat-core/intent-router";
import {
  applyChatPriceVisibility,
  getChatProductSummaries,
  searchChatProductInquiry,
  type ChatProductSearchBridgeInput,
  type ChatMatchedProductSummary,
} from "@/lib/chat-core/product-search-bridge";
import {
  classifyMessengerImage,
  ingestMessengerPaymentSlip,
} from "@/lib/messenger/messenger-image-service";
import { getProductSlug } from "@/lib/product-slug";
import { SITE_URL } from "@/lib/seo";
import {
  DuplicateMessengerEventError,
  acquireMessengerConversationLock,
  appendMessengerMessage,
  bumpMessengerInboundSeq,
  getMessengerCoalesceState,
  getOrCreateMessengerConversation,
  getRecentMessengerMessagesForAi,
  getUnansweredMessengerMessages,
  markMessengerProcessedSeq,
  releaseMessengerConversationLock,
  resolveMessengerShowPrice,
  storeMessengerAiSuggestion,
} from "@/lib/messenger/messenger-conversation-repository";
import {
  fetchMessengerUserProfile,
  sendMessengerGenericTemplate,
  sendMessengerSenderAction,
  sendMessengerText,
  type MessengerGenericElement,
} from "@/lib/messenger/messenger-messaging";

/**
 * Facebook Messenger inbound pipeline. Reuses the shared brain in lib/chat-core
 * (intent routing, product search, AI suggestion, image classify + slip OCR) so
 * LINE and Messenger answer identically — transport (Send API) and persistence
 * (Messenger* tables) are the only channel-specific parts.
 *
 * Burst coalescing (latest-wins debounce + per-conversation lock): a webhook POST
 * (or several arriving close together) ingests every message WITHOUT replying,
 * then one elected owner debounces, merges the unanswered messages into a single
 * turn, and sends exactly one reply — so a 3-line burst yields one answer.
 */

const MAX_CAROUSEL_PRODUCTS = 8;
const RECENT_HISTORY_TAKE = 10;
const COALESCE_DEBOUNCE_MS = 3_000;
const COALESCE_LEASE_MS = 60_000;
// Stop debouncing after this much wall-clock and do one final reply, so a chatty
// customer can't push the owner past the 60s serverless ceiling.
const OWNER_FINAL_PASS_AFTER_MS = 28_000;

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

type ChatHistoryItem = { role: "customer" | "shop"; text: string };

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
 * Batch entry — called from the webhook's after(). Ingests every event (persist +
 * seq bump, no reply), then elects one owner per touched conversation to run the
 * debounce + single-reply turn.
 */
export async function processMessengerBatch(
  events: MessengerInboundEvent[],
  config: MessengerProcessorConfig,
): Promise<void> {
  const touched = new Map<string, string>(); // conversationId → psid

  for (const event of events) {
    try {
      const ingested = await ingestMessengerInbound(event, config);
      if (ingested) touched.set(ingested.conversationId, ingested.psid);
    } catch (error) {
      console.error(
        `[messenger] ingest failed for psid=${event.psid}: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  for (const [conversationId, psid] of touched) {
    const owner = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const acquired = await acquireMessengerConversationLock({
      conversationId,
      owner,
      leaseMs: COALESCE_LEASE_MS,
    }).catch(() => false);
    // Another worker owns this burst — our messages are persisted + seq-bumped,
    // so that owner will merge and answer them. Nothing to do.
    if (!acquired) continue;

    try {
      await runMessengerOwnerLoop({ conversationId, psid, config });
    } catch (error) {
      console.error(
        `[messenger] owner loop failed for ${conversationId}: ${error instanceof Error ? error.message : "unknown"}`,
      );
    } finally {
      await releaseMessengerConversationLock({ conversationId, owner }).catch(() => undefined);
    }
  }
}

/** Persists one inbound message (idempotent) + bumps the coalesce seq. Returns the
 *  conversation to process, or null when it was a duplicate / empty / not found. */
async function ingestMessengerInbound(
  event: MessengerInboundEvent,
  config: MessengerProcessorConfig,
): Promise<{ conversationId: string; psid: string } | null> {
  const { pageAccessToken } = config;

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

  try {
    await appendMessengerMessage({
      conversationId: conversation.id,
      psid: event.psid,
      mid: event.mid,
      fbEventId: event.fbEventId,
      direction: LineMessageDirection.INBOUND,
      messageType: event.hasAttachment ? LineMessageType.IMAGE : LineMessageType.TEXT,
      text: event.text,
      imageUrl: event.attachmentUrls[0] ?? null,
      rawEvent: { attachmentUrls: event.attachmentUrls },
    });
  } catch (error) {
    if (error instanceof DuplicateMessengerEventError) return null;
    throw error;
  }

  await bumpMessengerInboundSeq(conversation.id);
  return { conversationId: conversation.id, psid: event.psid };
}

/**
 * Debounce + latest-wins loop for one conversation. Waits for the customer to go
 * quiet (no newer inbound seq), then answers the merged unanswered turn exactly
 * once and records the processed seq. A final forced pass caps total wall-clock.
 */
async function runMessengerOwnerLoop(params: {
  conversationId: string;
  psid: string;
  config: MessengerProcessorConfig;
}): Promise<void> {
  const { conversationId, psid, config } = params;
  const startedAt = Date.now();

  // Typing indicator up front (best-effort).
  await sendMessengerSenderAction({ pageAccessToken: config.pageAccessToken, psid, action: "mark_seen" }).catch(() => {});
  await sendMessengerSenderAction({ pageAccessToken: config.pageAccessToken, psid, action: "typing_on" }).catch(() => {});

  for (;;) {
    const state = await getMessengerCoalesceState(conversationId);
    if (!state) return;
    if (state.lastProcessedSeq >= state.lastInboundSeq) return; // nothing new

    // Handoff / paused — a human admin took over. Mark processed so the failsafe
    // doesn't keep retrying, and stay silent.
    if (state.aiStatus !== LineConversationAiStatus.ACTIVE) {
      await markMessengerProcessedSeq({ conversationId, seq: state.lastInboundSeq });
      return;
    }

    const seqAtStart = state.lastInboundSeq;
    const forceFinal = Date.now() - startedAt >= OWNER_FINAL_PASS_AFTER_MS;

    if (!forceFinal) {
      await realSleep(COALESCE_DEBOUNCE_MS);
      const after = await getMessengerCoalesceState(conversationId);
      // A newer message landed during the debounce — loop and wait again.
      if (after && after.lastInboundSeq > seqAtStart) continue;
    }

    await replyToMessengerTurn({ conversationId, psid, config });
    await markMessengerProcessedSeq({ conversationId, seq: seqAtStart });
    return;
  }
}

/** Builds one merged turn from the unanswered inbound messages and sends a single
 *  reply (payment slip / part image / text product search / conversational). */
async function replyToMessengerTurn(params: {
  conversationId: string;
  psid: string;
  config: MessengerProcessorConfig;
}): Promise<void> {
  const { conversationId, psid, config } = params;
  const pageAccessToken = config.pageAccessToken;

  const unanswered = await getUnansweredMessengerMessages(conversationId);
  if (unanswered.length === 0) return;

  const mergedText = unanswered
    .map((m) => m.text?.trim())
    .filter((t): t is string => Boolean(t))
    .join("\n")
    .trim();
  // Use the most recent attachment in the burst as the representative image.
  const latestImageUrl = [...unanswered].reverse().find((m) => Boolean(m.imageUrl))?.imageUrl ?? null;

  const history = await loadHistory(conversationId);

  // ── Image turn: classify (shared vision) → payment slip or part search ──
  if (latestImageUrl) {
    const { classification, content } = await classifyMessengerImage(latestImageUrl);

    if (classification.kind === "payment_slip") {
      try {
        await ingestMessengerPaymentSlip({
          messengerConversationId: conversationId,
          content,
          ocr: classification.ocr ?? null,
        });
      } catch (error) {
        console.error(`[messenger] slip ingest failed: ${error instanceof Error ? error.message : "unknown"}`);
      }
      const reply = "ได้รับสลิปแล้วนะคะ 🙏 เดี๋ยวจูนตรวจสอบยอดโอนให้ค่ะ";
      await sendMessengerText({ pageAccessToken, psid, text: reply });
      await persistOutbound(conversationId, psid, reply, { intent: LineIntent.PAYMENT_SLIP_IMAGE });
      return;
    }

    if (classification.kind === "part_image") {
      const partRoute: ChatIntentRouteResult = {
        intent: LineIntent.PART_IMAGE_INQUIRY,
        allowsSearch: true,
        requiresAdmin: false,
        requiresImageAnalysis: false,
        requiresMoreInfo: false,
        reason: "MESSENGER_PART_IMAGE",
      };
      const replied = await replyWithProductSearch({
        pageAccessToken,
        conversationId,
        psid,
        route: partRoute,
        bridgeInput: {
          route: partRoute,
          text: mergedText || null,
          extractedPartNumber: classification.partNumber ?? null,
          extractedImageHints: classification.searchHints,
          fitmentHints: {
            categoryName: classification.partType ?? null,
            carBrandName: classification.carBrand ?? null,
            carModelName: classification.carModel ?? null,
            fitmentYear: classification.year ?? null,
          },
        },
        originalText: mergedText || "(ลูกค้าส่งรูปอะไหล่)",
        history,
      });
      if (replied) return;
    }

    // Unknown image (or part image with no query) — ask for details.
    const ack = "ได้รับรูปแล้วนะคะ 😊 รบกวนแจ้งรุ่นรถ/ปี หรือพิมพ์ชื่ออะไหล่ที่ต้องการเพิ่มเติมได้ไหมคะ เดี๋ยวจูนช่วยเช็กให้ค่ะ";
    await sendMessengerText({ pageAccessToken, psid, text: ack });
    await persistOutbound(conversationId, psid, ack, { intent: LineIntent.UNKNOWN });
    return;
  }

  if (!mergedText) return;

  const route = routeChatIntent({ messageType: LineMessageType.TEXT, text: mergedText });

  if (route.allowsSearch) {
    const replied = await replyWithProductSearch({
      pageAccessToken,
      conversationId,
      psid,
      route,
      bridgeInput: { route, text: mergedText },
      originalText: mergedText,
      history,
    });
    if (replied) return;
  }

  // ── Non-search intents: greeting / smalltalk / out-of-scope / conservative ──
  const group = intentToGroup(route.intent);
  let reply: string;
  if (group === "smalltalk" || group === "out_of_scope") {
    reply = await generateScopedConversationalReply({ group, latestText: mergedText, history });
  } else {
    const suggestion = await generateChatSuggestion({ intent: route.intent, originalText: mergedText, history });
    reply = suggestion.suggestedReply;
  }

  await sendMessengerText({ pageAccessToken, psid, text: reply });
  await persistOutbound(conversationId, psid, reply, { intent: route.intent });
}

async function loadHistory(conversationId: string): Promise<ChatHistoryItem[]> {
  const rows = await getRecentMessengerMessagesForAi(conversationId, RECENT_HISTORY_TAKE);
  return rows
    .filter((row) => Boolean(row.text))
    .map((row) => ({
      role: row.direction === LineMessageDirection.INBOUND ? ("customer" as const) : ("shop" as const),
      text: row.text ?? "",
    }));
}

/**
 * Shared product-inquiry reply used by both the text and part-image paths: runs
 * the shared catalog search, applies price visibility, asks the shared AI to draft
 * the reply, then sends text + product carousel and persists. Returns false when
 * the search decided not to run (caller falls back to a conservative reply).
 */
async function replyWithProductSearch(params: {
  pageAccessToken: string;
  conversationId: string;
  psid: string;
  route: ChatIntentRouteResult;
  bridgeInput: ChatProductSearchBridgeInput;
  originalText: string;
  history: ChatHistoryItem[];
}): Promise<boolean> {
  const productSearch = await searchChatProductInquiry(params.bridgeInput);
  if (!productSearch.searched) return false;

  const ids = productSearch.result.ids.slice(0, MAX_CAROUSEL_PRODUCTS);
  const showPrice = await resolveMessengerShowPrice(params.conversationId);
  const products: ChatMatchedProductSummary[] = applyChatPriceVisibility(
    await getChatProductSummaries(ids),
    showPrice,
  );

  const suggestion = await generateChatSuggestion({
    intent: params.route.intent,
    originalText: params.originalText,
    productSearch,
    history: params.history,
    products: products.map((p) => ({ name: p.name, code: p.code, salePrice: p.salePrice })),
  });

  await sendMessengerText({
    pageAccessToken: params.pageAccessToken,
    psid: params.psid,
    text: suggestion.suggestedReply,
  });
  if (products.length > 0) {
    await sendMessengerGenericTemplate({
      pageAccessToken: params.pageAccessToken,
      psid: params.psid,
      elements: products.map((p) => productToCarouselElement(p, showPrice)),
    });
  }
  await persistOutbound(params.conversationId, params.psid, suggestion.suggestedReply, {
    intent: params.route.intent,
    confidence: suggestion.confidence,
    matchedProducts: products,
    reasoningSummary: suggestion.reasoningSummary,
  });
  return true;
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
