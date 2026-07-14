// Must stay in sync with SITEMAP_REVALIDATE_SECONDS in lib/storefront-sitemap.ts.
export const revalidate = 21600;

import type { MetadataRoute } from "next";
import { getStorefrontSitemap } from "@/lib/storefront-sitemap";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return getStorefrontSitemap();
}
