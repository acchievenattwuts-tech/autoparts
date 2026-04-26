import Image from "next/image";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { getProductPath } from "@/lib/product-slug";

type ProductForCard = {
  id: string;
  slug?: string | null;
  name: string;
  code: string;
  imageUrl: string | null;
  salePrice: { toString(): string } | number;
  stock: number;
  reportUnitName: string;
  category: { name: string; slug?: string | null };
  brand: { name: string } | null;
  carModels?: { carModel: { name: string; carBrand: { name: string } } }[];
};

interface Props {
  product: ProductForCard;
  lineUrl: string;
  prefetchDetail?: boolean;
}

const ProductCard = ({ product, lineUrl, prefetchDetail }: Props) => {
  const inStock = product.stock > 0;
  const productPath = getProductPath({
    category: product.category,
    product,
  });

  const compatibilitySummary =
    product.carModels && product.carModels.length > 0
      ? (() => {
          const firstBrand = product.carModels[0].carModel.carBrand.name;
          const modelNames = product.carModels
            .filter(({ carModel }) => carModel.carBrand.name === firstBrand)
            .map(({ carModel }) => carModel.name);
          const uniqueModels = Array.from(new Set(modelNames));
          const preview = uniqueModels.slice(0, 2).join(", ");
          const extra = uniqueModels.length > 2 ? ` +${uniqueModels.length - 2}` : "";
          return `${firstBrand}${preview ? ` โดย ${preview}${extra}` : ""}`;
        })()
      : null;

  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white transition-all duration-300 hover:border-gray-200 hover:shadow-lg">
      <Link
        href={productPath}
        prefetch={prefetchDetail}
        className="relative h-32 shrink-0 overflow-hidden bg-gradient-to-br from-gray-100 to-gray-50 sm:h-40 lg:h-44"
      >
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={`${product.name}${product.brand ? ` ${product.brand.name}` : ""} | อะไหล่แอร์รถยนต์ ${product.category.name}`}
            fill
            className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.08] motion-reduce:transform-none motion-reduce:transition-none"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-5xl opacity-20">📦</span>
          </div>
        )}
        {!inStock && (
          <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">
            สินค้าหมด
          </span>
        )}
      </Link>

      <div className="flex flex-1 flex-col p-3 sm:p-4">
        <span className="self-start rounded-full bg-[#1e3a5f]/10 px-2 py-0.5 text-xs font-medium text-[#1e3a5f]">
          {product.category.name}
        </span>

        <Link href={productPath} prefetch={prefetchDetail} className="mt-2 block flex-1">
          <h3 className="line-clamp-2 text-xs font-bold leading-snug text-gray-900 transition-colors group-hover:text-[#1e3a5f] sm:text-sm">
            {product.name}
          </h3>
        </Link>

        <div className="mt-1 min-h-[2.35rem] space-y-1 sm:min-h-[2.75rem]">
          {product.brand && <p className="text-xs text-gray-400">{product.brand.name}</p>}
          {compatibilitySummary && (
            <p className="line-clamp-1 text-xs text-slate-500">{compatibilitySummary}</p>
          )}
        </div>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div>
            <p className="text-xs text-gray-400">ราคา</p>
            <p className="text-base font-bold text-[#f97316] sm:text-lg">
              ฿{Number(product.salePrice).toLocaleString("th-TH")}
            </p>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <Link
              href={productPath}
              prefetch={prefetchDetail}
              className="rounded-full border border-gray-200 px-2.5 py-2 text-[11px] font-semibold text-[#1e3a5f] transition hover:border-[#1e3a5f] sm:px-3 sm:text-xs"
            >
              ดูรายละเอียด
            </Link>
            <a
              href={lineUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="sf-shine flex items-center gap-1 rounded-full bg-[#06C755] px-2.5 py-2 text-[11px] font-semibold text-white transition-all hover:scale-105 hover:bg-[#05a847] sm:gap-1.5 sm:px-3 sm:text-xs"
            >
              <MessageCircle size={11} />
              สอบถาม
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductCard;
