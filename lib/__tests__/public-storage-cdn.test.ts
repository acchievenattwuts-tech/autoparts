import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSupabasePublicStorageUrl,
  resolvePublicStorageCdnTarget,
  toPublicStorageCdnPath,
} from "@/lib/product-image-url";

const SUPABASE_URL = "https://project.supabase.co";

test("converts public products bucket assets to same-origin CDN paths", () => {
  assert.equal(
    toPublicStorageCdnPath(`${SUPABASE_URL}/storage/v1/object/public/products/settings/logo.png`),
    "/img/settings/logo.png",
  );
  assert.equal(
    toPublicStorageCdnPath(`${SUPABASE_URL}/storage/v1/object/public/products/users/signatures/sig.webp`),
    "/img/users/signatures/sig.webp",
  );
  assert.equal(
    toPublicStorageCdnPath(`${SUPABASE_URL}/storage/v1/object/public/products/delivery-proofs/sale-1/photo.jpg`),
    "/img/delivery-proofs/sale-1/photo.jpg",
  );
});

test("converts public line-chat bucket assets with an explicit route namespace", () => {
  assert.equal(
    toPublicStorageCdnPath(`${SUPABASE_URL}/storage/v1/object/public/line-chat/2026/06/12/a.jpg`),
    "/img/line-chat/2026/06/12/a.jpg",
  );
});

test("does not convert private payment slip paths or unrelated external URLs", () => {
  assert.equal(
    toPublicStorageCdnPath(`${SUPABASE_URL}/storage/v1/object/public/payment-slips/2026/06/12/slip.webp`),
    `${SUPABASE_URL}/storage/v1/object/public/payment-slips/2026/06/12/slip.webp`,
  );
  assert.equal(toPublicStorageCdnPath("https://cdn.example.com/a.jpg"), "https://cdn.example.com/a.jpg");
});

test("resolves only allowlisted public storage CDN route paths", () => {
  assert.deepEqual(resolvePublicStorageCdnTarget("settings/logo.png"), {
    bucket: "products",
    objectPath: "settings/logo.png",
  });
  assert.deepEqual(resolvePublicStorageCdnTarget("line-chat/2026/06/12/a.jpg"), {
    bucket: "line-chat",
    objectPath: "2026/06/12/a.jpg",
  });
  assert.equal(resolvePublicStorageCdnTarget("payment-slips/2026/06/12/slip.webp"), null);
  assert.equal(resolvePublicStorageCdnTarget("../settings/logo.png"), null);
});

test("builds Supabase public storage URLs for the resolved target bucket", () => {
  assert.equal(
    buildSupabasePublicStorageUrl(SUPABASE_URL, {
      bucket: "line-chat",
      objectPath: "2026/06/12/a b.jpg",
    }),
    `${SUPABASE_URL}/storage/v1/object/public/line-chat/2026/06/12/a%20b.jpg`,
  );
});
