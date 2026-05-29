import assert from "node:assert/strict";
import {
  extractProductIdFromSlug,
  getLegacyThaiProductPathRedirectTarget,
  isLegacyThaiProductPath,
  shouldRedirectToCanonicalProductPath,
} from "../lib/product-slug";

const legacyThaiProductPath =
  "/product/รีซิสเตอร์โบเวอร์แอร์-hino-mega-24v-cmpjq3mok000004jwu7bns3o2";
const canonicalProductPath = "/product/hino-mega-24v-cmpjq3mok000004jwu7bns3o2";

assert.equal(
  shouldRedirectToCanonicalProductPath({
    requestedPath: legacyThaiProductPath,
    canonicalPath: canonicalProductPath,
  }),
  false,
  "Legacy Thai product URLs should render with canonical metadata instead of hard-redirecting on the server",
);

assert.equal(
  shouldRedirectToCanonicalProductPath({
    requestedPath: "/product/hino-mega-24v-cmpjq3mok000004jwu7bns3o2",
    canonicalPath: canonicalProductPath,
  }),
  false,
  "Canonical product URLs must not redirect",
);

assert.equal(
  shouldRedirectToCanonicalProductPath({
    requestedPath: "/product/old-english-slug-cmpjq3mok000004jwu7bns3o2",
    canonicalPath: canonicalProductPath,
  }),
  true,
  "ASCII-only stale slugs should still redirect to the canonical product path",
);

assert.equal(
  getLegacyThaiProductPathRedirectTarget({
    pathname: legacyThaiProductPath,
    canonicalPath: canonicalProductPath,
  }),
  canonicalProductPath,
  "Legacy Thai product URLs should resolve to the English canonical path in proxy",
);

assert.equal(
  getLegacyThaiProductPathRedirectTarget({
    pathname: canonicalProductPath,
    canonicalPath: canonicalProductPath,
  }),
  null,
  "Canonical product URLs must not redirect in proxy",
);

assert.equal(
  getLegacyThaiProductPathRedirectTarget({
    pathname: "/product/old-english-slug-cmpjq3mok000004jwu7bns3o2",
    canonicalPath: canonicalProductPath,
  }),
  null,
  "ASCII-only stale slugs are handled by the page redirect and should be ignored by proxy",
);

assert.equal(
  isLegacyThaiProductPath(legacyThaiProductPath),
  true,
  "Legacy Thai product URLs should be detectable before proxy DB lookup",
);

assert.equal(
  isLegacyThaiProductPath(canonicalProductPath),
  false,
  "Canonical English product URLs should skip proxy DB lookup",
);

assert.equal(
  extractProductIdFromSlug("รีซิสเตอร์โบเวอร์แอร์-hino-mega-24v-cmpjq3mok000004jwu7bns3o2"),
  "cmpjq3mok000004jwu7bns3o2",
  "Legacy Thai product slugs must still expose the product id suffix",
);

console.log("Product canonical redirect checks passed");
