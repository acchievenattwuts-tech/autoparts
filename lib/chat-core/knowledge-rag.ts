import { createHash } from "crypto";
import { Prisma } from "@/lib/generated/prisma";
import { db } from "@/lib/db";
import { generateGeminiContent } from "@/lib/google-ai-client";
import {
  embedKnowledgeQuery,
  getKnowledgeEmbeddingModelId,
  isKnowledgeRagEnabled,
  toKnowledgePgVectorLiteral,
} from "@/lib/knowledge-embeddings";
import { CHAT_CALL_TIMEOUT_MS, CHAT_MAX_KEY_ATTEMPTS } from "@/lib/chat-core/ai-service";
import { detectAdminOnlyKnowledgeTopic } from "@/lib/chat-core/admin-only-knowledge";

export type KnowledgeChatChannel = "line" | "messenger";
export type KnowledgeCitation = { id: string; title: string; url: string | null };
export type KnowledgeRagAnswer = {
  answered: boolean;
  reply: string;
  citations: KnowledgeCitation[];
};

type KnowledgeRow = {
  id: string;
  title: string;
  section_heading: string;
  content: string;
  answer_scope: string;
  source_urls: unknown;
  semantic_score: number;
  lexical_score: number;
  hybrid_score: number;
};

const NOT_ANSWERED: KnowledgeRagAnswer = { answered: false, reply: "", citations: [] };
const TOP_K = 5;
const HUMAN_ONLY_QUESTION_RE =
  /(ราคา|กี่บาท|เท่าไหร่|เท่าไร|สต็อก|มีของ|มีสินค้า|พร้อมส่ง|เก็บเงินปลายทาง|\bcod\b|ใบเสนอราคา|เลขบัญชี|โอนเงิน|ตรวจสลิป|สถานะออเดอร์|เลขพัสดุ|อนุมัติเคลม|ตรงรุ่น|ใส่ได้ไหม|ใช้ได้ไหม)/i;

type KnowledgeRagOutcome =
  | "DISABLED"
  | "HUMAN_ONLY"
  | "NO_RETRIEVAL"
  | "ANSWERED"
  | "UNSUPPORTED"
  | "GENERATION_ERROR";

function queryHash(question: string): string {
  return createHash("sha256")
    .update(question.trim().toLocaleLowerCase("th-TH"))
    .digest("hex")
    .slice(0, 16);
}

function emitKnowledgeRagTelemetry(input: {
  question: string;
  channel: KnowledgeChatChannel;
  outcome: KnowledgeRagOutcome;
  startedAt: number;
  rows?: KnowledgeRow[];
}): void {
  const topScore = input.rows?.[0]?.hybrid_score;
  console.info(
    "[knowledge-rag]",
    JSON.stringify({
      event: "KNOWLEDGE_RAG_QUERY",
      channel: input.channel,
      queryHash: queryHash(input.question),
      outcome: input.outcome,
      latencyMs: Date.now() - input.startedAt,
      retrievedCount: input.rows?.length ?? 0,
      topHybridScore:
        topScore === undefined ? null : Number(Number(topScore).toFixed(4)),
      embeddingModel: getKnowledgeEmbeddingModelId(),
    }),
  );
}

function threshold(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : fallback;
}

function firstUrl(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const url = value.find((item): item is string => typeof item === "string" && /^https?:\/\//.test(item));
  return url ?? null;
}

export function parseGroundedKnowledgeAnswer(
  raw: string,
  rows: KnowledgeRow[],
): KnowledgeRagAnswer {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return NOT_ANSWERED;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      answerSupported?: unknown;
      reply?: unknown;
      citations?: unknown;
    };
    const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
    const requestedIds = Array.isArray(parsed.citations)
      ? parsed.citations.filter((id): id is string => typeof id === "string")
      : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const citations = [...new Set(requestedIds)]
      .map((id) => byId.get(id))
      .filter((row): row is KnowledgeRow => Boolean(row))
      .map((row) => ({ id: row.id, title: row.title, url: firstUrl(row.source_urls) }));
    if (parsed.answerSupported !== true || !reply || citations.length === 0) return NOT_ANSWERED;
    return { answered: true, reply, citations };
  } catch {
    return NOT_ANSWERED;
  }
}

