import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ReactElement } from "react";
import { ImageResponse } from "next/og";

/**
 * Shared rendering helpers for every satori-generated OG card.
 *
 * Extracted from app/product/[productSlug]/opengraph-image.tsx, which learned
 * each of these lessons in production; the other OG routes (home, about, faq,
 * category, legacy product) now reuse them instead of calling `ImageResponse`
 * bare with no Thai font and no containment.
 */

export const OG_IMAGE_SIZE = {
  width: 1200,
  height: 630,
};

export interface OgFont {
  name: string;
  data: Buffer;
  weight: 400 | 700;
  style: "normal";
}

// Load Thai-capable fonts so Satori/resvg can rasterize Thai glyphs.
// Without these, Thai text produces an SVG that resvg can fail to render
// ("svgload_buffer: SVG rendering failed"), and satori otherwise fetches a font
// from fonts.googleapis.com at render time.
//
// Read straight off the filesystem: `fetch(new URL(..., import.meta.url))` does
// not work on Vercel (the .ttf becomes a static asset with no origin). The fonts
// live in the bracket-free lib/og-fonts directory because route-segment brackets
// break `outputFileTracingIncludes` globs (see next.config.ts). A route whose
// lambda does not trace these files gets ENOENT here — callers must treat a
// rejection as "no bundled fonts", never as a hard failure.
const FONT_DIR = path.join(process.cwd(), "lib", "og-fonts");

// The bundled OG fonts (Kanit, Sarabun) cover ASCII + the Thai block only, so
// emoji have no glyph. Resolving them through a CDN emoji provider makes satori
// fetch a colour SVG per emoji at render time, and resvg intermittently fails to
// parse those buffers — so emoji are stripped from OG text entirely. Pages keep
// their emoji; only the shared-link preview image is emoji-free.
//
// Covers the emoji blocks plus the modifiers that make an emoji sequence
// (variation selector U+FE0F, skin-tone modifiers U+1F3FB–FF, ZWJ U+200D, and
// regional-indicator flags), then collapses the whitespace the removal leaves.
const EMOJI_PATTERN =
  /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F3FB}-\u{1F3FF}\u{200D}\u{20E3}]/gu;

export const stripOgEmoji = (raw: string): string =>
  raw.replace(EMOJI_PATTERN, "").replace(/\s{2,}/g, " ").trim();

export const loadOgFonts = async (): Promise<OgFont[]> => {
  const [kanitBold, sarabunRegular] = await Promise.all([
    readFile(path.join(FONT_DIR, "Kanit-Bold.ttf")),
    readFile(path.join(FONT_DIR, "Sarabun-Regular.ttf")),
  ]);

  return [
    { name: "Kanit", data: kanitBold, weight: 700, style: "normal" },
    { name: "Sarabun", data: sarabunRegular, weight: 400, style: "normal" },
  ];
};

/**
 * Rasterize eagerly by draining the ImageResponse body into a buffer.
 *
 * `new ImageResponse(...)` is lazy: satori/resvg only run when Next pipes the
 * body, which happens AFTER the handler returns — outside any try/catch — so a
 * rasterization failure escapes as "failed to pipe response" (500). Reading the
 * body forces the render to complete (and throw) where the caller can contain it.
 *
 * With no `fonts`, this is exactly the bare `new ImageResponse(element, size)`
 * the routes used before, just drained.
 */
export const renderOgImage = async (
  element: ReactElement,
  fonts?: OgFont[],
): Promise<Response> => {
  const response = new ImageResponse(
    element,
    fonts ? { ...OG_IMAGE_SIZE, fonts } : OG_IMAGE_SIZE,
  );
  const body = await response.arrayBuffer();
  return new Response(body, { headers: response.headers });
};

/**
 * Containment of last resort: a plain ASCII card, and if even that cannot be
 * rasterized, an empty 204 — never a 500 to a crawler.
 *
 * Reuses the fonts when they loaded; when they did not, the text is ASCII-only
 * so satori's default font suffices.
 */
export const renderOgFallbackImage = async (
  logLabel: string,
  fonts?: OgFont[],
): Promise<Response> => {
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
    return await renderOgImage(fallback, fonts);
  } catch (fallbackError) {
    console.error(`[${logLabel}] fallback render failed`, fallbackError);
    // The body must be null: `new Response("", { status: 204 })` throws
    // ("Invalid response status code 204"), which turned this last-resort guard
    // into the very 500 it exists to prevent.
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "public, max-age=60" },
    });
  }
};

/**
 * Render an OG card with the bundled Thai fonts, degrading step by step so the
 * result is never worse than the old bare `ImageResponse` call:
 *
 * 1. bundled Kanit/Sarabun fonts (the intended look);
 * 2. no `fonts` — the previous behaviour, used when the fonts are not traced
 *    into this route's lambda or the font render failed;
 * 3. the plain ASCII fallback card, then an empty 204.
 */
export const renderOgCard = async (
  element: ReactElement,
  logLabel: string,
): Promise<Response> => {
  let fonts: OgFont[] | undefined;

  try {
    fonts = await loadOgFonts();
  } catch (error) {
    console.error(`[${logLabel}] font load failed`, error);
  }

  if (fonts) {
    try {
      return await renderOgImage(element, fonts);
    } catch (error) {
      console.error(`[${logLabel}] render with bundled fonts failed`, error);
    }
  }

  try {
    return await renderOgImage(element);
  } catch (error) {
    console.error(`[${logLabel}] render failed`, error);
  }

  return renderOgFallbackImage(logLabel, fonts);
};
