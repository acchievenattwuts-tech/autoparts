import assert from "node:assert/strict";
import test from "node:test";
import {
  getProductImageProxyContentType,
  withProductImageProxyTimeout,
} from "@/lib/product-image-proxy";

test("uses the upstream image content type when present", () => {
  const headers = new Headers({ "content-type": "image/webp" });

  assert.equal(getProductImageProxyContentType("products/P0475/a.jpg", headers), "image/webp");
});

test("falls back to the file extension when upstream has no content type", () => {
  const headers = new Headers();

  assert.equal(
    getProductImageProxyContentType("products/P0475/1780732172593-149d100d.jpg", headers),
    "image/jpeg",
  );
});

test("times out a hanging upstream image request", async () => {
  await assert.rejects(
    withProductImageProxyTimeout(
      new Promise<Response>(() => {
        // Simulate a fetch that never resolves.
      }),
      1,
    ),
    /timed out/,
  );
});
