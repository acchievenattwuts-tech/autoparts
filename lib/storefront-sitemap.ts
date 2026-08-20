import type { MetadataRoute } from "next";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { getPublicKnowledgeArticles } from "@/lib/knowledge-public";
import { getCategoryPath, getProductPath } from "@/lib/product-slug";
import { ROOT_CANONICAL_URL, absoluteUrl } from "@/lib/seo";

// 6h: bots crawl /sitemap.xml frequently; every cache miss refetches the whole
// active-product list from the database. Product/category mutations are not
// time-critical for the sitemap, so a long window sharply cuts Supabase egress.
const SITEMAP_REVALIDATE_SECONDS = 21_600;

const getStorefrontSitemapData = unstable_cache(
  async () => {
    const [latestSiteContent, activeCategories, activeProducts] = await Promise.all([
      db.siteContent.aggregate({ _max: { updatedAt: true } }),
      db.category.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          slug: true,
          createdAt: true,
        },
        orderBy: { name: "asc" },
      }),
      db.product.findMany({
        where: { isActive: true, isStorefrontVisible: true },
        select: {
          id: true,
          slug: true,
          name: true,
          updatedAt: true,
          category: { select: { id: true, name: true, slug: true } },
        },
        orderBy: { updatedAt: "desc" },
      }),
    ]);

    return {
      latestSiteContentUpdatedAt: latestSiteContent._max.updatedAt,
      activeCategories,
      activeProducts,
    };
  },
  ["storefront-sitemap-v1"],
  {
    tags: ["storefront:products", "storefront:categories", "site-config"],
    revalidate: SITEMAP_REVALIDATE_SECONDS,
  },
);

/**
 * Coerce to a valid Date. Values read back from `unstable_cache` are JSON-round-
 * tripped, so `Date` fields arrive as ISO strings — calling `.getTime()` on them
 * throws. Normalising here keeps the sitemap build resilient to cache state.
 */
function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getLatestDate(candidates: Array<Date | string | null | undefined>) {
  let latest: Date | null = null;

  for (const candidate of candidates) {
    const date = toDate(candidate);
    if (!date) {
      continue;
    }

    if (latest === null || date.getTime() > latest.getTime()) {
      latest = date;
    }
  }

  return latest;
}

export async function getStorefrontSitemap(): Promise<MetadataRoute.Sitemap> {
  const [{ latestSiteContentUpdatedAt, activeCategories, activeProducts }, knowledgeArticles] =
    await Promise.all([getStorefrontSitemapData(), getPublicKnowledgeArticles()]);

  const productsLastModified =
    getLatestDate([
      latestSiteContentUpdatedAt,
      ...activeProducts.map((product) => product.updatedAt),
      ...activeCategories.map((category) => category.createdAt),
    ]) ?? new Date();

  const homeLastModified = latestSiteContentUpdatedAt ?? productsLastModified;

  return [
    {
      url: ROOT_CANONICAL_URL,
      lastModified: homeLastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: absoluteUrl("/products"),
      lastModified: productsLastModified,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: absoluteUrl("/about"),
      lastModified: homeLastModified,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: absoluteUrl("/faq"),
      lastModified: homeLastModified,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: absoluteUrl("/knowledge"),
      lastModified: homeLastModified,
      changeFrequency: "weekly",
      priority: 0.85,
    },
    {
      url: absoluteUrl("/return-warranty-policy"),
      lastModified: homeLastModified,
      changeFrequency: "monthly",
      priority: 0.75,
    },
    ...knowledgeArticles.map((article) => ({
      url: absoluteUrl(`/knowledge/${article.slug}`),
      lastModified: new Date(article.updatedAt),
      changeFrequency: "monthly" as const,
      priority: 0.75,
    })),
    ...activeProducts.map((product) => ({
      url: absoluteUrl(
        getProductPath({
          category: product.category,
          product,
        }),
      ),
      lastModified: toDate(product.updatedAt) ?? productsLastModified,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...activeCategories.map((category) => ({
      url: absoluteUrl(getCategoryPath(category)),
      lastModified: toDate(category.createdAt) ?? productsLastModified,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