export async function retrieveKnowledgeDocuments(question: string): Promise<KnowledgeRow[]> {
  const vector = await embedKnowledgeQuery(question);
  if (!vector) return [];
  const vectorLiteral = toKnowledgePgVectorLiteral(vector);
  const modelId = getKnowledgeEmbeddingModelId();

  try {
    const rows = await db.$queryRaw<KnowledgeRow[]>(Prisma.sql`
      WITH scored AS (
        SELECT
          id, title, section_heading, content, answer_scope, source_urls,
          GREATEST(0, 1 - (embedding <=> ${vectorLiteral}::vector))::double precision AS semantic_score,
          GREATEST(
            similarity(f_unaccent(lower(search_text)), f_unaccent(lower(${question}))),
            ts_rank_cd(search_document, plainto_tsquery('simple', f_unaccent(${question})))
          )::double precision AS lexical_score
        FROM knowledge_documents
        WHERE status = 'APPROVED'
          AND embedding IS NOT NULL
          AND embedding_model = ${modelId}
          -- These sources stay public on the storefront, but chat policy makes
          -- warranty/returns and shipping admin-only even if older approved
          -- chunks still exist in production before the next CMS revision.
          AND source_ref NOT IN (
            'policy:return-warranty',
            'return-warranty-policy',
            'faq:storefront:6',
            'faq:storefront:7'
          )
          AND (valid_until IS NULL OR valid_until > now())
      )
      SELECT *, (semantic_score * 0.8 + LEAST(lexical_score, 1) * 0.2)::double precision AS hybrid_score
      FROM scored
      WHERE semantic_score >= ${threshold("KNOWLEDGE_RAG_MIN_SEMANTIC", 0.55)}
      ORDER BY hybrid_score DESC
      LIMIT ${TOP_K}
    `);
    const minHybrid = threshold("KNOWLEDGE_RAG_MIN_HYBRID", 0.52);
    return rows.filter((row) => Number(row.hybrid_score) >= minHybrid);
  } catch (error) {
    console.warn(
      "[knowledge-rag]",
      JSON.stringify({
        event: "KNOWLEDGE_RAG_RETRIEVAL_ERROR",
        queryHash: queryHash(question),
        embeddingModel: modelId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return [];
  }
}

export async function answerFromKnowledgeRag(input: {
  text?: string | null;
  channel: KnowledgeChatChannel;
}): Promise<KnowledgeRagAnswer> {
  const question = input.text?.trim();
  if (!question) return NOT_ANSWERED;
  const startedAt = Date.now();
  const finish = (
    outcome: KnowledgeRagOutcome,
    answer: KnowledgeRagAnswer,
    rows?: KnowledgeRow[],
  ) => {
    emitKnowledgeRagTelemetry({
      question,
      channel: input.channel,
      outcome,
      startedAt,
      rows,
    });
    return answer;
  };
  if (!isKnowledgeRagEnabled()) return finish("DISABLED", NOT_ANSWERED);
  // Operational/high-stakes questions are routed to the existing human/product
  // flows before retrieval. This guard is defense in depth if intent classification
  // ever misfiles such a turn as general_faq/other.
  if (HUMAN_ONLY_QUESTION_RE.test(question) || detectAdminOnlyKnowledgeTopic(question)) {
    return finish("HUMAN_ONLY", NOT_ANSWERED);
  }

  const rows = await retrieveKnowledgeDocuments(question);
  if (rows.length === 0) return finish("NO_RETRIEVAL", NOT_ANSWERED);

  const context = rows
    .map(
      (row) =>
        `<source id="${row.id}">\nหัวข้อ: ${row.title}\nส่วน: ${row.section_heading}\nข้อมูล: ${row.content}\nขอบเขตคำตอบ: ${row.answer_scope}\n</source>`,
    )
    .join("\n\n");
  const channelName = input.channel === "line" ? "LINE" : "Facebook Messenger";

  try {
    const { text } = await generateGeminiContent({
      prompt: `ช่องทางปัจจุบัน: ${channelName}\nคำถามลูกค้า: ${question}\n\nแหล่งข้อมูลที่ค้นคืนได้:\n${context}`,
      systemInstruction: [
        'คุณคือ "จูน" ผู้ช่วยร้านศรีวรรณอะไหล่แอร์ ตอบภาษาไทยแบบสุภาพ กระชับ เป็นกันเอง และลงท้ายด้วย "ค่ะ"',
        "ตอบได้เฉพาะข้อเท็จจริงที่รองรับโดยแหล่งข้อมูลที่ให้มาเท่านั้น ห้ามใช้ความจำภายนอกหรือเดา",
        "ห้ามใช้ RAG ยืนยันหรือแนะนำสินค้า ราคา สต็อก โปรโมชัน ความตรงรุ่น/fitment การชำระเงิน ออเดอร์ ใบเสนอราคา COD บริษัทขนส่ง วันส่ง/วันถึง ผลวินิจฉัย การรับประกันเฉพาะสินค้า หรือผลเคลม",
        "หากคำถามต้องให้แอดมินดำเนินการ มีข้อมูลไม่พอ แหล่งข้อมูลขัดกัน หรือไม่มีข้อความรองรับตรงคำถาม ให้ answerSupported=false",
        `ลูกค้าอยู่ในแชต ${channelName} นี้แล้ว ห้ามบอกให้ย้ายไปติดต่อช่องทางเดิม ให้ขอส่งต่อแอดมินในแชตนี้แทนเมื่อจำเป็น`,
        'คืน JSON ล้วน: {"answerSupported":true|false,"reply":"ข้อความตอบหรือสตริงว่าง","citations":["source-id"]}',
        "citations ต้องมีอย่างน้อย 1 id ที่ใช้ตอบจริง และต้องเป็น id จากแหล่งข้อมูลที่ให้มาเท่านั้น",
      ].join("\n"),
      json: true,
      maxOutputTokens: 450,
      temperature: 0.1,
      thinkingLevel: "NONE",
      timeoutMs: CHAT_CALL_TIMEOUT_MS,
      maxKeyAttempts: CHAT_MAX_KEY_ATTEMPTS,
    });
    const answer = parseGroundedKnowledgeAnswer(text, rows);
    return finish(answer.answered ? "ANSWERED" : "UNSUPPORTED", answer, rows);
  } catch {
    return finish("GENERATION_ERROR", NOT_ANSWERED, rows);
  }
}
