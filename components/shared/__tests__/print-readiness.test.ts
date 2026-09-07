import assert from "node:assert/strict";
import { test } from "node:test";
import { waitForPrintDocument } from "../print-assets";

test("printing waits for streamed content and hydration, ignoring about:blank", async () => {
  const originalNode = globalThis.Node;
  const originalDocument = globalThis.document;
  Object.assign(globalThis, { Node: { DOCUMENT_NODE: 9 }, document: { baseURI: "https://example.test" } });
  let ready = false;
  let assetReads = 0;
  const doc = { URL: "about:blank", nodeType: 9, querySelectorAll: (selector: string) => {
    if (selector === "img") { assetReads++; return []; }
    return doc.URL === "about:blank" ? [] : [{ getAttribute: () => ready ? "true" : null }];
  } };
  const frame = { isConnected: true, contentDocument: doc } as unknown as HTMLIFrameElement;
  try {
    const result = waitForPrintDocument(frame, "/admin/sales/s1", 2000);
    await new Promise((resolve) => setTimeout(resolve, 110));
    assert.equal(assetReads, 0);
    doc.URL = "https://example.test/admin/sales/s1";
    await new Promise((resolve) => setTimeout(resolve, 110));
    assert.equal(assetReads, 0);
    ready = true;
    await result;
    assert.equal(assetReads, 1);
  } finally { Object.assign(globalThis, { Node: originalNode, document: originalDocument }); }
});
test("print readiness refuses login redirects and timed-out empty pages", async () => {
  const originalDocument = globalThis.document;
  Object.assign(globalThis, { document: { baseURI: "https://example.test" } });
  try {
    const frame = { isConnected: true, contentDocument: { URL: "https://example.test/login", querySelectorAll: () => [] } } as unknown as HTMLIFrameElement;
    await assert.rejects(waitForPrintDocument(frame, "/admin/sales/s1", 100), /สิทธิ์/);
    Object.assign(frame.contentDocument!, { URL: "https://example.test/admin/sales/s1" });
    await assert.rejects(waitForPrintDocument(frame, "/admin/sales/s1", 10), /โหลดเอกสารไม่สำเร็จ/);
  } finally { Object.assign(globalThis, { document: originalDocument }); }
});
