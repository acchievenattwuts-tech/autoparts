import { revalidateTag } from "next/cache";

export const PUBLIC_KNOWLEDGE_SUMMARY_CACHE_TAG = "public-knowledge-summary";

export function revalidatePublicKnowledgeSummaryCache(): void {
  try {
    revalidateTag(PUBLIC_KNOWLEDGE_SUMMARY_CACHE_TAG, { expire: 0 });
  } catch (error) {
    console.error("[knowledge-cache] summary cache revalidation failed", error);
  }
}
