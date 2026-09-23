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

/** Append `next` to `current`, skipping any product already shown. */
export const appendUniqueById = <T extends { id: string }>(current: T[], next: T[]): T[] => {
  const seen = new Set(current.map((product) => product.id));
  const appended = next.filter((product) => {
    if (seen.has(product.id)) return false;
    seen.add(product.id);
    return true;
  });
  return appended.length > 0 ? [...current, ...appended] : current;
};

const RelatedProductsSection = ({
  initialProducts,
  initialHasMore,
  categoryId,
  currentProductId,
  lineUrl,
}: Props) => {
  const [products, setProducts] = useState<RelatedProduct[]>(initialProducts);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadFailed, setLoadFailed] = useState(false);
  // Rows consumed from the server so far. Tracked apart from products.length so
  // a page that only repeated already-shown products still advances the offset.
  const [nextSkip, setNextSkip] = useState(initialProducts.length);
  const [isPending, startTransition] = useTransition();

  const handleLoadMore = () => {
    startTransition(async () => {
      try {
        const result = await loadMoreRelatedProducts({
          categoryId,
          currentProductId,
          skip: nextSkip,
        });
        // Throttled or failed: keep the list and the button so the customer can
        // retry, rather than treating it as the end of the category.
        if (result.failed) {
          setLoadFailed(true);
          return;
        }
        setLoadFailed(false);
        // The first batch is cached while later pages are live, so a product can
        // shift across the page boundary — never render the same card twice.
        setProducts((prev) => appendUniqueById(prev, result.products));
        setNextSkip((skip) => skip + result.products.length);
        setHasMore(result.hasMore);
      } catch (error) {
        console.error("[RelatedProductsSection] load more failed", error);
        setLoadFailed(true);
      }
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
          <div className="mt-5 flex flex-col items-center gap-2">
            {loadFailed && !isPending && (
              <p role="status" className="text-sm text-slate-500">
                โหลดสินค้าเพิ่มไม่สำเร็จ กรุณาลองอีกครั้ง
              </p>
            )}
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
