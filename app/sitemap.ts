import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { absoluteUrl } from "@/lib/seo";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [latestProduct, latestCategory, latestBrand, latestModel, latestSiteContent] =
    await Promise.all([
      db.product.aggregate({ _max: { updatedAt: true } }),
      db.category.aggregate({ _max: { createdAt: true } }),
      db.partsBrand.aggregate({ _max: { createdAt: true } }),
      db.carModel.aggregate({ _max: { createdAt: true } }),
      db.siteContent.aggregate({ _max: { updatedAt: true } }),
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
  ];
}
