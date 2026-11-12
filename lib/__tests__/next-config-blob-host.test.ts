import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { hasRemoteMatch } from "next/dist/shared/lib/match-remote-pattern";
import nextConfig from "../../next.config";

// P5 (2026-11-12): next/image and the CSP img-src allow only the shop's own public
// Blob store, not every account's `*.public.blob.vercel-storage.com` store. The
// shop's stored image URLs must keep matching; another store must not.

const SHOP_BLOB_HOST = "gjo7yq8dwaho55nx.public.blob.vercel-storage.com";
const SHOP_URLS = [
  `https://${SHOP_BLOB_HOST}/products/P00123/1730000000000-uuid.webp`,
  `https://${SHOP_BLOB_HOST}/settings/categories/cat-1/1730000000000-uuid.webp`,
  `https://${SHOP_BLOB_HOST}/settings/logo.png`,
  `https://${SHOP_BLOB_HOST}/users/signatures/u1.png`,
  `https://${SHOP_BLOB_HOST}/delivery-proofs/sale1/0-photo-u.jpg`,
  `https://${SHOP_BLOB_HOST}/line-chat/2026/11/12/uuid.jpg`,
];

const remotePatterns = (): NonNullable<NonNullable<typeof nextConfig.images>["remotePatterns"]> =>
  nextConfig.images?.remotePatterns ?? [];

const imgSrcDirective = async (): Promise<string> => {
  const rules = (await nextConfig.headers?.()) ?? [];
  const csp = rules.flatMap((rule) => rule.headers).find((header) => header.key === "Content-Security-Policy");
  const directive = csp?.value.split("; ").find((part) => part.startsWith("img-src "));
  assert.ok(directive, "img-src directive present");
  return directive;
};

test("next/image accepts the shop's Blob URLs and rejects other Blob stores", () => {
  for (const url of SHOP_URLS) {
    assert.equal(hasRemoteMatch([], remotePatterns(), new URL(url)), true, url);
  }
  for (const url of [
    "https://otherstore123.public.blob.vercel-storage.com/products/x.webp",
    `https://evil.${SHOP_BLOB_HOST}/products/x.webp`,
    `http://${SHOP_BLOB_HOST}/products/x.webp`,
  ]) {
    assert.equal(hasRemoteMatch([], remotePatterns(), new URL(url)), false, url);
  }
});

test("CSP img-src lists the exact store host and keeps every other source", async () => {
  const directive = await imgSrcDirective();
  assert.equal(
    directive,
    `img-src 'self' data: blob: https://${SHOP_BLOB_HOST} https://www.googletagmanager.com https://www.google-analytics.com https://*.line-scdn.net https://*.tile.openstreetmap.org`,
  );
});

test("the allowed host is the same store the Blob repair script writes to", () => {
  const script = readFileSync(path.join(process.cwd(), "prisma", "scripts", "fix-dangling-supabase-refs.ts"), "utf8");
  assert.match(script, new RegExp(`const BLOB_PUBLIC_BASE = "https://${SHOP_BLOB_HOST.replace(/\./g, "\\.")}/";`));
});
