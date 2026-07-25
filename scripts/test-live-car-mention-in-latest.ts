/**
 * test-live-car-mention-in-latest.ts
 *
 * Validates the `carMentionInLatest` contract field against the REAL Gemini
 * classifier, replayed over REAL production turns.
 *
 * Why this exists: the LINE inquiry frame carries the customer's vehicle across
 * turns. When a customer names a NEW car we fail to resolve, the frame used to
 * fall back to the PREVIOUS car and answer for the wrong vehicle (prod case
 * 2026-07-25: "พัดลมโบซิ้ตี้ปี12" answered with an ISUZU DECA blower because
 * "อีซูซุเดก้า270" was still in the session).
 *
 * `carMentionInLatest` is meant to answer the one question `carModel` cannot:
 * did the customer name a car in THIS message, or did the classifier merge one
 * from history? This script measures whether Gemini actually honours that.
 *
 * It replays every LINE turn from the last N days where the inquiry frame ended
 * up carrying a vehicle on a topic shift (`INQUIRY_FRAME` audit rows), rebuilds
 * the conversation history the processor would have passed, calls the live
 * classifier, and verifies the returned mention really occurs in the latest
 * text (the same substring check the processor will do).
 *
 * Read-only: reads LineAiAuditLog / LineMessage and calls Gemini. Writes nothing.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/test-live-car-mention-in-latest.ts
 *   npx tsx --env-file=.env.local scripts/test-live-car-mention-in-latest.ts --days=60
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma";
import { extractChatSearchIntent, type ChatReplyHistoryItem } from "../lib/chat-core/ai-service";
import { normalizeSearchText } from "../lib/search-normalization";

const DEFAULT_DAYS = 30;
/** Same window the processor feeds the classifier. */
const HISTORY_TURNS = 10;
/** Gap that ends a conversation session — mirrors SESSION_IDLE_MS. */
const SESSION_IDLE_MS = 120 * 60_000;

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter });

type FramePayload = {
  topicShift?: boolean;
  carBrand?: string | null;
  carModel?: string | null;
  year?: number | null;
  partType?: string | null;
  lineEventId?: string;
};

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
}

/** The verification the processor will run: the mention must really occur in the
 *  customer's latest text (spaces ignored — Thai is written without them). */
function mentionOccursInLatest(mention: string, latestText: string): boolean {
  const needle = normalizeSearchText(mention).replace(/\s+/g, "");
  const haystack = normalizeSearchText(latestText).replace(/\s+/g, "");
  return needle.length > 0 && haystack.includes(needle);
}

async function main(): Promise<void> {
  const days = Number(arg("days") ?? DEFAULT_DAYS);
  const since = new Date(Date.now() - days * 24 * 3600_000);

  const auditRows = await db.lineAiAuditLog.findMany({
    where: { action: "INQUIRY_FRAME", createdAt: { gte: since } },
    select: { createdAt: true, conversationId: true, payload: true },
    orderBy: { createdAt: "asc" },
  });

  // Turns where the frame ended up carrying a vehicle on a topic shift — exactly
  // the population where a wrong carry-over shows up as a wrong answer.
  const candidates = auditRows
    .map((row) => ({ at: row.createdAt, conversationId: row.conversationId, frame: row.payload as FramePayload }))
    .filter((row) => row.frame.topicShift === true && (row.frame.carModel || row.frame.carBrand) && row.frame.lineEventId);

  console.log(`window: last ${days} days | INQUIRY_FRAME turns: ${auditRows.length} | replaying: ${candidates.length}\n`);

  let mentionPresent = 0;
  let mentionNull = 0;
  let unverifiable = 0;
  let failed = 0;

  for (const candidate of candidates) {
    const eventId = candidate.frame.lineEventId!;
    const message = await db.lineMessage.findFirst({
      where: { lineEventId: eventId },
      select: { id: true, text: true, createdAt: true, conversationId: true },
    });
    if (!message?.text) continue; // image turns carry no text to check

    const priorRows = await db.lineMessage.findMany({
      where: { conversationId: message.conversationId, createdAt: { lt: message.createdAt }, text: { not: null } },
      select: { direction: true, text: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: HISTORY_TURNS,
    });
    const prior = priorRows.reverse();
    // Keep only the current session, like boundMessagesToSession does.
    let cut = 0;
    for (let i = 1; i < prior.length; i += 1) {
      if (prior[i].createdAt.getTime() - prior[i - 1].createdAt.getTime() > SESSION_IDLE_MS) cut = i;
    }
    const history: ChatReplyHistoryItem[] = prior.slice(cut).map((turn) => ({
      role: turn.direction === "INBOUND" ? "customer" : "shop",
      text: turn.text ?? "",
    }));

    const intent = await extractChatSearchIntent({
      intent: "PRODUCT_INQUIRY_TEXT",
      latestText: message.text,
      history,
    });

    if (!intent) {
      failed += 1;
      console.log(`❓ ${JSON.stringify(message.text.slice(0, 40))} → classifier unavailable`);
      continue;
    }

    const mention = intent.carMentionInLatest ?? null;
    const verified = mention ? mentionOccursInLatest(mention, message.text) : false;

    let verdict: string;
    if (!mention) {
      mentionNull += 1;
      verdict = "mention=null   → carry-over (unchanged)";
    } else if (verified) {
      mentionPresent += 1;
      verdict = `mention=${JSON.stringify(mention)} ✔ verified → this turn names a car`;
    } else {
      unverifiable += 1;
      verdict = `mention=${JSON.stringify(mention)} ✘ NOT in latest text → discarded`;
    }

    console.log(
      `${JSON.stringify(message.text.slice(0, 40)).padEnd(44)} ` +
        `frame=${candidate.frame.carBrand ?? "-"}/${candidate.frame.carModel ?? "-"} ` +
        `| ai=${intent.carBrand ?? "-"}/${intent.carModel ?? "-"} | ${verdict}`,
    );
  }

  console.log(
    `\nsummary: verified=${mentionPresent}  null=${mentionNull}  unverifiable=${unverifiable}  classifier-failed=${failed}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
