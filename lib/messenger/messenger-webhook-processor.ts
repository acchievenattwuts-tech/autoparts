import { LineConversationAiStatus, LineIntent, LineMessageDirection, LineMessageType } from "@/lib/generated/prisma";
import {
  buildJuneTextNoMatchHandoffReply,
  extractChatSearchIntent,
  generateChatSuggestion,
  generateScopedConversationalReply,
} from "@/lib/chat-core/ai-service";
import { intentToGroup } from "@/lib/chat-core/intent-groups";
import {
  buildDidYouMeanNote,
  CHAT_UNCERTAIN_PRODUCT_HANDOFF_REPLY,
  CHAT_VEHICLE_UNRESOLVED_HANDOFF_REPLY,
  decideChatSearchGate,
  isBroadChatPartType,
} from "@/lib/chat-core/search-gate";
import { routeChatIntent, type ChatIntentRouteResult } from "@/lib/chat-core/intent-router";
import { guardChatSearchIntent } from "@/lib/chat-core/search-guards";
import { resolveChatFitmentFilters, type ChatFitmentFilters } from "@/lib/chat-core/fitment-resolve";
import { correctPartSpelling } from "@/lib/chat-core/category-llm-fallback";
import { stageAiCategoryAlias } from "@/lib/chat-core/category-alias-staging";
import { loadCarBrandVariantLookup } from "@/lib/car-brand-alias-loader";
import { loadCarModelVariantLookup } from "@/lib/car-model-alias-loader";
import {
  applyChatPriceTier,
  getChatProductSummaries,
  resolveCatalogCodes,
  searchChatProductInquiry,
  type ChatProductSearchBridgeInput,
  type ChatMatchedProductSummary,
} from "@/lib/chat-core/product-search-bridge";
import { extractPriceProductSubjectsFromText } from "@/lib/chat-core/price-product-subjects";
import { extractChatRequiredSearchTokens } from "@/lib/chat-core/search-guards";
import { normalizeInboundChatQuery } from "@/lib/chat-core/text-normalize";
import { isDirectProductCodeToken } from "@/lib/product-search-required-tokens";
import {
  classifyMessengerImage,
  ingestMessengerPaymentSlip,
} from "@/lib/messenger/messenger-image-service";
import {
  notifyMessengerNeedsAdmin,
  notifyMessengerNewConversation,
  notifyMessengerPaymentSlip,
} from "@/lib/notifications";
import { getProductSlug } from "@/lib/product-slug";
import { SITE_URL } from "@/lib/seo";
import {
  DuplicateMessengerEventError,
  acquireMessengerConversationLock,
  appendMessengerMessage,
  bumpMessengerInboundSeq,
  escalateMessengerConversationToAdmin,
  findStalledMessengerConversationIds,
  getMessengerCoalesceState,
  getMessengerConversationPsid,
  getOrCreateMessengerConversation,
  getRecentMessengerMessagesForAi,
  getUnansweredMessengerMessages,
  markMessengerProcessedSeq,
  releaseMessengerConversationLock,
  resolveMessengerPriceTier,
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
// Meta's standard messaging window: an automated reply is only allowed within 24h
// of the customer's last message. Outside it, a generic auto-reply needs the
// human_agent tag (a separately-reviewed permission we don't rely on), so we skip
// the auto-reply rather than risk a Send API error / policy violation. The live
// flow always answers within seconds; this only guards stale cron-recovery turns.
const STANDARD_MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1_000;
// Stop debouncing after this much wall-clock and do one final reply, so a chatty
// customer can't push the owner past the 60s serverless ceiling.
const OWNER_FINAL_PASS_AFTER_MS = 28_000;
const EXPLICIT_PRODUCT_NOUN_RE =
  /(คอย(?:ล์)?\s*เย็น|คอม\s*แอร์|แผง\s*แอร์|กรอง\s*แอร์|หม้อ\s*น้ำ|พัด\s*ลม|วาล์ว|ไดเออร์|ดรายเออร์|ตู้\s*แอร์|น้ำยา|โอริง|สาย\s*น้ำยา)/i;
const LATIN_MODEL_YEAR_ANCHOR_RE = /\b[A-Za-z]{2,}\s+\d{2}(?:-\d{2})?\b/;

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

/** Fire a notification without ever breaking the business flow (Iron Rule: bell +
 *  Telegram together — createNotification handles both). */
function safeNotify(promise: Promise<unknown>): void {
  void promise.catch((error) => {
    console.warn(`[messenger] notification failed: ${error instanceof Error ? error.message : "unknown"}`);
  });
}

async function handoffUncertainMessengerProduct(input: {
  pageAccessToken: string;
  conversationId: string;
  psid: string;
  originalText: string;
  intent: LineIntent;
  /** Override reply; defaults to the generic uncertain-product handoff line. */
  text?: string;
}): Promise<void> {
  const text = input.text ?? CHAT_UNCERTAIN_PRODUCT_HANDOFF_REPLY;
  await escalateMessengerConversationToAdmin(input.conversationId);
  safeNotify(
    notifyMessengerNeedsAdmin({
      conversationId: input.conversationId,
      text: input.originalText,
      messageType: "TEXT",
    }),
  );
  await sendMessengerText({
    pageAccessToken: input.pageAccessToken,
    psid: input.psid,
    text,
  });
  await persistOutbound(input.conversationId, input.psid, text, {
    intent: input.intent,
  });
}

function productToCarouselElement(
  product: ChatMatchedProductSummary,
): MessengerGenericElement {
  const priceLine =
    product.salePrice > 0
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

/** Storefront "view all results" URL mirroring the applied fitment filters, so the
 *  web page shows the same set the customer saw in chat. */
function storefrontSearchUrl(
  query: string,
  filters: { categoryName: string | null; carBrandName: string | null; carModelName: string | null; fitmentYear: number | null },
): string {
  const params = new URLSearchParams();
  params.set("q", query);
  if (filters.categoryName) params.set("category", filters.categoryName);
  if (filters.carBrandName) params.set("brand", filters.carBrandName);
  if (filters.carModelName) params.set("model", filters.carModelName);
  if (filters.fitmentYear) params.set("year", String(filters.fitmentYear));
  return `${SITE_URL}/products?${params.toString()}`;
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

// How quiet a conversation must be before the cron treats it as stalled (a live
// owner debounces + replies well within this) — prevents racing a running owner.
const RECOVERY_QUIET_MS = 90_000;
const RECOVERY_BATCH_LIMIT = 50;

/**
 * Coalescing crash failsafe (run from the cron). If a webhook's after() dies
 * after persisting messages but before replying, the conversation is left with
 * unanswered messages and no live owner. This finds those (seq newer than
 * processed + lock free + quiet long enough) and re-runs the owner loop. The lock
 * + quiet window keep it from racing a still-running owner, so no duplicate reply.
 */
export async function recoverStalledMessengerConversations(
  config: MessengerProcessorConfig,
): Promise<{ recovered: number }> {
  const quietBefore = new Date(Date.now() - RECOVERY_QUIET_MS);
  const ids = await findStalledMessengerConversationIds({ quietBefore, take: RECOVERY_BATCH_LIMIT });

  let recovered = 0;
  for (const conversationId of ids) {
    const psid = await getMessengerConversationPsid(conversationId);
    if (!psid) continue;

    const owner = `cron-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const acquired = await acquireMessengerConversationLock({
      conversationId,
      owner,
      leaseMs: COALESCE_LEASE_MS,
    }).catch(() => false);
    if (!acquired) continue;

    try {
      await runMessengerOwnerLoop({ conversationId, psid, config });
      recovered += 1;
    } catch (error) {
      console.error(
        `[messenger] recovery owner loop failed for ${conversationId}: ${error instanceof Error ? error.message : "unknown"}`,
      );
    } finally {
      await releaseMessengerConversationLock({ conversationId, owner }).catch(() => undefined);
    }
  }
  return { recovered };
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

  const { conversation, created } = await getOrCreateMessengerConversation({
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

  // A brand-new customer just started chatting → alert admins (bell + Telegram).
  if (created) {
    safeNotify(
      notifyMessengerNewConversation({
        conversationId: conversation.id,
        displayName: conversation.displayName ?? displayName,
        text: event.text,
      }),
    );
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

  // 24-hour messaging window guard (only ever trips on stale cron-recovery turns).
  const newestInboundAt = unanswered.reduce(
    (max, m) => (m.createdAt > max ? m.createdAt : max),
    unanswered[0].createdAt,
  );
  if (Date.now() - newestInboundAt.getTime() > STANDARD_MESSAGING_WINDOW_MS) {
    console.warn(
      `[messenger] skipping auto-reply outside 24h window for ${conversationId} (last inbound ${newestInboundAt.toISOString()})`,
    );
    return;
  }

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
      safeNotify(notifyMessengerPaymentSlip({ conversationId }));
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
      // Product-code fast-path is allowed only when this image turn has no
      // explicit fitment evidence. If category / brand / model / year exists,
      // the fitment search path wins and code-like fragments stay as search tokens.
      const imageHasExplicitFitmentFilter = Boolean(
        classification.partType || classification.carBrand || classification.carModel || classification.year,
      );
      const directImageCode = imageHasExplicitFitmentFilter
        ? null
        : await resolveDirectProductCode([
            classification.partNumber,
            (classification.searchHints ?? []).join(" "),
            mergedText || null,
          ]);
      // Confidence gating (parity with LINE, "ห้ามเดา"):
      //  - HIGH  → the classifier's part/car/year become hard fitment filters.
      //  - MEDIUM → usable only as SOFT search hints (no hard filter that could
      //    pin the search to a wrong, uncertain car/part).
      //  - LOW   → guesses dropped entirely; if there's nothing else to search on
      //    (no resolved code, no accompanying text) we ask for details below
      //    rather than search blindly.
      const conf = classification.confidence;
      const canSearchImage = Boolean(directImageCode) || conf !== "LOW" || Boolean(mergedText);
      if (canSearchImage) {
        const useHardFilters = conf === "HIGH";
        const useHints = conf !== "LOW";
        const imageHints = [
          ...(classification.searchHints ?? []),
          ...(classification.partNumber ? [classification.partNumber] : []),
        ];
        const bridgeInput: ChatProductSearchBridgeInput = directImageCode
          ? { route: partRoute, text: null, extractedPartNumber: directImageCode }
          : {
              route: partRoute,
              text: mergedText || null,
              extractedPartNumber: null,
              extractedImageHints: useHints ? imageHints : null,
              fitmentHints: useHardFilters
                ? {
                    categoryName: classification.partType ?? null,
                    carBrandName: classification.carBrand ?? null,
                    carModelName: classification.carModel ?? null,
                    fitmentYear: classification.year ?? null,
                  }
                : undefined,
            };
        const replied = await replyWithProductSearch({
          pageAccessToken,
          conversationId,
          psid,
          route: partRoute,
          bridgeInput,
          originalText: mergedText || "(ลูกค้าส่งรูปอะไหล่)",
          history,
        });
        if (replied) return;
      }
    }

    // Unknown image (or part image with no query) — ask for details.
    const ack = "ได้รับรูปแล้วนะคะ 😊 รบกวนแจ้งรุ่นรถ/ปี หรือพิมพ์ชื่ออะไหล่ที่ต้องการเพิ่มเติมได้ไหมคะ เดี๋ยวจูนช่วยเช็กให้ค่ะ";
    await sendMessengerText({ pageAccessToken, psid, text: ack });
    await persistOutbound(conversationId, psid, ack, { intent: LineIntent.UNKNOWN });
    return;
  }

  if (!mergedText) return;

  const processText = normalizeInboundChatQuery(mergedText);
  const route = routeChatIntent({ messageType: LineMessageType.TEXT, text: processText });

  // ── Handoff: intents the AI must not answer (claims, price haggling, order
  // status…) escalate to a human admin instead of the AI guessing ──
  if (route.intent === LineIntent.PRICE_NEGOTIATION) {
    const priceSubjects = extractPriceProductSubjectsFromText(processText);
    if (priceSubjects.length > 0) {
      let repliedWithAnySearch = false;
      for (const subject of priceSubjects.slice(0, 3)) {
        const query = subject.query || subject.partType || processText;
        const replied = await replyWithProductSearch({
          pageAccessToken,
          conversationId,
          psid,
          route: MESSENGER_PRODUCT_ROUTE,
          bridgeInput: {
            route: MESSENGER_PRODUCT_ROUTE,
            text: query,
            fitmentHints: {
              categoryName: subject.partType,
              carBrandName: subject.carBrand,
              carModelName: subject.carModel,
              fitmentYear: subject.year,
            },
          },
          originalText: mergedText,
          history,
        });
        repliedWithAnySearch = repliedWithAnySearch || replied;
      }
      if (repliedWithAnySearch) {
        await escalateMessengerConversationToAdmin(conversationId);
        safeNotify(
          notifyMessengerNeedsAdmin({ conversationId, text: mergedText, messageType: "TEXT" }),
        );
        const reply = "จูนส่งเรื่องราคาให้แอดมินช่วยเช็กให้นะคะ 🙏 เดี๋ยวมีแอดมินติดต่อกลับค่ะ";
        await sendMessengerText({ pageAccessToken, psid, text: reply });
        await persistOutbound(conversationId, psid, reply, { intent: route.intent });
        return;
      }
    }
  }

  if (route.requiresAdmin) {
    await escalateMessengerConversationToAdmin(conversationId);
    safeNotify(
      notifyMessengerNeedsAdmin({ conversationId, text: mergedText, messageType: "TEXT" }),
    );
    const reply = "เรื่องนี้ขอส่งต่อให้แอดมินช่วยดูแลนะคะ 🙏 เดี๋ยวมีแอดมินติดต่อกลับค่ะ";
    await sendMessengerText({ pageAccessToken, psid, text: reply });
    await persistOutbound(conversationId, psid, reply, { intent: route.intent });
    return;
  }

  if (route.allowsSearch) {
    // Resolve precise category/brand/model/year hard filters (parity with LINE),
    // with the LLM spell-correction fallback + auto-stage when no category maps.
    const { fitmentPartHeadNoun, shouldHandoffUncertain, vehicleNamedButUnresolved, ...fitmentHints } =
      await resolveMessengerFitmentHints(processText, history);
    if (shouldHandoffUncertain) {
      await handoffUncertainMessengerProduct({
        pageAccessToken,
        conversationId,
        psid,
        originalText: mergedText,
        intent: route.intent,
      });
      return;
    }
    // Option A — customer named a car we couldn't lock to a fitment filter → confirm
    // the vehicle instead of running an unscoped search that lists other models'
    // parts as if they fit (parity with the LINE vehicle-unresolved guard).
    if (vehicleNamedButUnresolved) {
      await handoffUncertainMessengerProduct({
        pageAccessToken,
        conversationId,
        psid,
        originalText: mergedText,
        intent: route.intent,
        text: CHAT_VEHICLE_UNRESOLVED_HANDOFF_REPLY,
      });
      return;
    }
    const hasExplicitFitmentFilter = Boolean(
      fitmentPartHeadNoun ||
        fitmentHints.categoryName ||
        fitmentHints.carBrandName ||
        fitmentHints.carModelName ||
        fitmentHints.fitmentYear,
    );
    const directTextCode = hasExplicitFitmentFilter ? null : await resolveDirectProductCode([processText]);
    if (directTextCode) {
      const replied = await replyWithProductSearch({
        pageAccessToken,
        conversationId,
        psid,
        route: MESSENGER_PRODUCT_ROUTE,
        bridgeInput: { route: MESSENGER_PRODUCT_ROUTE, text: null, extractedPartNumber: directTextCode },
        originalText: mergedText,
        history,
      });
      if (replied) return;
    }
    const replied = await replyWithProductSearch({
      pageAccessToken,
      conversationId,
      psid,
      route,
      bridgeInput: { route, text: processText, fitmentHints, fitmentPartHeadNoun },
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

function shouldDirectNoMatchHandoff(input: {
  route: ChatIntentRouteResult;
  productSearch: Awaited<ReturnType<typeof searchChatProductInquiry>>;
  text: string;
}): boolean {
  if (
    input.route.intent !== LineIntent.PRODUCT_INQUIRY_TEXT ||
    !input.productSearch.searched ||
    input.productSearch.result.total > 0
  ) {
    return false;
  }

  // The customer named a SPECIFIC part that anchored to zero matches (fitment-part
  // precision anchor). This is a concrete request the shop lacks — hand off even
  // when the part word isn't in the hardcoded EXPLICIT_PRODUCT_NOUN_RE list.
  if (input.productSearch.reason === "SEARCHED_FITMENT_PART_NO_MATCH") {
    return true;
  }

  const requiredTokens = extractChatRequiredSearchTokens(input.text);
  return (
    EXPLICIT_PRODUCT_NOUN_RE.test(input.text) &&
    (requiredTokens.length > 0 || LATIN_MODEL_YEAR_ANCHOR_RE.test(input.text))
  );
}

// Product route used by the product-code fast-path (a resolved code identifies the
// item, so we search directly regardless of the layer-1 regex intent).
const MESSENGER_PRODUCT_ROUTE: ChatIntentRouteResult = {
  intent: LineIntent.PRODUCT_INQUIRY_TEXT,
  allowsSearch: true,
  requiresAdmin: false,
  requiresImageAnalysis: false,
  requiresMoreInfo: false,
  reason: "MESSENGER_PRODUCT_CODE_DIRECT",
};

/**
 * Product-code fast-path (mirrors the LINE processor's Option A). A customer who
 * browsed the shop site/app often sends the product's code ("สอบถามราคา P0368") or
 * an image whose OCR captured the printed part number. Gathers code-like tokens
 * from the given sources, validates them against the catalog, and returns the first
 * one that resolves — the caller then runs an exact-code search (no fitment filters,
 * bypassing price/admin escalation) so the AI answers with that product directly.
 */
async function resolveDirectProductCode(sources: Array<string | null | undefined>): Promise<string | null> {
  const candidates = Array.from(
    new Set(
      sources
        .filter((s): s is string => Boolean(s))
        .flatMap((s) => extractChatRequiredSearchTokens(s))
        .filter((token) => isDirectProductCodeToken(token))
        .filter(Boolean),
    ),
  );
  if (candidates.length === 0) return null;
  const resolved = new Set(await resolveCatalogCodes(candidates).catch(() => [] as string[]));
  return candidates.find((code) => resolved.has(code)) ?? null;
}

/**
 * Category/fitment resolution for a Messenger product text turn — parity with the
 * LINE pipeline so Messenger applies the SAME precise hard filters (category /
 * brand / model / year) instead of a bare free-text search.
 *
 * Flow (all best-effort, safety-first — any failure degrades to no hard filter):
 *  1. classify the text (Gemini) → part/car/year, evidence-gated by `guardChatSearchIntent`.
 *  2. `resolveChatFitmentFilters` → canonical category / brand / model.
 *  3. LLM fallback when no category resolves: correct the (misspelled) part word,
 *     re-map through the SAME deterministic resolver, apply only if it yields one
 *     category, and stage the misspelling as a PENDING alias for admin review.
 *
 * Messenger has no persistent inquiry-frame, so resolution is scoped to the
 * current turn's text (with history only for the classifier's own context).
 */
async function resolveMessengerFitmentHints(
  processText: string,
  history: ChatHistoryItem[],
): Promise<{
  categoryName: string | null;
  carBrandName: string | null;
  carModelName: string | null;
  fitmentYear: number | null;
  /** Specific customer-named part that resolved to no category — anchors the
   *  search so it can't drift to model-only unrelated parts (parity with LINE). */
  fitmentPartHeadNoun: string | null;
  shouldHandoffUncertain: boolean;
  /** Option A — customer named a car model (evidence-grounded) that did NOT resolve
   *  to a hard fitment filter (no model/brand scope). Search would be unscoped, so
   *  the caller confirms the vehicle instead of showing other models' parts. */
  vehicleNamedButUnresolved: boolean;
}> {
  const empty = {
    categoryName: null,
    carBrandName: null,
    carModelName: null,
    fitmentYear: null,
    fitmentPartHeadNoun: null,
    shouldHandoffUncertain: false,
    vehicleNamedButUnresolved: false,
  };
  try {
    const rawIntent = await extractChatSearchIntent({
      intent: LineIntent.PRODUCT_INQUIRY_TEXT,
      latestText: processText,
      history,
    }).catch(() => null);
    if (!rawIntent) {
      return { ...empty, shouldHandoffUncertain: true };
    }
    const [brandLookup, modelLookup] = await Promise.all([
      loadCarBrandVariantLookup().catch(() => null),
      loadCarModelVariantLookup().catch(() => null),
    ]);
    const guarded = guardChatSearchIntent({ intent: rawIntent, latestText: processText, history, brandLookup, modelLookup });
    const gi = guarded.intent;

    const gateDecision = gi
      ? decideChatSearchGate({
          partType: gi.partType,
          carBrand: gi.carBrand,
          carModel: gi.carModel,
          year: gi.year,
          partKind: gi.partKind,
          tooBroad: gi.tooBroad,
        })
      : null;
    if (
      isBroadChatPartType(gi?.partType) ||
      isBroadChatPartType(processText) ||
      gateDecision?.reason === "BROAD_PART_TYPE"
    ) {
      return { ...empty, shouldHandoffUncertain: true };
    }

    let filters = await resolveChatFitmentFilters({
      partType: gi?.partType ?? null,
      carBrand: gi?.carBrand ?? null,
      carModel: gi?.carModel ?? null,
      queryText: processText,
      rawText: processText,
    }).catch((): ChatFitmentFilters => ({}));

    // LLM category fallback + auto-stage (same helpers/behaviour as LINE).
    if (!filters.categoryName) {
      const correction = await correctPartSpelling(processText, {
        carBrand: gi?.carBrand ?? filters.carBrandName ?? null,
        carModel: gi?.carModel ?? filters.carModelName ?? null,
      }).catch(() => null);
      if (correction?.corrected) {
        const remapped = await resolveChatFitmentFilters({
          partType: correction.corrected,
          carBrand: gi?.carBrand ?? null,
          carModel: gi?.carModel ?? null,
          queryText: correction.corrected,
          rawText: correction.corrected,
        }).catch((): ChatFitmentFilters => ({}));
        if (remapped.categoryName) {
          filters = {
            ...filters,
            categoryName: remapped.categoryName,
            carBrandName: filters.carBrandName ?? remapped.carBrandName,
            carModelName: filters.carModelName ?? remapped.carModelName,
          };
          void stageAiCategoryAlias({
            alias: correction.original,
            categoryName: remapped.categoryName,
            correctedTerm: correction.corrected,
            originalText: correction.original,
          }).catch(() => undefined);
        }
      }
    }

    // Specific customer-named part that still resolved to no category → anchor it
    // so the search returns "no direct match" instead of drifting to unrelated
    // same-car parts. Generic catch-alls ("อะไหล่แอร์…") are excluded.
    const fitmentPartHeadNoun =
      !filters.categoryName && gi?.partType && !gi.partType.includes("อะไหล่") ? gi.partType : null;

    const vehicleNamedButUnresolved =
      Boolean(gi?.carModel) && !filters.carModelName && !filters.carBrandName;

    return {
      categoryName: filters.categoryName ?? null,
      carBrandName: filters.carBrandName ?? null,
      carModelName: filters.carModelName ?? null,
      fitmentYear: gi?.year ?? null,
      fitmentPartHeadNoun,
      shouldHandoffUncertain: false,
      vehicleNamedButUnresolved,
    };
  } catch {
    return empty;
  }
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

  if (
    shouldDirectNoMatchHandoff({
      route: params.route,
      productSearch,
      text: params.bridgeInput.text ?? params.originalText,
    })
  ) {
    await escalateMessengerConversationToAdmin(params.conversationId);
    safeNotify(
      notifyMessengerNeedsAdmin({
        conversationId: params.conversationId,
        text: params.originalText,
        messageType: "TEXT",
      }),
    );
    // Part-aware acknowledgement ("สำหรับ<part> <car> ปี <ปี>…") so the customer
    // sees we understood the exact request before the hand-off. Part label prefers
    // the customer's own word; car/year come from the resolved fitment hints.
    const handoffMessage = buildJuneTextNoMatchHandoffReply({
      partType: params.bridgeInput.fitmentPartHeadNoun ?? params.bridgeInput.fitmentHints?.categoryName ?? null,
      carBrand: params.bridgeInput.fitmentHints?.carBrandName ?? null,
      carModel: params.bridgeInput.fitmentHints?.carModelName ?? null,
      year: params.bridgeInput.fitmentHints?.fitmentYear ?? null,
    });
    await sendMessengerText({
      pageAccessToken: params.pageAccessToken,
      psid: params.psid,
      text: handoffMessage,
    });
    await persistOutbound(params.conversationId, params.psid, handoffMessage, {
      intent: params.route.intent,
    });
    return true;
  }

  const ids = productSearch.result.ids.slice(0, MAX_CAROUSEL_PRODUCTS);
  // Resolve the price tier; a transient DB failure must NOT silently fall back to
  // retail pricing (a wholesale/garage customer would see the wrong, higher price).
  // "UNKNOWN" makes applyChatPriceTier hide every price behind "สอบถามราคา".
  const priceTier = await resolveMessengerPriceTier(params.conversationId).catch(() => "UNKNOWN" as const);
  const products: ChatMatchedProductSummary[] = applyChatPriceTier(
    await getChatProductSummaries(ids).catch(() => []),
    priceTier,
  );

  // The search matched rows but none are showable (all filtered out by
  // getChatProductSummaries — product inactive / hidden / fetch failed). Sending a
  // reply with an empty carousel and no admin notified is a silent dead-end, so
  // hand off to a human instead.
  if (productSearch.result.total > 0 && products.length === 0) {
    await escalateMessengerConversationToAdmin(params.conversationId);
    safeNotify(
      notifyMessengerNeedsAdmin({
        conversationId: params.conversationId,
        text: params.originalText,
        messageType: "TEXT",
      }),
    );
    const reply =
      "จูนเจอรายการที่ใกล้เคียงแต่ยังตรวจสอบรายละเอียดเพิ่มอีกนิดนะคะ 🙏 ขอส่งต่อให้แอดมินช่วยเช็กและติดต่อกลับค่ะ";
    await sendMessengerText({ pageAccessToken: params.pageAccessToken, psid: params.psid, text: reply });
    await persistOutbound(params.conversationId, params.psid, reply, { intent: params.route.intent });
    return true;
  }

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
    const elements = products.map((p) => productToCarouselElement(p));
    // Append a "view all on web" card when the catalog has more matches than the
    // carousel shows, linking to the storefront filtered to the same result set.
    if (productSearch.result.total > products.length) {
      const url = storefrontSearchUrl(productSearch.query, productSearch.appliedFilters);
      elements.push({
        title: `ดูสินค้าทั้งหมด ${productSearch.result.total} รายการ`,
        subtitle: "เปิดหน้าเว็บเพื่อดูรายการที่ตรงกันทั้งหมด",
        defaultActionUrl: url,
        buttons: [{ type: "web_url", title: "ดูทั้งหมดบนเว็บ", url }],
      });
    }
    await sendMessengerGenericTemplate({
      pageAccessToken: params.pageAccessToken,
      psid: params.psid,
      elements,
    });
  }
  // Transparency note when these results came from a "did you mean" recovery (the
  // original query found nothing; best-guess spelling/synonym match with the year
  // filter dropped) so a corrected match never reads as an exact hit.
  if (products.length > 0 && productSearch.didYouMean) {
    const note = buildDidYouMeanNote(productSearch.didYouMean);
    await sendMessengerText({ pageAccessToken: params.pageAccessToken, psid: params.psid, text: note });
    await persistOutbound(params.conversationId, params.psid, note, { intent: params.route.intent });
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
