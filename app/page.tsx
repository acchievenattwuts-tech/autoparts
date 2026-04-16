export const revalidate = 3600;

import type { Metadata } from "next";
import StorefrontNavbar from "@/components/shared/StorefrontNavbar";
import HeroShowcase from "@/components/shared/HeroShowcase";
import SeoIntentSection from "@/components/shared/SeoIntentSection";
import ProductCategories from "@/components/shared/ProductCategories";
import WhyUs from "@/components/shared/WhyUs";
import FeaturedProducts from "@/components/shared/FeaturedProducts";
import LineCTA from "@/components/shared/LineCTA";
import Footer from "@/components/shared/Footer";
import StorefrontDeferredAssets from "@/components/shared/StorefrontDeferredAssets";
import LocalBusinessJsonLd from "@/components/seo/LocalBusinessJsonLd";
import OrganizationJsonLd from "@/components/seo/OrganizationJsonLd";
import WebSiteJsonLd from "@/components/seo/WebSiteJsonLd";
import { getPublicSiteConfig } from "@/lib/site-config";
import { LOCAL_SEO_KEYWORDS, absoluteUrl } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const config = await getPublicSiteConfig();
  const description =
    "ร้านอะไหล่แอร์รถยนต์ในนครสวรรค์ ช่วยค้นหาและเช็กความตรงรุ่นก่อนสั่งซื้อจริง ค้นหาคอมแอร์ คอมเพรสเซอร์ แผงคอนเดนเซอร์ และอะไหล่ที่เกี่ยวข้อง พร้อมจัดส่งทั่วประเทศ";

  return {
    title: `อะไหล่แอร์รถยนต์ | ${config.shopName}`,
    description,
    keywords: LOCAL_SEO_KEYWORDS,
    alternates: {
      canonical: absoluteUrl("/"),
    },
    openGraph: {
      url: absoluteUrl("/"),
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
  const config = await getPublicSiteConfig();

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
        <ProductCategories />
        <FeaturedProducts lineUrl={config.shopLineUrl} />
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
