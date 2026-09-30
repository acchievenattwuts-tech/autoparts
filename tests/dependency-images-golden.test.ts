import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Image from "next/image";
import sharp from "sharp";
import golden from "./fixtures/dependency-images.golden.json";

// Captured before the security upgrade on Next 16.3.1 / sharp 0.35.3, except the
// grayscale case added later on sharp 0.35.5 (see its `capturedWith`).
// Expectations are frozen: tests never derive or overwrite them from current output.
// Compare decoded pixels instead of encoded bytes so metadata/compression changes
// do not hide an actual change to image content, dimensions, or transparency.
// Lossless outputs (PNG) must match exactly. Lossy JPEG/WebP codecs may round
// differently per CPU/SIMD path, so they allow a small per-channel drift.
const LOSSY_MAX_CHANNEL_DIFF = 2;
const LOSSY_FORMATS = new Set(["jpeg", "webp"]);

// A lossless 8x6 RGB gradient tagged EXIF orientation 6 (rotate 90 degrees), like a
// phone photo of a payment slip, so rotate() must turn it into 6x8.
const GENERATED_INPUT = { width: 8, height: 6, channels: 3, orientation: 6 } as const;

async function generatedExifRgbPng(): Promise<Buffer> {
  const { width, height, channels, orientation } = GENERATED_INPUT;
  const raw = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels;
      raw[offset] = (x * 32) & 0xff;
      raw[offset + 1] = (y * 48) & 0xff;
      raw[offset + 2] = ((x + y) * 20) & 0xff;
    }
  }
  return sharp(raw, { raw: { width, height, channels } }).png().withMetadata({ orientation }).toBuffer();
}

async function loadInput(input: string): Promise<Buffer> {
  if (input === "generated-exif-rgb") return generatedExifRgbPng();
  return Buffer.from(input === "avif" ? golden.inputs.avif : golden.inputs.png, "base64");
}

for (const fixture of golden.images) {
  test(`dependency golden: Next Image ${fixture.name}`, () => {
    const html = renderToStaticMarkup(createElement(Image, fixture.props));
    assert.equal(html, fixture.html);
  });
}

for (const fixture of golden.transforms) {
  test(`dependency golden: sharp ${fixture.name}`, async (): Promise<void> => {
    try {
      let pipeline = sharp(await loadInput(fixture.input)).rotate();
      // Same order as lib/line-payment-slip-storage.ts and lib/expense-attachment-storage.ts.
      if (fixture.grayscale) pipeline = pipeline.grayscale();
      pipeline = pipeline.resize({
          width: fixture.width,
          height: fixture.height,
          fit: "inside",
          withoutEnlargement: true,
        });

      if (fixture.format === "jpeg") {
        pipeline = pipeline.jpeg({ quality: fixture.quality });
      } else if (fixture.format === "webp") {
        pipeline = pipeline.webp({ quality: fixture.quality });
      } else {
        pipeline = pipeline.png();
      }

      const encoded = await pipeline.toBuffer();
      const { data, info } = await sharp(encoded).raw().toBuffer({ resolveWithObject: true });
      const actual = {
        width: info.width,
        height: info.height,
        channels: info.channels,
        pixels: Array.from(data),
      };
      if (!LOSSY_FORMATS.has(fixture.format)) {
        assert.deepEqual(actual, fixture.expected);
        return;
      }
      const { pixels: expectedPixels, ...expectedShape } = fixture.expected;
      assert.deepEqual(
        { width: actual.width, height: actual.height, channels: actual.channels, length: actual.pixels.length },
        { ...expectedShape, length: expectedPixels.length },
      );
      const maxDiff = actual.pixels.reduce(
        (max, value, index) => Math.max(max, Math.abs(value - expectedPixels[index])),
        0,
      );
      assert.ok(
        maxDiff <= LOSSY_MAX_CHANNEL_DIFF,
        `max per-channel difference ${maxDiff} exceeds ${LOSSY_MAX_CHANNEL_DIFF}`,
      );
    } catch (error) {
      throw new Error(`Image compatibility changed for ${fixture.name}`, { cause: error });
    }
  });
}
