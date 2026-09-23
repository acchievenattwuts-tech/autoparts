import { notFound } from "next/navigation";
import OgImageTemplate from "@/components/seo/OgImageTemplate";
import {
  loadOgFonts,
  renderOgFallbackImage,
  renderOgImage,
  stripOgEmoji,
  type OgFont,
} from "@/lib/og-render";
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
    productSlug: string;
  }>;
}

// Font loading, emoji stripping, eager rasterization and the plain fallback card
// live in lib/og-render.tsx so every OG route shares them. See that file for why
// each one exists (resvg Thai/emoji failures, lazy ImageResponse bodies, fonts
// read off the filesystem from the bracket-free lib/og-fonts directory).

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

  // Track fonts outside the try so the fallback can reuse them when they did load.
  // Passing an explicit font to the rasterizer is essential: with no `fonts`, satori
  // tries to fetch a default font from fonts.googleapis.com at render time — that
  // outbound request has failed in production before.
  let fonts: OgFont[] | undefined;

  try {
    // Load fonts inside the try so any failure (e.g. ENOENT if the .ttf is not
    // bundled into the lambda) flows into the containment fallback below instead
    // of escaping as a 500.
    fonts = await loadOgFonts();

    return await renderOgImage(
      <OgImageTemplate
        eyebrow={stripOgEmoji(product.category.name)}
        title={stripOgEmoji(product.name)}
        description={stripOgEmoji(buildStorefrontProductDescription(product))}
        meta={stripOgEmoji(product.brand?.name || product.code)}
      />,
      fonts,
    );
  } catch (error) {
    // Containment: never return a 500 to crawlers if font loading or rasterization
    // fails. Fall back to a minimal plain ASCII image (reusing the fonts when they
    // loaded), and to an empty 204 if even that cannot be rasterized.
    console.error("[opengraph-image] render failed", error);
    return renderOgFallbackImage("opengraph-image", fonts);
  }
}
