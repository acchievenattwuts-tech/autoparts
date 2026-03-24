import Navbar from "@/components/shared/Navbar";
import Hero from "@/components/shared/Hero";
import ProductCategories from "@/components/shared/ProductCategories";
import WhyUs from "@/components/shared/WhyUs";
import FeaturedProducts from "@/components/shared/FeaturedProducts";
import LineCTA from "@/components/shared/LineCTA";
import Footer from "@/components/shared/Footer";
import FloatingLine from "@/components/shared/FloatingLine";

const Home = () => {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <ProductCategories />
        <WhyUs />
        <FeaturedProducts />
        <LineCTA />
      </main>
      <Footer />
      <FloatingLine />
    </>
  );
};

export default Home;
