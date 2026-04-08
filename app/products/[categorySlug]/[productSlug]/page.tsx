export const revalidate = 300;
export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { absoluteUrl } from "@/lib/seo";
import { extractProductIdFromSlug, getProductPath } from "@/lib/product-slug";
import { getActiveStorefrontProductById } from "@/lib/storefront-product";

interface Props {
  params: Promise<{
    categorySlug: string;
    productSlug: string;
  }>;
}

const getCanonicalPathFromParams = async (paramsPromise: Props["params"]) => {
  const { productSlug } = await paramsPromise;
  const productId = extractProductIdFromSlug(productSlug);

  if (!productId) {
    notFound();
  }

  const product = await getActiveStorefrontProductById(productId);

  if (!product) {
    notFound();
  }

  return getProductPath({
    category: product.category,
    product,
  });
};

export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const canonicalPath = await getCanonicalPathFromParams(params);

  return {
    alternates: {
      canonical: absoluteUrl(canonicalPath),
    },
    robots: {
      index: false,
      follow: true,
    },
  };
}

const LegacyProductRedirectPage = async ({ params }: Props) => {
  const canonicalPath = await getCanonicalPathFromParams(params);
  permanentRedirect(canonicalPath);
};

export default LegacyProductRedirectPage;
