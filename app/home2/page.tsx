export const revalidate = 3600;

import { cache } from "react";
import type { Metadata } from "next";
import HeroShowcase from "@/components/shared/HeroShowcase";
import SeoIntentSection from "@/components/shared/SeoIntentSection";
import ProductCategories, { fetchHomeCategories } from "@/components/shared/ProductCategories";
import WhyUs from "@/components/shared/WhyUs";
import FeaturedProducts, { fetchHomeFeaturedProducts } from "@/components/shared/FeaturedProducts";
import LineCTA from "@/components/shared/LineCTA";
import Footer from "@/components/shared/Footer";
import ScrollReveal from "@/components/shared/ScrollReveal";
import StorefrontDeferredAssets from "@/components/shared/StorefrontDeferredAssets";
import StorefrontHeader from "@/components/storefront/StorefrontHeader";
import { getPublicSiteConfig } from "@/lib/site-config";
import { getStorefrontProductFilters } from "@/lib/storefront-catalog";

/**
 * The storefront's previous homepage design, kept reachable for comparison
 * after the Shopee-style layout took over "/".
 *
 * It renders the current site header rather than the white navbar it was built
 * against, so the header stays consistent everywhere. Everything below the
 * header is the original composition.
 */
const getLegacyHomeData = cache(async () => {
  const [config, categories, featuredProducts, productFilters] = await Promise.all([
    getPublicSiteConfig(),
    fetchHomeCategories(),
    fetchHomeFeaturedProducts(),
    getStorefrontProductFilters(),
  ]);

  const finderBrands = productFilters.carBrands.map((brand) => ({
    name: brand.name,
    models: brand.carModels.map((model) => model.name),
  }));
  const finderCategories = productFilters.categories.map((category) => category.name);

  return { config, categories, featuredProducts, finderBrands, finderCategories };
});

export async function generateMetadata(): Promise<Metadata> {
  const { config } = await getLegacyHomeData();

  return {
    title: `${config.shopName} | หน้าแรก (ดีไซน์เดิม)`,
    description:
      "หน้าแรกดีไซน์เดิมของร้านอะไหล่แอร์รถยนต์ เก็บไว้เปรียบเทียบกับหน้าแรกปัจจุบัน",
    // Near-duplicate of "/" — keep it out of the index so it cannot compete
    // with the real homepage. robots.ts disallows /home2 as well.
    robots: { index: false, follow: false },
  };
}

const LegacyHomePage = async () => {
  const { config, categories, featuredProducts, finderBrands, finderCategories } =
    await getLegacyHomeData();

  return (
    <>
      <StorefrontHeader
        shopName={config.shopName}
        shopSlogan={config.shopSlogan}
        shopLogoUrl={config.shopLogoUrl}
        shopPhone={config.shopPhone}
        lineUrl={config.shopLineUrl}
      />
      <main>
        <ScrollReveal>
          <HeroShowcase
            lineUrl={config.shopLineUrl}
            shopPhone={config.shopPhone}
            shopName={config.shopName}
            finderBrands={finderBrands}
            finderCategories={finderCategories}
          />
        </ScrollReveal>
        <ScrollReveal delay={80}>
          <FeaturedProducts lineUrl={config.shopLineUrl} products={featuredProducts} />
        </ScrollReveal>
        <ScrollReveal delay={120}>
          <ProductCategories categories={categories} lineUrl={config.shopLineUrl} />
        </ScrollReveal>
        <ScrollReveal delay={160}>
          <SeoIntentSection />
        </ScrollReveal>
        <ScrollReveal delay={200}>
          <WhyUs />
        </ScrollReveal>
        <ScrollReveal delay={240}>
          <LineCTA
            lineId={config.shopLineId}
            lineUrl={config.shopLineUrl}
            lineQrUrl={config.shopLineQrUrl}
            shopPhone={config.shopPhone}
            shopName={config.shopName}
          />
        </ScrollReveal>
      </main>
      <Footer config={config} />
      <StorefrontDeferredAssets lineUrl={config.shopLineUrl} shopPhone={config.shopPhone} />
    </>
  );
};

export default LegacyHomePage;
