export const revalidate = 3600;

import { cache } from "react";
import type { Metadata } from "next";
import Footer from "@/components/shared/Footer";
import StorefrontDeferredAssets from "@/components/shared/StorefrontDeferredAssets";
import LocalBusinessJsonLd from "@/components/seo/LocalBusinessJsonLd";
import OrganizationJsonLd from "@/components/seo/OrganizationJsonLd";
import WebSiteJsonLd from "@/components/seo/WebSiteJsonLd";
import HomeCategoryStrip from "@/components/storefront/HomeCategoryStrip";
import HomeHero from "@/components/storefront/HomeHero";
import HomeLineCta from "@/components/storefront/HomeLineCta";
import HomeNewArrivals from "@/components/storefront/HomeNewArrivals";
import HomeProductRail from "@/components/storefront/HomeProductRail";
import StorefrontHeader from "@/components/storefront/StorefrontHeader";
import { getPublicSiteConfig } from "@/lib/site-config";
import { getStorefrontProductFilters } from "@/lib/storefront-catalog";
import {
  getHomeCategories,
  getHomeNewArrivals,
  getHomePopularCarModels,
  getHomeWeeklyBestSellers,
} from "@/lib/storefront-home";
import {
  DEFAULT_TITLE,
  LOCAL_SEO_KEYWORDS,
  ROOT_CANONICAL_URL,
  absoluteUrl,
  buildOgCardImage,
} from "@/lib/seo";

const getStorefrontHomeData = cache(async () => {
  const [
    config,
    categories,
    weeklyBestSellers,
    newArrivals,
    popularModels,
    productFilters,
  ] = await Promise.all([
    getPublicSiteConfig(),
    getHomeCategories(),
    getHomeWeeklyBestSellers(),
    getHomeNewArrivals(),
    getHomePopularCarModels(),
    getStorefrontProductFilters(),
  ]);

  return {
    config,
    categories,
    weeklyBestSellers,
    newArrivals,
    popularModels,
    productFilters,
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
  const {
    config,
    categories,
    weeklyBestSellers,
    newArrivals,
    popularModels,
    productFilters,
  } = await getStorefrontHomeData();

  // Finder feeds off the full active catalogue, not the trimmed brand shortcuts.
  // Only the brand names travel with the page — the finder pulls each brand's
  // models from /api/storefront-filters when the customer actually reaches for it.
  const finderBrands = productFilters.carBrands.map((brand) => brand.name);
  const finderCategories = productFilters.categories.map((category) => category.name);

  return (
    <div className="flex min-h-full flex-col bg-[#f4f7fc]">
      <StorefrontHeader
        shopName={config.shopName}
        shopSlogan={config.shopSlogan}
        shopLogoUrl={config.shopLogoUrl}
        shopPhone={config.shopPhone}
        lineUrl={config.shopLineUrl}
      />

      <main className="flex-1">
        <HomeHero
          finderBrands={finderBrands}
          finderCategories={finderCategories}
          lineUrl={config.shopLineUrl}
          productCount={newArrivals.total}
          categoryCount={categories.length}
          carBrandCount={productFilters.carBrands.length}
          popularModels={popularModels}
        />

        {/* Categories live here, in the page body — not in the header */}
        <HomeCategoryStrip categories={categories} />

        <HomeProductRail
          title="ขายดีประจำสัปดาห์"
          href="/products"
          products={weeklyBestSellers}
          lineUrl={config.shopLineUrl}
        />

        <HomeNewArrivals initialPage={newArrivals} lineUrl={config.shopLineUrl} />

        <HomeLineCta
          shopName={config.shopName}
          lineId={config.shopLineId}
          lineUrl={config.shopLineUrl}
          lineQrUrl={config.shopLineQrUrl}
          shopPhone={config.shopPhone}
        />
      </main>

      <Footer config={config} />
      <StorefrontDeferredAssets lineUrl={config.shopLineUrl} shopPhone={config.shopPhone} />
      <OrganizationJsonLd config={config} />
      <LocalBusinessJsonLd config={config} />
      <WebSiteJsonLd />
    </div>
  );
};

export default Home;
