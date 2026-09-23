import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MultiSelectFilter from "../MultiSelectFilter";

const OPTIONS = [
  { id: "a", label: "คอมแอร์" },
  { id: "b", label: "หม้อน้ำ" },
];

const render = (props: Partial<Parameters<typeof MultiSelectFilter>[0]> = {}): string =>
  renderToStaticMarkup(
    createElement(MultiSelectFilter, {
      options: OPTIONS,
      values: [],
      onChange: () => undefined,
      ...props,
    }),
  );

test("the combobox trigger is keyboard-focusable and announces its popup", () => {
  const html = render();
  assert.match(html, /role="combobox"/);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /aria-expanded="false"/);
});

test("a disabled trigger is taken out of the tab order", () => {
  const html = render({ disabled: true });
  assert.match(html, /tabindex="-1"/);
  assert.match(html, /aria-disabled="true"/);
});

test("a visible label can name the combobox via aria-labelledby", () => {
  const html = render({ ariaLabelledBy: "category-label", id: "category-filter" });
  assert.match(html, /aria-labelledby="category-label"/);
  assert.match(html, /id="category-filter"/);
});

test("the clear action is a real button with an accessible name", () => {
  const html = render({ values: ["a"] });
  assert.match(html, /<button type="button" aria-label="ล้างรายการที่เลือก"/);
});
