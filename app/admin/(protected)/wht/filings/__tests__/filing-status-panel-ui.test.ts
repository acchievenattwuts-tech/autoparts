import assert from "node:assert/strict";
import test, { before, mock } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// M5 (UI): a filing marked FILED shows no "ยกเลิกรอบยื่นนี้" control (the server already refuses the
// cancel with a Thai message). A DRAFT filing keeps the record-filed form and the cancel control
// exactly as before; a CANCELLED filing or a viewer without manage rights still sees no panel.

Object.assign(globalThis, { React });

const CANCEL_LABEL = "ยกเลิกรอบยื่นนี้";
const FILED_LABEL = "บันทึกว่ายื่นแบบแล้ว";
const RECORD_FILED_LABEL = "ยืนยันว่ายื่นแบบแล้ว";

type PanelProps = { filingId: string; status: "DRAFT" | "FILED" | "CANCELLED"; canManage: boolean };
let FilingStatusPanel: (props: PanelProps) => React.ReactElement | null;

before(async () => {
  // The panel only calls these on click; rendering must not load the real Server Actions.
  mock.module("../actions", {
    namedExports: {
      cancelFiling: async () => ({ success: true }),
      markFilingFiled: async () => ({ success: true }),
    },
  });
  ({ default: FilingStatusPanel } = await import("../[id]/FilingStatusPanel"));
});

const render = (status: PanelProps["status"], canManage = true): string =>
  renderToStaticMarkup(React.createElement(FilingStatusPanel, { filingId: "filing-1", status, canManage }));

test("a FILED filing shows the filed notice without the cancel control", () => {
  const html = render("FILED");
  assert.ok(html.includes(FILED_LABEL));
  assert.ok(!html.includes(CANCEL_LABEL));
  assert.ok(!html.includes(RECORD_FILED_LABEL));
});

test("a DRAFT filing still shows the record-filed form and the cancel control (light + dark)", () => {
  const html = render("DRAFT");
  assert.ok(html.includes(RECORD_FILED_LABEL));
  assert.ok(html.includes(CANCEL_LABEL));
  assert.match(html, /border-t border-slate-100 pt-3 dark:border-white\/5/);
  assert.match(html, /text-red-600[^"]*dark:text-red-400/);
});

test("CANCELLED or no manage permission still renders nothing", () => {
  assert.equal(render("CANCELLED"), "");
  assert.equal(render("DRAFT", false), "");
  assert.equal(render("FILED", false), "");
});
