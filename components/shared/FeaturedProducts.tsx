import { unstable_cache } from "next/cache";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import ProductCard from "@/components/shared/ProductCard";
import ScrollReveal from "@/components/shared/ScrollReveal";
import { db } from "@/lib/db";

const FEATURED_COUNT = 8;
const MAX_PER_CATEGORY = 2;
// Over-fetch a pool of best-sellers so we can diversify categories client-side.
const FEATURED_POOL_SIZE = 40;
// Best-seller ranking is derived from sale counts but is not real-time; refresh
// it once a day so it stays fresh even when the catalog isn't being edited.
const FEATURED_REVALIDATE_SECONDS = 86400;

export const fetchHomeFeaturedProducts = unstable_cache(
  async () => {
    const pool = await db.product.findMany({
      where: { isActive: true, isStorefrontVisible: true, stock: { gt: 0 } },
      select: {
        id: true,
        slug: true,
        name: true,
        code: true,
        imageUrl: true,
        salePrice: true,
        saleUnitName: true,
        warrantyDays: true,
        stock: true,
        category: { select: { name: true, slug: true } },
        brand: { select: { name: true } },
        carModels: {
          where: { fitmentType: "DIRECT" },
          select: {
            yearStart: true,
            yearEnd: true,
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
      orderBy: { saleItems: { _count: "desc" } },
      take: FEATURED_POOL_SIZE,
    });

    return diversifyByCategory(pool);
  },
  ["storefront-featured-products"],
  { tags: ["storefront:products"], revalidate: FEATURED_REVALIDATE_SECONDS },
);

// Keep the strongest sellers but cap how many share a category, so the
// storefront reflects the full breadth of the shop (brakes, filters, A/C, …)
// instead of showing eight A/C parts in a row. Pool stays in best-seller order.
const diversifyByCategory = <T extends { category: { slug: string | null } | null }>(
  pool: T[],
): T[] => {
  const perCategory = new Map<string, number>();
  const picked: T[] = [];
  const overflow: T[] = [];

  for (const product of pool) {
    const key = product.category?.slug ?? "__uncategorized__";
    const used = perCategory.get(key) ?? 0;
    if (used < MAX_PER_CATEGORY) {
      perCategory.set(key, used + 1);
      picked.push(product);
    } else {
      overflow.push(product);
    }
    if (picked.length === FEATURED_COUNT) return picked;
  }

  // Not enough distinct categories to fill the grid — backfill with the
  // remaining best-sellers so we never render fewer than FEATURED_COUNT.
  for (const product of overflow) {
    picked.push(product);
    if (picked.length === FEATURED_COUNT) break;
  }

  return picked;
};

interface Props {
  lineUrl: string;
  products?: Awaited<ReturnType<typeof fetchHomeFeaturedProducts>>;
}

const FeaturedProducts = async ({ lineUrl, products }: Props) => {
  const resolvedProducts = products ?? (await fetchHomeFeaturedProducts());

  if (resolvedProducts.length === 0) return null;

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
          {resolvedProducts.map((product, index) => (
            <ScrollReveal key={product.id} delay={index * 60} className="h-full">
              <ProductCard
                product={{ ...product, salePrice: product.salePrice.toString() }}
                lineUrl={lineUrl}
              />
            </ScrollReveal>
          ))}
        </div>

        <div className="mt-10 text-center">
          <Link
            href="/products"
            className="sf-shine inline-flex items-center gap-2 rounded-full bg-[#1e3a5f] px-6 py-3 font-semibold text-white transition-all hover:scale-105 hover:bg-[#163055]"
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
