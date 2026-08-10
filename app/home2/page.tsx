export const revalidate = 3600;

import type { Metadata } from "next";
import { cache } from "react";
import Footer from "@/components/shared/Footer";
import StorefrontDeferredAssets from "@/components/shared/StorefrontDeferredAssets";
import { getCategoryVisualSettings } from "@/lib/category-visual-settings";
import { getPublicSiteConfig } from "@/lib/site-config";
import { getStorefrontProductFilters } from "@/lib/storefront-catalog";
import Home2CategoryStrip from "./Home2CategoryStrip";
import Home2Header from "./Home2Header";
import Home2Hero from "./Home2Hero";
import Home2LineCta from "./Home2LineCta";
import Home2NewArrivals from "./Home2NewArrivals";
import Home2ProductSection from "./Home2ProductSection";
import {
  getHome2WeeklyBestSellers,
  getHome2Categories,
  getHome2NewArrivals,
} from "./home2-data";

const getHome2PageData = cache(async () => {
  const [
    config,
    categories,
    visualSettings,
    weeklyBestSellers,
    newArrivals,
    productFilters,
  ] = await Promise.all([
    getPublicSiteConfig(),
    getHome2Categories(),
    getCategoryVisualSettings(),
    getHome2WeeklyBestSellers(),
    getHome2NewArrivals(),
    getStorefrontProductFilters(),
  ]);

  return {
    config,
    categories,
    visualSettings,
    weeklyBestSellers,
    newArrivals,
    productFilters,
  };
});

export async function generateMetadata(): Promise<Metadata> {
  const { config } = await getHome2PageData();

  return {
    title: `${config.shopName} | หน้าแรก (ดีไซน์ทดลอง)`,
    description:
      "หน้าแรกเวอร์ชันทดลองของร้านอะไหล่แอร์รถยนต์ ค้นหาอะไหล่ตามรุ่นรถ พร้อมหมวดหมู่ สินค้าขายดีประจำสัปดาห์ และสินค้ามาใหม่จากสต๊อกจริง",
    // Duplicate of "/" by design — keep it out of the index so it cannot
    // compete with the real homepage. robots.ts also disallows /home2.
    robots: { index: false, follow: false },
  };
}

const Home2Page = async () => {
  const { config, categories, visualSettings, weeklyBestSellers, newArrivals, productFilters } =
    await getHome2PageData();

  // Finder feeds off the full active catalogue, not the trimmed brand shortcuts.
  const finderBrands = productFilters.carBrands.map((brand) => ({
    name: brand.name,
    models: brand.carModels.map((model) => model.name),
  }));
  const finderCategories = productFilters.categories.map((category) => category.name);

  return (
    <div className="flex min-h-full flex-col bg-[#f4f7fc]">
      <Home2Header
        shopName={config.shopName}
        shopSlogan={config.shopSlogan}
        shopLogoUrl={config.shopLogoUrl}
        shopPhone={config.shopPhone}
        lineUrl={config.shopLineUrl}
      />

      <main className="flex-1">
        <Home2Hero
          finderBrands={finderBrands}
          finderCategories={finderCategories}
          lineUrl={config.shopLineUrl}
        />

        {/* Categories live here, in the page body — not in the header */}
        <Home2CategoryStrip categories={categories} visualSettings={visualSettings} />

        <Home2ProductSection
          title="ขายดีประจำสัปดาห์"
          href="/products"
          products={weeklyBestSellers}
          lineUrl={config.shopLineUrl}
        />

        <Home2NewArrivals initialPage={newArrivals} lineUrl={config.shopLineUrl} />

        <Home2LineCta
          shopName={config.shopName}
          lineId={config.shopLineId}
          lineUrl={config.shopLineUrl}
          lineQrUrl={config.shopLineQrUrl}
          shopPhone={config.shopPhone}
        />
      </main>

      <Footer config={config} />
      <StorefrontDeferredAssets lineUrl={config.shopLineUrl} shopPhone={config.shopPhone} />
    </div>
  );
};

export default Home2Page;
