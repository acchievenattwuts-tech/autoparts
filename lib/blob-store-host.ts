/**
 * The shop's own public Vercel Blob store (the store of BLOB_READ_WRITE_TOKEN).
 *
 * Every stored image URL is on this host. One source of truth for:
 *  - `next.config.ts` — next/image `remotePatterns` and the CSP `img-src` list this
 *    host exactly, not the `*.public.blob.vercel-storage.com` wildcard, so
 *    /_next/image and img-src never serve other accounts' Blob stores;
 *  - `isShopPublicBlobUrl()` below — which public Blob URLs the app treats as its
 *    own: product and category images an admin may save, copy or delete, and
 *    legacy public expense / WHT / delivery-proof files it may delete or open.
 *
 * Update it if the store ever changes (keep the old host accepted until every
 * stored URL has moved). Keep this file free of imports: `next.config.ts` loads
 * it through Next's config transpiler, outside the app bundle and without the
 * `@/` path alias.
 */
export const PUBLIC_BLOB_STORE_HOST = "gjo7yq8dwaho55nx.public.blob.vercel-storage.com";

/** The only scheme the shop's Blob store serves. */
const SHOP_BLOB_PROTOCOL = "https:";

/**
 * True only for a URL on the shop's own public Blob store: `https`, this exact
 * host, the default port and no user-info. Any other account's
 * `*.public.blob.vercel-storage.com` store, a look-alike host or `http` is false.
 */
export const isShopPublicBlobUrl = (url: URL): boolean =>
  url.protocol === SHOP_BLOB_PROTOCOL &&
  url.hostname === PUBLIC_BLOB_STORE_HOST &&
  url.port === "" &&
  url.username === "" &&
  url.password === "";
