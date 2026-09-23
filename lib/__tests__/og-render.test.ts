import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import { createElement } from "react";

// lib/og-render.tsx wraps next/og's ImageResponse. The real rasterizer (satori +
// resvg wasm) is not what is under test here — the degradation ladder is — so a
// fake ImageResponse records each call and fails on demand.

type RenderCall = { hasFonts: boolean; fontNames: string[] };
const calls: RenderCall[] = [];
let failWhen: (call: RenderCall) => boolean = () => false;

before(async () => {
  await mock.module("next/og", {
    namedExports: {
      ImageResponse: class FakeImageResponse extends Response {
        constructor(
          _element: unknown,
          options: { fonts?: Array<{ name: string }> } & Record<string, unknown>,
        ) {
          const call: RenderCall = {
            hasFonts: Array.isArray(options.fonts),
            fontNames: (options.fonts ?? []).map((font) => font.name),
          };
          calls.push(call);
          const shouldFail = failWhen(call);
          // Mirrors the real behaviour: the render only runs (and throws) when the
          // body is consumed, which is why the helper drains it eagerly.
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              if (shouldFail) controller.error(new Error("svgload_buffer: SVG rendering failed"));
              else {
                controller.enqueue(new Uint8Array([137, 80, 78, 71]));
                controller.close();
              }
            },
          });
          super(body, { headers: { "content-type": "image/png" } });
        }
      },
    },
  });
});

beforeEach(() => {
  calls.length = 0;
  failWhen = () => false;
  mock.method(console, "error", () => undefined);
});

const element = createElement("div", null, "อะไหล่แอร์");

test("renderOgCard renders with the bundled Kanit/Sarabun fonts when they load", async () => {
  const { renderOgCard } = await import("@/lib/og-render");
  const response = await renderOgCard(element, "test");

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].fontNames, ["Kanit", "Sarabun"]);
});

test("renderOgCard falls back to the previous font-less render when the font render fails", async () => {
  const { renderOgCard } = await import("@/lib/og-render");
  failWhen = (call) => call.hasFonts;

  const response = await renderOgCard(element, "test");

  assert.equal(response.status, 200);
  assert.deepEqual(
    calls.map((call) => call.hasFonts),
    [true, false],
    "second attempt must be the old bare ImageResponse(element, size) call",
  );
});

test("renderOgCard contains a total rasterizer failure as a fallback card, then a 204 — never a throw", async () => {
  const { renderOgCard } = await import("@/lib/og-render");
  failWhen = () => true;

  const response = await renderOgCard(element, "test");

  assert.equal(response.status, 204);
  // fonts → no fonts → fallback card (with fonts, since they loaded)
  assert.deepEqual(
    calls.map((call) => call.hasFonts),
    [true, false, true],
  );
});

test("stripOgEmoji removes emoji sequences and keeps Thai text intact", async () => {
  const { stripOgEmoji } = await import("@/lib/og-render");
  assert.equal(stripOgEmoji("🚗 คอมแอร์  ✅ Vigo ⚠️"), "คอมแอร์ Vigo");
  assert.equal(stripOgEmoji("น้ำยาล้างคอยล์เย็น"), "น้ำยาล้างคอยล์เย็น");
});
