export const revalidate = 900;

import type { MetadataRoute } from "next";
import { getStorefrontSitemap } from "@/lib/storefront-sitemap";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return getStorefrontSitemap();
}
