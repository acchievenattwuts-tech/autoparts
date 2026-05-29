"use client";

import { useTransition, useState } from "react";
import { Loader2 } from "lucide-react";
import ScrollReveal from "@/components/shared/ScrollReveal";
import ProductCard from "@/components/shared/ProductCard";
import { loadMoreRelatedProducts, type RelatedProduct } from "./related-products-actions";

interface Props {
  initialProducts: RelatedProduct[];
  initialHasMore: boolean;
  categoryId: string;
  currentProductId: string;
  lineUrl: string;
}

const RelatedProductsSection = ({
  initialProducts,
  initialHasMore,
  categoryId,
  currentProductId,
  lineUrl,
}: Props) => {
  const [products, setProducts] = useState<RelatedProduct[]>(initialProducts);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isPending, startTransition] = useTransition();

  const handleLoadMore = () => {
    startTransition(async () => {
      const result = await loadMoreRelatedProducts({
        categoryId,
        currentProductId,
        skip: products.length,
      });
      setProducts((prev) => [...prev, ...result.products]);
      setHasMore(result.hasMore);
    });
  };

  return (
    <section className="mx-auto max-w-7xl px-4 pb-6 sm:px-6 lg:px-8">
      <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="font-kanit text-xl font-semibold text-[#10213d]">
          สินค้าใกล้เคียงในหมวดเดียวกัน
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          ถ้ายังต้องการเทียบหลายตัวก่อนสั่ง ลองเปิดดูสินค้าอื่นในหมวดเดียวกันแล้วส่งลิงก์หรือรหัสที่สงสัยให้ร้านช่วยเช็กต่อได้
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((product, index) => (
            <ScrollReveal key={product.id} delay={index < 8 ? index * 40 : 0} className="h-full">
              <ProductCard product={product} lineUrl={lineUrl} />
            </ScrollReveal>
          ))}
        </div>
        {hasMore && (
          <div className="mt-5 flex justify-center">
            <button
              onClick={handleLoadMore}
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-6 py-2.5 text-sm font-semibold text-[#10213d] shadow-sm transition hover:border-[#f97316]/40 hover:bg-orange-50 hover:text-[#f97316] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  กำลังโหลด...
                </>
              ) : (
                "ดูสินค้าเพิ่มเติม"
              )}
            </button>
          </div>
        )}
      </div>
    </section>
  );
};

export default RelatedProductsSection;
