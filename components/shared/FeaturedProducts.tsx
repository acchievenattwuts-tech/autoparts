import { unstable_cache } from "next/cache";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import ProductCard from "@/components/shared/ProductCard";
import { db } from "@/lib/db";

const fetchFeaturedProducts = unstable_cache(
  async () =>
    db.product.findMany({
      where: { isActive: true, stock: { gt: 0 } },
      select: {
        id: true,
        slug: true,
        name: true,
        code: true,
        imageUrl: true,
        salePrice: true,
        stock: true,
        reportUnitName: true,
        category: { select: { name: true, slug: true } },
        brand: { select: { name: true } },
        carModels: {
          select: {
            carModel: {
              select: {
                name: true,
                carBrand: { select: { name: true } },
              },
            },
          },
          take: 6,
        },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ["storefront-featured-products"],
  { tags: ["storefront:products"] },
);

interface Props {
  lineUrl: string;
}

const FeaturedProducts = async ({ lineUrl }: Props) => {
  const products = await fetchFeaturedProducts();

  if (products.length === 0) return null;

  return (
    <section id="products" className="bg-white py-16 sm:py-18 lg:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 text-center">
          <span className="mb-3 inline-block rounded-full bg-[#1e3a5f]/10 px-4 py-1.5 text-sm font-semibold text-[#1e3a5f]">
            สินค้าแนะนำ
          </span>
          <h2 className="mb-3 font-kanit text-3xl font-bold text-gray-900 sm:text-4xl">
            สินค้าขายดีประจำร้าน
          </h2>
          <p className="text-lg text-gray-500">
            สอบถามราคาและสั่งซื้อได้ทันทีผ่าน LINE OA
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} lineUrl={lineUrl} />
          ))}
        </div>

        <div className="mt-10 text-center">
          <Link
            href="/products"
            className="inline-flex items-center gap-2 rounded-full bg-[#1e3a5f] px-6 py-3 font-semibold text-white transition-all hover:scale-105 hover:bg-[#163055]"
          >
            ดูสินค้าทั้งหมด
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
};

export default FeaturedProducts;
