import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Image from "next/image";
import sharp from "sharp";
import golden from "./fixtures/dependency-images.golden.json";

// Captured before the security upgrade on Next 16.3.1 / sharp 0.35.3.
// Expectations are frozen: tests never derive or overwrite them from current output.
// Compare decoded pixels instead of encoded bytes so metadata/compression changes
// do not hide an actual change to image content, dimensions, or transparency.
for (const fixture of golden.images) {
  test(`dependency golden: Next Image ${fixture.name}`, () => {
    const html = renderToStaticMarkup(createElement(Image, fixture.props));
    assert.equal(html, fixture.html);
  });
}

for (const fixture of golden.transforms) {
  test(`dependency golden: sharp ${fixture.name}`, async (): Promise<void> => {
    try {
      const input = fixture.input === "avif" ? golden.inputs.avif : golden.inputs.png;
      let pipeline = sharp(Buffer.from(input, "base64"))
        .rotate()
        .resize({
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
      assert.deepEqual({
        width: info.width,
        height: info.height,
        channels: info.channels,
        pixels: Array.from(data),
      }, fixture.expected);
    } catch (error) {
      throw new Error(`Image compatibility changed for ${fixture.name}`, { cause: error });
    }
  });
}
