import { revalidateTag } from "next/cache";

// Keep the existing tag value so cache entries created by earlier deployments
// are invalidated together with the full public article collection.
export const PUBLIC_KNOWLEDGE_CACHE_TAG = "public-knowledge-summary";

export function revalidatePublicKnowledgeCache(): void {
  try {
    revalidateTag(PUBLIC_KNOWLEDGE_CACHE_TAG, { expire: 0 });
  } catch (error) {
    console.error("[knowledge-cache] public cache revalidation failed", error);
  }
}
