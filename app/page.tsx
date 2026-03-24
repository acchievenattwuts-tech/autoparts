import Navbar from "@/components/shared/Navbar";
import Hero from "@/components/shared/Hero";
import ProductCategories from "@/components/shared/ProductCategories";
import WhyUs from "@/components/shared/WhyUs";
import FeaturedProducts from "@/components/shared/FeaturedProducts";
import LineCTA from "@/components/shared/LineCTA";
import Footer from "@/components/shared/Footer";
import FloatingLine from "@/components/shared/FloatingLine";
import { getSiteConfig } from "@/lib/site-config";

const Home = async () => {
  const config = await getSiteConfig();

  return (
    <>
      <Navbar shopName={config.shopName} shopSlogan={config.shopSlogan} lineUrl={config.shopLineUrl} />
      <main>
        <Hero heroTitle={config.heroTitle} heroSubtitle={config.heroSubtitle} lineUrl={config.shopLineUrl} />
        <ProductCategories />
        <WhyUs />
        <FeaturedProducts />
        <LineCTA lineId={config.shopLineId} lineUrl={config.shopLineUrl} />
      </main>
      <Footer config={config} />
      <FloatingLine lineUrl={config.shopLineUrl} />
    </>
  );
};

export default Home;
