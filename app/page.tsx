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
import StorefrontDeferredAssets from "@/components/shared/StorefrontDeferredAssets";
import LocalBusinessJsonLd from "@/components/seo/LocalBusinessJsonLd";
import OrganizationJsonLd from "@/components/seo/OrganizationJsonLd";
import WebSiteJsonLd from "@/components/seo/WebSiteJsonLd";
import { getPublicSiteConfig } from "@/lib/site-config";
import { LOCAL_SEO_KEYWORDS, ROOT_CANONICAL_URL, absoluteUrl } from "@/lib/seo";

const getStorefrontHomeData = cache(async () => {
  const [config, categories, featuredProducts] = await Promise.all([
    getPublicSiteConfig(),
    fetchHomeCategories(),
    fetchHomeFeaturedProducts(),
  ]);

  return {
    config,
    categories,
    featuredProducts,
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
      images: [{ url: absoluteUrl("/opengraph-image") }],
    },
    twitter: {
      title: `อะไหล่แอร์รถยนต์ | ${config.shopName}`,
      description,
      images: [absoluteUrl("/opengraph-image")],
    },
  };
}

const Home = async () => {
  const { config, categories, featuredProducts } = await getStorefrontHomeData();

  return (
    <>
      <StorefrontNavbar
        shopName={config.shopName}
        shopSlogan={config.shopSlogan}
        shopLogoUrl={config.shopLogoUrl}
        lineUrl={config.shopLineUrl}
        shopPhone={config.shopPhone}
      />
      <main>
        <HeroShowcase
          lineUrl={config.shopLineUrl}
          shopPhone={config.shopPhone}
          shopName={config.shopName}
        />
        <ProductCategories categories={categories} />
        <FeaturedProducts lineUrl={config.shopLineUrl} products={featuredProducts} />
        <SeoIntentSection />
        <WhyUs />
        <LineCTA
          lineId={config.shopLineId}
          lineUrl={config.shopLineUrl}
          shopPhone={config.shopPhone}
          shopName={config.shopName}
        />
      </main>
      <Footer config={config} />
      <StorefrontDeferredAssets lineUrl={config.shopLineUrl} />
      <OrganizationJsonLd config={config} />
      <LocalBusinessJsonLd config={config} />
      <WebSiteJsonLd />
    </>
  );
};

export default Home;
