import { notFound } from "next/navigation";
import OgImageTemplate from "@/components/seo/OgImageTemplate";
import { renderOgCard, stripOgEmoji } from "@/lib/og-render";
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

export default async function OpenGraphImage({ params }: Props): Promise<Response> {
  const { productSlug } = await params;
  const productId = extractProductIdFromSlug(productSlug);

  if (!productId) {
    notFound();
  }

  const product = await getActiveStorefrontProductById(productId);

  if (!product) {
    notFound();
  }

  // Same shared renderer as the canonical /product/[slug] card (lib/og-render.tsx).
  return renderOgCard(
    (
      <OgImageTemplate
        eyebrow={stripOgEmoji(product.category.name)}
        title={stripOgEmoji(product.name)}
        description={stripOgEmoji(buildStorefrontProductDescription(product))}
        meta={stripOgEmoji(product.brand?.name || product.code)}
      />
    ),
    "opengraph-image:legacy-product",
  );
}
