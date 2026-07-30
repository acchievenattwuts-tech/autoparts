import { createHash } from "crypto";
import { z } from "zod";

export const knowledgeSectionSchema = z.object({
  heading: z.string().trim().min(1).max(240),
  body: z.array(z.string().trim().min(1).max(4_000)).max(50),
  format: z.enum(["PARAGRAPHS", "BULLETS", "STEPS", "TABLE"]).default("PARAGRAPHS"),
  aiEnabled: z.boolean().default(true),
});

export const knowledgeContentSchema = z.object({
  intro: z.string().trim().min(1).max(10_000),
  highlights: z.array(z.string().trim().min(1).max(2_000)).max(30).default([]),
  sections: z.array(knowledgeSectionSchema).min(1).max(30),
  relatedSearches: z.array(z.string().trim().min(1).max(200)).max(40).default([]),
  internalLinks: z.array(z.object({
    href: z.string().trim().max(500),
    title: z.string().trim().max(240),
    description: z.string().trim().max(1_000),
  })).max(20).default([]),
  readingMinutes: z.number().int().min(1).max(60).default(3),
  publishedAt: z.string().date().optional(),
});

export type KnowledgeContent = z.infer<typeof knowledgeContentSchema>;
export type KnowledgeSection = z.infer<typeof knowledgeSectionSchema>;

export function parseKnowledgeContent(value: unknown): KnowledgeContent {
  return knowledgeContentSchema.parse(value);
}

export function buildKnowledgeRevisionChecksum(value: {
  title: string;
  description?: string | null;
  category?: string | null;
  content: KnowledgeContent;
  answerScope: string;
  riskLevel: string;
  ragEnabled: boolean;
  sourceUrls: string[];
}): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function splitNonEmptyLines(value: string): string[] {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}
