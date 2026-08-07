export const revalidate = 3600;

import type { Metadata } from "next";
import { cache } from "react";
import Footer from "@/components/shared/Footer";
import StorefrontDeferredAssets from "@/components/shared/StorefrontDeferredAssets";
import { getCategoryVisualSettings } from "@/lib/category-visual-settings";
import { getPublicSiteConfig } from "@/lib/site-config";
import { getStorefrontProductFilters } from "@/lib/storefront-catalog";
import Home2CarBrands from "./Home2CarBrands";
import Home2CategoryStrip from "./Home2CategoryStrip";
import Home2Header from "./Home2Header";
import Home2Hero from "./Home2Hero";
import Home2ProductSection from "./Home2ProductSection";
import {
  getHome2BestSellers,
  getHome2Categories,
  getHome2DailyPicks,
  getHome2NewArrivals,
  getHome2TrendingKeywords,
} from "./home2-data";

/** Category tiles shown in the icon strip. */
const CATEGORY_STRIP_LIMIT = 16;
/** Car brand shortcuts shown in the brand grid. */
const CAR_BRAND_LIMIT = 12;
/** Secondary hero banners. */
const HERO_BANNER_COUNT = 2;

const getHome2PageData = cache(async () => {
  const [
    config,
    categories,
    visualSettings,
    dailyPicks,
    bestSellers,
    newArrivals,
    trendingKeywords,
    productFilters,
  ] = await Promise.all([
    getPublicSiteConfig(),
    getHome2Categories(),
    getCategoryVisualSettings(),
    getHome2DailyPicks(),
    getHome2BestSellers(),
    getHome2NewArrivals(),
    getHome2TrendingKeywords(),
    getStorefrontProductFilters(),
  ]);

  return {
    config,
    categories,
    visualSettings,
    dailyPicks,
    bestSellers,
    newArrivals,
    trendingKeywords,
    productFilters,
  };
});

export async function generateMetadata(): Promise<Metadata> {
  const { config } = await getHome2PageData();

  return {
    title: `${config.shopName} | หน้าแรก (ดีไซน์ทดลอง)`,
    description:
      "หน้าแรกเวอร์ชันทดลองของร้านอะไหล่แอร์รถยนต์ รวมหมวดหมู่ สินค้าขายดี และสินค้าแนะนำประจำวันจากสต๊อกจริง",
    // Duplicate of "/" by design — keep it out of the index so it cannot
    // compete with the real homepage. robots.ts also disallows /home2.
    robots: { index: false, follow: false },
  };
}

const Home2Page = async () => {
  const {
    config,
    categories,
    visualSettings,
    dailyPicks,
    bestSellers,
    newArrivals,
    trendingKeywords,
    productFilters,
  } = await getHome2PageData();

  const stockedCategories = categories.filter((category) => category.productCount > 0);
  const bannerCategories = [...stockedCategories]
    .sort((left, right) => right.productCount - left.productCount)
    .slice(0, HERO_BANNER_COUNT);
  const carBrands = productFilters.carBrands.slice(0, CAR_BRAND_LIMIT).map((brand) => ({
    id: brand.id,
    name: brand.name,
    modelCount: brand.carModels.length,
  }));

  return (
    <div className="flex min-h-full flex-col bg-[#f4f7fc]">
      <Home2Header
        shopName={config.shopName}
        shopSlogan={config.shopSlogan}
        shopLogoUrl={config.shopLogoUrl}
        shopPhone={config.shopPhone}
        lineUrl={config.shopLineUrl}
        trendingKeywords={trendingKeywords}
      />

      <main className="flex-1 pb-8">
        <Home2Hero
          shopName={config.shopName}
          heroTitle={config.heroTitle}
          heroSubtitle={config.heroSubtitle}
          lineUrl={config.shopLineUrl}
          bannerCategories={bannerCategories}
        />

        <Home2CategoryStrip
          categories={stockedCategories.slice(0, CATEGORY_STRIP_LIMIT)}
          visualSettings={visualSettings}
        />

        <Home2ProductSection
          title="แนะนำประจำวัน"
          subtitle="สุ่มจากสินค้าที่มีสต๊อกจริง เปลี่ยนรายการใหม่ทุกวัน"
          badge="อัปเดตทุกวัน"
          href="/products"
          products={dailyPicks}
          lineUrl={config.shopLineUrl}
          layout="rail"
        />

        <Home2ProductSection
          title="สินค้าขายดี"
          subtitle="จัดอันดับจากยอดขายจริงของร้าน"
          href="/products"
          products={bestSellers}
          lineUrl={config.shopLineUrl}
          layout="grid"
        />

        <Home2CarBrands brands={carBrands} lineUrl={config.shopLineUrl} />

        <Home2ProductSection
          title="สินค้ามาใหม่"
          subtitle="รายการล่าสุดที่เพิ่งเพิ่มเข้าคลัง"
          href="/products"
          products={newArrivals}
          lineUrl={config.shopLineUrl}
          layout="rail"
        />
      </main>

      <Footer config={config} />
      <StorefrontDeferredAssets lineUrl={config.shopLineUrl} />
    </div>
  );
};

export default Home2Page;
