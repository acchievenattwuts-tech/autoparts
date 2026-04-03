import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { absoluteUrl } from "@/lib/seo";
import { knowledgeArticles } from "@/lib/knowledge-content";
import { getCategoryPath, getProductPath } from "@/lib/product-slug";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [
    latestProduct,
    latestCategory,
    latestBrand,
    latestModel,
    latestSiteContent,
    activeCategories,
    activeProducts,
  ] =
    await Promise.all([
      db.product.aggregate({ _max: { updatedAt: true } }),
      db.category.aggregate({ _max: { createdAt: true } }),
      db.partsBrand.aggregate({ _max: { createdAt: true } }),
      db.carModel.aggregate({ _max: { createdAt: true } }),
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
        where: { isActive: true },
        select: {
          id: true,
          slug: true,
          name: true,
          updatedAt: true,
          category: { select: { name: true, slug: true } },
        },
        orderBy: { updatedAt: "desc" },
      }),
    ]);

  const productsLastModified =
    latestProduct._max.updatedAt ??
    latestCategory._max.createdAt ??
    latestBrand._max.createdAt ??
    latestModel._max.createdAt ??
    latestSiteContent._max.updatedAt ??
    new Date();

  const homeLastModified = latestSiteContent._max.updatedAt ?? productsLastModified;

  return [
    {
      url: absoluteUrl("/"),
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
