import type { LineFlexMessage } from "@/lib/line-daily-summary";
import type { LineMatchedProductSummary } from "@/lib/line-product-search-bridge";

/**
 * Builds a LINE Flex message that shows matched catalog products as cards with a
 * "ดูสินค้า" button linking to the real storefront page. One product → a single
 * bubble; multiple → a carousel plus a "ดูทั้งหมด" bubble linking to the filtered
 * search page. Returns null when it can't build safe links (no base URL) or there
 * is nothing to show — callers then just send the text reply.
 *
 * Image fallback (option C): product image → placeholder logo → omit the image
 * block entirely, so a missing image never renders as a broken thumbnail.
 */

const BRAND_COLOR = "#1e3a5f";
const MUTED_COLOR = "#888888";
const MAX_CARDS = 10; // LINE allows up to 12 bubbles per carousel; keep margin for the view-all card.

function getStorefrontBaseUrl(): string | null {
  const raw =
    process.env.APP_BASE_URL || process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || null;
  return raw ? raw.replace(/\/+$/, "") : null;
}

function getPlaceholderImageUrl(): string | null {
  const raw = process.env.LINE_FLEX_PLACEHOLDER_IMAGE_URL?.trim();
  return raw && /^https:\/\//i.test(raw) ? raw : null;
}

function productUrl(baseUrl: string, product: LineMatchedProductSummary): string {
  return product.slug
    ? `${baseUrl}/product/${product.slug}`
    : `${baseUrl}/products?q=${encodeURIComponent(product.name)}`;
}

function searchUrl(baseUrl: string, query: string): string {
  return `${baseUrl}/products?q=${encodeURIComponent(query)}`;
}

function priceText(salePrice: number): string {
  return salePrice > 0 ? `฿${salePrice.toLocaleString("th-TH")}` : "สอบถามราคา";
}

function buildProductBubble(
  product: LineMatchedProductSummary,
  baseUrl: string,
  placeholderImageUrl: string | null,
): Record<string, unknown> {
  const url = productUrl(baseUrl, product);
  const imageUrl = product.imageUrl || placeholderImageUrl;

  const bodyContents: Record<string, unknown>[] = [
    { type: "text", text: product.name, weight: "bold", size: "sm", wrap: true, maxLines: 3 },
  ];
  if (product.code) {
    bodyContents.push({ type: "text", text: `รหัส ${product.code}`, size: "xs", color: MUTED_COLOR });
  }
  bodyContents.push({
    type: "text",
    text: priceText(product.salePrice),
    size: "sm",
    weight: "bold",
    color: BRAND_COLOR,
    margin: "sm",
  });

  return {
    type: "bubble",
    ...(imageUrl
      ? {
          hero: {
            type: "image",
            url: imageUrl,
            size: "full",
            aspectRatio: "1:1",
            aspectMode: "cover",
            action: { type: "uri", uri: url },
          },
        }
      : {}),
    body: { type: "box", layout: "vertical", spacing: "sm", contents: bodyContents },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "button",
          style: "primary",
          height: "sm",
          color: BRAND_COLOR,
          action: { type: "uri", label: "ดูสินค้า", uri: url },
        },
      ],
    },
  };
}

function buildViewAllBubble(baseUrl: string, query: string, total: number): Record<string, unknown> {
  return {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      justifyContent: "center",
      spacing: "sm",
      contents: [
        { type: "text", text: "ดูสินค้าทั้งหมด", weight: "bold", align: "center", wrap: true },
        { type: "text", text: `${total.toLocaleString("th-TH")} รายการ`, size: "sm", color: MUTED_COLOR, align: "center" },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "button",
          style: "secondary",
          height: "sm",
          action: { type: "uri", label: "ดูทั้งหมดบนเว็บ", uri: searchUrl(baseUrl, query) },
        },
      ],
    },
  };
}

export function buildProductFlexMessage(input: {
  products: LineMatchedProductSummary[];
  searchQuery: string | null;
  total: number;
}): LineFlexMessage | null {
  const baseUrl = getStorefrontBaseUrl();
  if (!baseUrl || input.products.length === 0) return null;

  const placeholderImageUrl = getPlaceholderImageUrl();
  const shown = input.products.slice(0, MAX_CARDS);

  if (shown.length === 1) {
    return {
      type: "flex",
      altText: `สินค้า: ${shown[0].name}`,
      contents: buildProductBubble(shown[0], baseUrl, placeholderImageUrl),
    };
  }

  const bubbles = shown.map((product) => buildProductBubble(product, baseUrl, placeholderImageUrl));
  if (input.searchQuery && input.total > shown.length) {
    bubbles.push(buildViewAllBubble(baseUrl, input.searchQuery, input.total));
  }

  return {
    type: "flex",
    altText: `พบสินค้า ${input.total.toLocaleString("th-TH")} รายการ`,
    contents: { type: "carousel", contents: bubbles },
  };
}
