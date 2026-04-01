import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import OgImageTemplate from "@/components/seo/OgImageTemplate";
import { extractProductIdFromSlug } from "@/lib/product-slug";
import {
  buildStorefrontProductDescription,
  getActiveStorefrontProductById,
} from "@/lib/storefront-product";

export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

interface Props {
  params: Promise<{
    categorySlug: string;
    productSlug: string;
  }>;
}

export default async function OpenGraphImage({ params }: Props) {
  const { productSlug } = await params;
  const productId = extractProductIdFromSlug(productSlug);

  if (!productId) {
    notFound();
  }

  const product = await getActiveStorefrontProductById(productId);

  if (!product) {
    notFound();
  }

  return new ImageResponse(
    (
      <OgImageTemplate
        eyebrow={product.category.name}
        title={product.name}
        description={buildStorefrontProductDescription(product)}
        meta={product.brand?.name || product.code}
      />
    ),
    size,
  );
}
