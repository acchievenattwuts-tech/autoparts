export const revalidate = 3600;

import { cache } from "react";
import type { Metadata } from "next";
import StorefrontNavbar from "@/components/shared/StorefrontNavbar";
import HeroShowcase from "@/components/shared/HeroShowcase";
import SeoIntentSection from "@/components/shared/SeoIntentSection";
import ProductCategories, { fetchHomeCategories } from "@/components/shared/ProductCategories";
import WhyUs from "@/components/shared/WhyUs";
import FeaturedProducts, { fetchHomeFeaturedProducts } from "@/components/shared/FeaturedProducts";
import LineCTA from "@/components/shared/LineCTA";
import Footer from "@/components/shared/Footer";
import ScrollReveal from "@/components/shared/ScrollReveal";
import StorefrontDeferredAssets from "@/components/shared/StorefrontDeferredAssets";
import LocalBusinessJsonLd from "@/components/seo/LocalBusinessJsonLd";
import OrganizationJsonLd from "@/components/seo/OrganizationJsonLd";
import WebSiteJsonLd from "@/components/seo/WebSiteJsonLd";
import { getPublicSiteConfig } from "@/lib/site-config";
import { getStorefrontProductFilters } from "@/lib/storefront-catalog";
import {
  DEFAULT_TITLE,
  LOCAL_SEO_KEYWORDS,
  ROOT_CANONICAL_URL,
  absoluteUrl,
  buildOgCardImage,
} from "@/lib/seo";

const getStorefrontHomeData = cache(async () => {
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

  return {
    config,
    categories,
    featuredProducts,
    productFilters,
    finderBrands,
    finderCategories,
  };
});

export async function generateMetadata(): Promise<Metadata> {
  const { config } = await getStorefrontHomeData();
  const description =
    "ร้านอะไหล่แอร์รถยนต์ในนครสวรรค์ ช่วยค้นหาและเช็กความตรงรุ่นก่อนสั่งซื้อจริง ค้นหาคอมแอร์ คอมเพรสเซอร์ แผงคอนเดนเซอร์ และอะไหล่ที่เกี่ยวข้อง พร้อมจัดส่งทั่วประเทศ";

  return {
    title: `อะไหล่แอร์รถยนต์ | ${config.shopName}`,
    description,
    keywords: LOCAL_SEO_KEYWORDS,
    alternates: {
      canonical: ROOT_CANONICAL_URL,
    },
    openGraph: {
      url: ROOT_CANONICAL_URL,
      title: `อะไหล่แอร์รถยนต์ | ${config.shopName}`,
      description,
      images: [buildOgCardImage("/opengraph-image", DEFAULT_TITLE)],
    },
    twitter: {
      title: `อะไหล่แอร์รถยนต์ | ${config.shopName}`,
      description,
      images: [absoluteUrl("/opengraph-image")],
    },
  };
}

const Home = async () => {
  const { config, categories, featuredProducts, finderBrands, finderCategories, productFilters } =
    await getStorefrontHomeData();

  return (
    <>
      <StorefrontNavbar
        shopName={config.shopName}
        shopSlogan={config.shopSlogan}
        shopLogoUrl={config.shopLogoUrl}
        lineUrl={config.shopLineUrl}
        shopPhone={config.shopPhone}
        filterData={productFilters}
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
      <OrganizationJsonLd config={config} />
      <LocalBusinessJsonLd config={config} />
      <WebSiteJsonLd />
    </>
  );
};

export default Home;
