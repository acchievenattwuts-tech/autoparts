export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Navbar from "@/components/shared/Navbar";
import Hero from "@/components/shared/Hero";
import ProductCategories from "@/components/shared/ProductCategories";
import WhyUs from "@/components/shared/WhyUs";
import FeaturedProducts from "@/components/shared/FeaturedProducts";
import LineCTA from "@/components/shared/LineCTA";
import Footer from "@/components/shared/Footer";
import DeferredFloatingLine from "@/components/shared/DeferredFloatingLine";
import LocalBusinessJsonLd from "@/components/seo/LocalBusinessJsonLd";
import OrganizationJsonLd from "@/components/seo/OrganizationJsonLd";
import WebSiteJsonLd from "@/components/seo/WebSiteJsonLd";
import { getSiteConfig } from "@/lib/site-config";
import { DEFAULT_DESCRIPTION, LOCAL_SEO_KEYWORDS, absoluteUrl } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const config = await getSiteConfig();
  const title = `${config.shopName} | ${
    config.shopSlogan || "อะไหล่แอร์และหม้อน้ำรถยนต์ครบวงจร"
  }`;
  const description = config.heroSubtitle || DEFAULT_DESCRIPTION;

  return {
    title,
    description,
    keywords: LOCAL_SEO_KEYWORDS,
    alternates: {
      canonical: absoluteUrl("/"),
    },
    openGraph: {
      url: absoluteUrl("/"),
      title,
      description,
      images: [{ url: absoluteUrl("/opengraph-image") }],
    },
    twitter: {
      title,
      description,
      images: [absoluteUrl("/opengraph-image")],
    },
  };
}

const Home = async () => {
  const config = await getSiteConfig();

  return (
    <>
      <Navbar
        shopName={config.shopName}
        shopSlogan={config.shopSlogan}
        shopLogoUrl={config.shopLogoUrl}
        lineUrl={config.shopLineUrl}
        shopPhone={config.shopPhone}
      />
      <main>
        <Hero
          lineUrl={config.shopLineUrl}
          shopPhone={config.shopPhone}
          shopName={config.shopName}
        />
        <ProductCategories />
        <FeaturedProducts lineUrl={config.shopLineUrl} />
        <WhyUs />
        <LineCTA
          lineId={config.shopLineId}
          lineUrl={config.shopLineUrl}
          shopPhone={config.shopPhone}
          shopName={config.shopName}
        />
      </main>
      <Footer config={config} />
      <DeferredFloatingLine lineUrl={config.shopLineUrl} />
      <OrganizationJsonLd config={config} />
      <LocalBusinessJsonLd config={config} />
      <WebSiteJsonLd />
    </>
  );
};

export default Home;
