import { readFileSync } from "node:fs";
import path from "node:path";

// The shop logo drawn into every satori-generated OG card.
//
// The file lives in `lib/og-assets/` rather than `public/` on purpose: files
// under `public/` are served by the CDN and are NOT guaranteed to exist on the
// lambda filesystem, while a path traced through `outputFileTracingIncludes`
// (see next.config.ts) is bundled with the function. This mirrors the existing
// `lib/og-fonts` arrangement and keeps the path free of route-segment brackets,
// which break tracing globs.
const LOGO_PATH = path.join(process.cwd(), "lib", "og-assets", "logo.png");

// Satori cannot fetch a relative URL, so the image must be inlined as a data
// URI. Reading + base64-encoding a 160 KB PNG on every render is wasteful, so
// the result is memoised per lambda instance.
let cachedLogoDataUri: string | null | undefined;

/**
 * Return the logo as a base64 data URI, or `null` when it cannot be read.
 *
 * Never throws: a missing logo must degrade to a card without the mark rather
 * than fail the whole OG image and hand a crawler a 500.
 */
export const getOgLogoDataUri = (): string | null => {
  if (cachedLogoDataUri !== undefined) {
    return cachedLogoDataUri;
  }

  try {
    const logo = readFileSync(LOGO_PATH);
    cachedLogoDataUri = `data:image/png;base64,${logo.toString("base64")}`;
  } catch (error) {
    console.error("[og-logo] failed to read logo", error);
    cachedLogoDataUri = null;
  }

  return cachedLogoDataUri;
};
