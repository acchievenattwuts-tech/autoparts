import { knowledgeArticles, type KnowledgeArticle } from "@/lib/knowledge-content";
import { storefrontFaqItems } from "@/lib/storefront-content";
import {
  getActiveKnowledgeByKey,
  getActiveKnowledgeBySlug,
  listActiveKnowledgeEntries,
  type ActiveKnowledgeEntry,
} from "@/lib/knowledge-cms-repository";

function dateOnly(value: Date | string | null | undefined): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  return (value instanceof Date ? value : new Date(value)).toISOString().slice(0, 10);
}

export function activeEntryToArticle(entry: ActiveKnowledgeEntry): KnowledgeArticle {
  return {
    slug: entry.slug ?? entry.sourceKey,
    title: entry.title,
    description: entry.description ?? entry.content.intro.slice(0, 180),
    category: (entry.category ?? "การใช้งานเว็บไซต์") as KnowledgeArticle["category"],
    readingMinutes: entry.content.readingMinutes,
    publishedAt: entry.content.publishedAt ?? dateOnly(entry.activatedAt ?? entry.updatedAt),
    updatedAt: dateOnly(entry.activatedAt ?? entry.updatedAt),
    intro: entry.content.intro,
    keyTakeaways: entry.content.highlights,
    sections: entry.content.sections.map((section) => ({ heading: section.heading, body: section.body })),
    relatedSearches: entry.content.relatedSearches,
    internalLinks: entry.content.internalLinks,
  };
}

export async function getPublicKnowledgeArticles(): Promise<KnowledgeArticle[]> {
  try {
    const entries = await listActiveKnowledgeEntries("ARTICLE");
    return entries.length > 0 ? entries.map(activeEntryToArticle) : knowledgeArticles;
  } catch {
    return knowledgeArticles;
  }
}

export async function getPublicKnowledgeArticle(slug: string): Promise<KnowledgeArticle | null> {
  try {
    const entry = await getActiveKnowledgeBySlug(slug);
    if (entry?.type === "ARTICLE") return activeEntryToArticle(entry);
  } catch {
    // The code corpus remains a deploy-safe fallback until the CMS migration completes.
  }
  return knowledgeArticles.find((article) => article.slug === slug) ?? null;
}

export async function getPublicFaqItems(): Promise<Array<{ question: string; answer: string }>> {
  try {
    const entries = await listActiveKnowledgeEntries("FAQ");
    if (entries.length > 0) return entries.map((entry) => ({ question: entry.title, answer: entry.content.intro }));
  } catch {
    // Fallback during initial deployment/setup.
  }
  return storefrontFaqItems;
}

export async function getPublicPolicyEntry(): Promise<ActiveKnowledgeEntry | null> {
  try {
    return await getActiveKnowledgeByKey("policy:return-warranty");
  } catch {
    return null;
  }
}
