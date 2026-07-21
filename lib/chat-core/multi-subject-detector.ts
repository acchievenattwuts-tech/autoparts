import { getCachedCategoryAliasRows } from "@/lib/category-alias-cache";
import {
  matchAllCategoryAliasRows,
  type CategoryAliasEvidence,
  type CategoryAliasResolverRow,
} from "@/lib/category-alias-resolver";
import type { ChatSearchIntent, ChatSubject } from "@/lib/chat-core/ai-service";

export type ChatMultiSubjectDetection = {
  subjects: ChatSubject[] | null;
  source: "llm" | "category_mapping" | "none";
  handoffReason: "AMBIGUOUS_VEHICLE_BINDING" | "CANONICAL_MAPPING_UNAVAILABLE" | null;
  categories: string[];
};

const NEGATED_MULTI_RE = /ไม่(?:เอา|ต้องการ|ใช้|หา)|ตัด\s*\S+\s*ออก/i;
const REPLACE_CUE_RE = /แทน|เปลี่ยนเป็น|ไม่เอา.*แล้ว|ไม่เอาแล้ว|เอาเป็น/i;
const BETWEEN_SHARED_CONNECTOR_RE = /(?:\s|[/,;+&]|และ|กับ|พร้อม|รวม|รวมถึง|คู่กับ|พร้อมกับ)+/gi;
const DISTINCT_TRAILING_VEHICLE_RE = /\b[A-Za-z][A-Za-z0-9-]{1,}\b|\b(?:19|20)?\d{2}\b/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasAmbiguousBetweenText(
  text: string,
  matches: CategoryAliasEvidence[],
  intent: ChatSearchIntent | null,
): boolean {
  const normalized = text.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  const sharedVehicleTokens = [intent?.carBrand, intent?.carModel, intent?.year?.toString()]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.normalize("NFKC").trim().toLowerCase())
    .sort((a, b) => b.length - a.length);
  const ordered = [...matches].sort((a, b) => a.start - b.start);
  for (let index = 0; index < ordered.length - 1; index += 1) {
    let between = normalized.slice(ordered[index].end, ordered[index + 1].start);
    for (const token of sharedVehicleTokens) {
      between = between.replace(new RegExp(escapeRegExp(token), "gi"), " ");
    }
    if (between.replace(BETWEEN_SHARED_CONNECTOR_RE, "").trim()) return true;
  }
  let trailing = normalized.slice(ordered.at(-1)?.end ?? normalized.length);
  for (const token of sharedVehicleTokens) {
    trailing = trailing.replace(new RegExp(escapeRegExp(token), "gi"), " ");
  }
  if (DISTINCT_TRAILING_VEHICLE_RE.test(trailing)) return true;
  return false;
}

function subjectQuery(
  alias: string,
  intent: ChatSearchIntent | null,
): string {
  return [
    alias,
    intent?.carBrand,
    intent?.carModel,
    intent?.year === null || intent?.year === undefined ? null : String(intent.year),
  ]
    .filter(Boolean)
    .join(" ");
}

function areLlmSubjectsCanonicallyVerified(input: {
  subjects: ChatSubject[];
  rows: CategoryAliasResolverRow[];
  rawEvidence: CategoryAliasEvidence[];
}): boolean {
  const rawCategoryIds = new Set(input.rawEvidence.map((match) => match.categoryId));
  const subjectCategoryIds = new Set<string>();

  for (const subject of input.subjects) {
    const evidence = matchAllCategoryAliasRows(subject.partType, input.rows);
    if (evidence.skippedBy || evidence.matches.length !== 1) return false;
    const categoryId = evidence.matches[0].categoryId;
    if (!rawCategoryIds.has(categoryId) || subjectCategoryIds.has(categoryId)) return false;
    subjectCategoryIds.add(categoryId);
  }

  return subjectCategoryIds.size >= 2;
}

export function detectChatMultiSubjectsFromRows(input: {
  text?: string | null;
  intent?: ChatSearchIntent | null;
  rows: CategoryAliasResolverRow[];
}): ChatMultiSubjectDetection {
  const text = input.text?.trim() ?? "";
  const llmSubjects = input.intent?.subjects?.filter((subject) => subject.partType) ?? [];

  // Replacement is already handled by each channel's latest-subject policy. Do
  // not synthesize additional old subjects from words the customer rejected.
  if (REPLACE_CUE_RE.test(text) || NEGATED_MULTI_RE.test(text)) {
    return {
      subjects: null,
      source: "none",
      handoffReason: null,
      categories: [],
    };
  }

  const evidence = matchAllCategoryAliasRows(text, input.rows);
  if (evidence.skippedBy || evidence.matches.length < 2) {
    return {
      subjects: null,
      source: "none",
      handoffReason: null,
      categories: evidence.matches.map((match) => match.categoryName),
    };
  }

  const categories = evidence.matches.map((match) => match.categoryName);
  if (
    llmSubjects.length >= 2 &&
    areLlmSubjectsCanonicallyVerified({
      subjects: llmSubjects,
      rows: input.rows,
      rawEvidence: evidence.matches,
    })
  ) {
    return { subjects: llmSubjects, source: "llm", handoffReason: null, categories };
  }

  // Substantive text between two part mentions usually binds a different vehicle
  // to each part ("คอยเย็น D-Max กับวาล์ว Triton"). Without per-subject LLM
  // structure, sharing the top-level vehicle would be unsafe.
  if (hasAmbiguousBetweenText(text, evidence.matches, input.intent ?? null)) {
    return { subjects: null, source: "none", handoffReason: "AMBIGUOUS_VEHICLE_BINDING", categories };
  }

  return {
    subjects: evidence.matches.map((match) => ({
      partType: match.alias,
      carBrand: input.intent?.carBrand ?? null,
      carModel: input.intent?.carModel ?? null,
      year: input.intent?.year ?? null,
      partKind: input.intent?.partKind ?? null,
      query: subjectQuery(match.alias, input.intent ?? null),
    })),
    source: "category_mapping",
    handoffReason: null,
    categories,
  };
}

async function loadActiveCategoryAliasRows(): Promise<CategoryAliasResolverRow[]> {
  // Lazy import keeps pure detector tests and channel mocks from opening a DB
  // pool. Production only loads Prisma when mapping evidence is actually needed.
  const { db } = await import("@/lib/db");
  return getCachedCategoryAliasRows(() =>
    db.categoryAlias.findMany({
      where: {
        isActive: true,
        OR: [{ kind: "SKIP_CATEGORY" }, { kind: "MATCH", category: { isActive: true } }],
      },
      select: {
        alias: true,
        kind: true,
        matchMode: true,
        priority: true,
        isActive: true,
        category: { select: { id: true, name: true, isActive: true } },
      },
    }),
  );
}

export async function detectChatMultiSubjects(input: {
  text?: string | null;
  intent?: ChatSearchIntent | null;
}): Promise<ChatMultiSubjectDetection> {
  try {
    return detectChatMultiSubjectsFromRows({ ...input, rows: await loadActiveCategoryAliasRows() });
  } catch {
    const llmClaimsMultipleSubjects =
      (input.intent?.subjects?.filter((subject) => subject.partType).length ?? 0) >= 2;
    return {
      // Fail closed: without canonical rows, LLM multi-subjects cannot be proven
      // distinct/non-overlapping. The normal single-subject/handoff path remains.
      subjects: null,
      source: "none",
      handoffReason: llmClaimsMultipleSubjects ? "CANONICAL_MAPPING_UNAVAILABLE" : null,
      categories: [],
    };
  }
}
