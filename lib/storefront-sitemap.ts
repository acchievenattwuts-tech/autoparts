import type { MetadataRoute } from "next";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { knowledgeArticles } from "@/lib/knowledge-content";
import { getCategoryPath, getProductPath } from "@/lib/product-slug";
import { ROOT_CANONICAL_URL, absoluteUrl } from "@/lib/seo";

const SITEMAP_REVALIDATE_SECONDS = 900;

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

function getLatestDate(candidates: Array<Date | null | undefined>) {
  let latest: Date | null = null;

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (latest === null || candidate.getTime() > latest.getTime()) {
      latest = candidate;
    }
  }

  return latest;
}

export async function getStorefrontSitemap(): Promise<MetadataRoute.Sitemap> {
  const { latestSiteContentUpdatedAt, activeCategories, activeProducts } =
    await getStorefrontSitemapData();

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
      lastModified: product.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...activeCategories.map((category) => ({
      url: absoluteUrl(getCategoryPath(category)),
      lastModified: category.createdAt ?? productsLastModified,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
