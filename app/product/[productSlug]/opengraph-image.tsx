import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ReactElement } from "react";
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
    productSlug: string;
  }>;
}

// Load Thai-capable fonts so Satori/resvg can rasterize Thai glyphs.
// Without these, Thai product names produce an SVG that resvg fails to render
// ("svgload_buffer: SVG rendering failed"), causing a 500 on this route.
// Read the bundled Thai fonts straight off the filesystem. `fetch(new URL(...,
// import.meta.url))` does not work on Vercel: the .ttf is emitted as a static
// asset and import.meta.url resolves to a relative path (/_next/static/media/...)
// with no origin, so fetch throws ERR_INVALID_URL. `process.cwd()` + a project
// path is the standard next/og pattern and needs no origin/env.
//
// Fonts live OUTSIDE this `[productSlug]` route folder on purpose: the square
// brackets are glob character-class syntax, so an `outputFileTracingIncludes`
// glob pointing into `app/product/[productSlug]/fonts/**` never matches and the
// .ttf files are silently dropped from the lambda (ENOENT at runtime). A
// bracket-free path (lib/og-fonts) lets the trace include actually bundle them.
const FONT_DIR = path.join(process.cwd(), "lib", "og-fonts");

// The bundled OG fonts (Kanit, Sarabun) cover ASCII + the Thai block only, so
// emoji in product descriptions (🚗 ✅ 📌 ⚠️ 🔍) have no glyph. Rather than
// resolving them via a CDN `emoji` provider (Satori fetches a colour SVG per
// emoji at render time, and resvg intermittently fails to parse those buffers —
// "svgload_buffer: SVG rendering failed" — which drops the whole product card to
// the plain fallback), we strip emoji from the OG text entirely. The storefront
// page keeps the emoji; only the shared-link preview image is emoji-free.
//
// Covers the emoji blocks plus the modifiers that make an emoji sequence
// (variation selector U+FE0F, skin-tone modifiers U+1F3FB–FF, ZWJ U+200D, and
// regional-indicator flags), then collapses the whitespace the removal leaves.
const EMOJI_PATTERN =
  /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F3FB}-\u{1F3FF}\u{200D}\u{20E3}]/gu;

const stripEmoji = (raw: string): string =>
  raw.replace(EMOJI_PATTERN, "").replace(/\s{2,}/g, " ").trim();

const loadFonts = async (): Promise<
  { name: string; data: Buffer; weight: 400 | 700; style: "normal" }[]
> => {
  const [kanitBold, sarabunRegular] = await Promise.all([
    readFile(path.join(FONT_DIR, "Kanit-Bold.ttf")),
    readFile(path.join(FONT_DIR, "Sarabun-Regular.ttf")),
  ]);

  return [
    { name: "Kanit", data: kanitBold, weight: 700, style: "normal" },
    { name: "Sarabun", data: sarabunRegular, weight: 400, style: "normal" },
  ];
};

// Rasterize eagerly by draining the ImageResponse body into a buffer. `new
// ImageResponse(...)` is lazy: satori/resvg only run when Next pipes the body,
// which happens AFTER the handler returns — outside any try/catch here — so a
// rasterization failure used to escape as "failed to pipe response" (500).
// Reading the body forces the render to complete (and throw) inside the try, so
// the containment fallback can actually take over.
const renderToImage = async (
  element: ReactElement,
  fonts: Awaited<ReturnType<typeof loadFonts>>,
): Promise<Response> => {
  const response = new ImageResponse(element, {
    ...size,
    fonts,
  });
  const body = await response.arrayBuffer();
  return new Response(body, { headers: response.headers });
};

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
  let fonts: Awaited<ReturnType<typeof loadFonts>> | undefined;

  try {
    // Load fonts inside the try so any failure (e.g. ENOENT if the .ttf is not
    // bundled into the lambda) flows into the containment fallback below instead
    // of escaping as a 500.
    fonts = await loadFonts();

    return await renderToImage(
      <OgImageTemplate
        eyebrow={stripEmoji(product.category.name)}
        title={stripEmoji(product.name)}
        description={stripEmoji(buildStorefrontProductDescription(product))}
        meta={stripEmoji(product.brand?.name || product.code)}
      />,
      fonts,
    );
  } catch (error) {
    // Containment: never return a 500 to crawlers if font loading or rasterization
    // fails. Fall back to a minimal plain ASCII image. Reuse the fonts when they
    // loaded; only when font loading itself failed do we omit them (and the text is
    // ASCII-only so satori's default suffices).
    console.error("[opengraph-image] render failed", error);

    const fallback = (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f2140",
          color: "white",
          fontSize: 48,
          fontFamily: fonts ? "Sarabun" : undefined,
        }}
      >
        www.sriwanparts.com
      </div>
    );

    try {
      if (fonts) {
        return await renderToImage(fallback, fonts);
      }
      // Fonts never loaded — ASCII-only text renders fine with satori's default.
      const response = new ImageResponse(fallback, size);
      const body = await response.arrayBuffer();
      return new Response(body, { headers: response.headers });
    } catch (fallbackError) {
      // Last-resort guard so even a fallback rasterization failure does not 500.
      console.error("[opengraph-image] fallback render failed", fallbackError);
      return new Response("", {
        status: 204,
        headers: { "Cache-Control": "public, max-age=60" },
      });
    }
  }
}
