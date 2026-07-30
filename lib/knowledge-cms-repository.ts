import { cache } from "react";
import { db } from "@/lib/db";
import { parseKnowledgeContent, type KnowledgeContent } from "@/lib/knowledge-cms-types";
import type { KnowledgeRevisionStatus, KnowledgeSourceType } from "@/lib/generated/prisma";

export type ActiveKnowledgeEntry = {
  sourceId: string;
  sourceKey: string;
  type: KnowledgeSourceType;
  slug: string | null;
  revisionId: string;
  revisionNo: number;
  title: string;
  description: string | null;
  category: string | null;
  content: KnowledgeContent;
  answerScope: string;
  riskLevel: "LOW" | "MEDIUM";
  ragEnabled: boolean;
  sourceUrls: string[];
  activatedAt: Date | null;
  updatedAt: Date;
};

function toEntry(row: {
  id: string;
  sourceKey: string;
  type: KnowledgeSourceType;
  slug: string | null;
  activeRevision: {
    id: string;
    revisionNo: number;
    title: string;
    description: string | null;
    category: string | null;
    content: unknown;
    answerScope: string;
    riskLevel: "LOW" | "MEDIUM";
    ragEnabled: boolean;
    sourceUrls: unknown;
    activatedAt: Date | null;
    updatedAt: Date;
  } | null;
}): ActiveKnowledgeEntry | null {
  if (!row.activeRevision) return null;
  const urls = Array.isArray(row.activeRevision.sourceUrls)
    ? row.activeRevision.sourceUrls.filter((item): item is string => typeof item === "string")
    : [];
  return {
    sourceId: row.id,
    sourceKey: row.sourceKey,
    type: row.type,
    slug: row.slug,
    revisionId: row.activeRevision.id,
    revisionNo: row.activeRevision.revisionNo,
    title: row.activeRevision.title,
    description: row.activeRevision.description,
    category: row.activeRevision.category,
    content: parseKnowledgeContent(row.activeRevision.content),
    answerScope: row.activeRevision.answerScope,
    riskLevel: row.activeRevision.riskLevel,
    ragEnabled: row.activeRevision.ragEnabled,
    sourceUrls: urls,
    activatedAt: row.activeRevision.activatedAt,
    updatedAt: row.activeRevision.updatedAt,
  };
}

const activeSelect = {
  id: true,
  sourceKey: true,
  type: true,
  slug: true,
  activeRevision: {
    select: {
      id: true,
      revisionNo: true,
      title: true,
      description: true,
      category: true,
      content: true,
      answerScope: true,
      riskLevel: true,
      ragEnabled: true,
      sourceUrls: true,
      activatedAt: true,
      updatedAt: true,
    },
  },
} as const;

export const listActiveKnowledgeEntries = cache(async (type?: KnowledgeSourceType): Promise<ActiveKnowledgeEntry[]> => {
  const rows = await db.knowledgeSource.findMany({
    where: { isArchived: false, activeRevisionId: { not: null }, ...(type ? { type } : {}) },
    select: activeSelect,
    orderBy: [{ type: "asc" }, { updatedAt: "desc" }],
  });
  return rows.map(toEntry).filter((item): item is ActiveKnowledgeEntry => Boolean(item));
});

export const getActiveKnowledgeBySlug = cache(async (slug: string): Promise<ActiveKnowledgeEntry | null> => {
  const row = await db.knowledgeSource.findFirst({
    where: { slug, isArchived: false, activeRevisionId: { not: null } },
    select: activeSelect,
  });
  return row ? toEntry(row) : null;
});

export const getActiveKnowledgeByKey = cache(async (sourceKey: string): Promise<ActiveKnowledgeEntry | null> => {
  const row = await db.knowledgeSource.findFirst({
    where: { sourceKey, isArchived: false, activeRevisionId: { not: null } },
    select: activeSelect,
  });
  return row ? toEntry(row) : null;
});

export type KnowledgeListFilters = {
  query?: string;
  type?: KnowledgeSourceType;
  status?: KnowledgeRevisionStatus;
};

export async function listKnowledgeAdmin(filters: KnowledgeListFilters = {}) {
  return db.knowledgeSource.findMany({
    where: {
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.query ? {
        OR: [
          { sourceKey: { contains: filters.query, mode: "insensitive" } },
          { slug: { contains: filters.query, mode: "insensitive" } },
          { revisions: { some: { title: { contains: filters.query, mode: "insensitive" } } } },
        ],
      } : {}),
      ...(filters.status ? { revisions: { some: { status: filters.status } } } : {}),
    },
    include: {
      activeRevision: true,
      revisions: {
        orderBy: { revisionNo: "desc" },
        take: 1,
        include: { createdByUser: { select: { id: true, name: true } } },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}
