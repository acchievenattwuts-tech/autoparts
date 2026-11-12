import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import nextConfig from "../../next.config";
import { PUBLIC_BLOB_STORE_HOST } from "@/lib/blob-store-host";
import { isOwnedBlobCategoryImageUrl, isOwnedBlobProductUrl } from "@/lib/products-bucket-storage";

// Category image URLs an admin may save (2026-11-12 round 3): only the shop's own
// Blob store, the same single host next/image and the CSP img-src allow — not any
// account's `*.public.blob.vercel-storage.com` store.

const SHOP_HOST = "gjo7yq8dwaho55nx.public.blob.vercel-storage.com";
const CATEGORY_PATH = "settings/categories/cat1/1730000000000-uuid.webp";

test("the shared constant is the shop's store host", () => {
  assert.equal(PUBLIC_BLOB_STORE_HOST, SHOP_HOST);
});

test("accepts the shop's own store under the category root", () => {
  assert.equal(isOwnedBlobCategoryImageUrl(`https://${SHOP_HOST}/${CATEGORY_PATH}`), true);
  assert.equal(isOwnedBlobCategoryImageUrl(`https://${SHOP_HOST.toUpperCase()}/${CATEGORY_PATH}`), true, "hosts are case-insensitive");
  assert.equal(isOwnedBlobCategoryImageUrl(`https://${SHOP_HOST}/settings/categories/new/a%20b.png`), true);
});

test("rejects another account's Blob store", () => {
  for (const host of [
    "otherstore123.public.blob.vercel-storage.com",
    "abcdefghijklmnop.public.blob.vercel-storage.com",
  ]) {
    assert.equal(isOwnedBlobCategoryImageUrl(`https://${host}/${CATEGORY_PATH}`), false, host);
  }
});

test("rejects lookalike hosts", () => {
  for (const url of [
    `https://evil.${SHOP_HOST}/${CATEGORY_PATH}`,
    `https://x${SHOP_HOST}/${CATEGORY_PATH}`,
    `https://${SHOP_HOST}.evil.example/${CATEGORY_PATH}`,
    `https://${SHOP_HOST.replace(".public.", "-public.")}/${CATEGORY_PATH}`,
    `https://${SHOP_HOST}@evil.example/${CATEGORY_PATH}`,
    `https://evil.example/${SHOP_HOST}/${CATEGORY_PATH}`,
    `https://evil.example/${CATEGORY_PATH}?host=${SHOP_HOST}`,
    "https://public.blob.vercel-storage.com/settings/categories/cat1/x.webp",
  ]) {
    assert.equal(isOwnedBlobCategoryImageUrl(url), false, url);
  }
});

test("still rejects what it rejected before: other roots and non-URLs", () => {
  for (const url of [
    `https://${SHOP_HOST}/products/P001/x.webp`,
    `https://${SHOP_HOST}/settings/logo.png`,
    `https://${SHOP_HOST}/settings/categoriesX/x.webp`,
    "settings/categories/cat1/x.webp",
    "not a url",
  ]) {
    assert.equal(isOwnedBlobCategoryImageUrl(url), false, url);
  }
});

test("product image ownership: the shop's own store over https only (item 6)", () => {
  assert.equal(isOwnedBlobProductUrl(`https://${SHOP_HOST}/products/P001/x.webp`), true);
  for (const url of [
    "https://otherstore123.public.blob.vercel-storage.com/products/P001/x.webp",
    `http://${SHOP_HOST}/products/P001/x.webp`,
    `https://${SHOP_HOST}:8443/products/P001/x.webp`,
    `https://user@${SHOP_HOST}/products/P001/x.webp`,
    `https://${SHOP_HOST}.evil.example/products/P001/x.webp`,
    `https://${SHOP_HOST}/${CATEGORY_PATH}`,
  ]) {
    assert.equal(isOwnedBlobProductUrl(url), false, url);
  }
});

test("category images over http or a non-default port are not the shop's store", () => {
  assert.equal(isOwnedBlobCategoryImageUrl(`http://${SHOP_HOST}/${CATEGORY_PATH}`), false);
  assert.equal(isOwnedBlobCategoryImageUrl(`https://${SHOP_HOST}:8443/${CATEGORY_PATH}`), false);
});

test("one source of truth: next.config.ts uses the shared constant and no copy of the host", () => {
  assert.deepEqual(
    nextConfig.images?.remotePatterns?.map((pattern) => ("hostname" in pattern ? pattern.hostname : null)),
    [PUBLIC_BLOB_STORE_HOST],
  );
  const nextConfigSource = readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8");
  assert.ok(!nextConfigSource.includes(SHOP_HOST), "next.config.ts must import PUBLIC_BLOB_STORE_HOST, not repeat it");
  assert.match(nextConfigSource, /import \{ PUBLIC_BLOB_STORE_HOST \} from "\.\/lib\/blob-store-host";/);
  // Every ownership check uses the shared isShopPublicBlobUrl() and holds no Blob host of its own (item 6).
  for (const file of [
    "products-bucket-storage.ts",
    "expense-attachment-storage.ts",
    "wht-attachment-storage.ts",
    "private-file-response.ts",
  ]) {
    const source = readFileSync(path.join(process.cwd(), "lib", file), "utf8");
    assert.ok(!source.includes("blob.vercel-storage.com"), `lib/${file} must not hold a Blob host`);
    assert.match(source, /import \{ isShopPublicBlobUrl \} from "@\/lib\/blob-store-host";/, file);
  }
});
