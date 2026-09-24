import assert from "node:assert/strict";
import test from "node:test";

import {
  isLegacyPublicFileUrl,
  isPrivateObjectPathUnderRoot,
  resolveDeliveryProofImageSource,
  resolveExpenseAttachmentViewSource,
} from "@/lib/private-file-ref";

// Expense attachments and delivery proofs (PII) moved to the private Blob store.
// The same DB columns now hold either a legacy public URL (old rows, rendered
// unchanged) or a private pathname (new rows, viewed through an auth route).

const LEGACY_URL = "https://abc.public.blob.vercel-storage.com/expense-attachments/exp1/1-a.webp";

test("a full http(s) URL is legacy; a pathname is not", () => {
  assert.equal(isLegacyPublicFileUrl(LEGACY_URL), true);
  assert.equal(isLegacyPublicFileUrl("HTTPS://x.test/a.png"), true);
  assert.equal(isLegacyPublicFileUrl("http://x.test/a.png"), true);
  assert.equal(isLegacyPublicFileUrl("expense-attachments/exp1/1-a.webp"), false);
  assert.equal(isLegacyPublicFileUrl("delivery-proofs/s1/1-photo-u.jpg"), false);
});

test("a private pathname must sit under its own root and never climb out", () => {
  assert.equal(isPrivateObjectPathUnderRoot("expense-attachments/exp1/a.webp", "expense-attachments"), true);
  assert.equal(isPrivateObjectPathUnderRoot("delivery-proofs/s1/a.jpg", "expense-attachments"), false);
  // Payment slips share the private store under YYYY/MM/DD — never reachable here.
  assert.equal(isPrivateObjectPathUnderRoot("2026/09/24/slip1.webp", "expense-attachments"), false);
  assert.equal(isPrivateObjectPathUnderRoot("expense-attachments/../2026/09/24/slip1.webp", "expense-attachments"), false);
  assert.equal(isPrivateObjectPathUnderRoot("expense-attachments", "expense-attachments"), false);
  assert.equal(isPrivateObjectPathUnderRoot(LEGACY_URL, "expense-attachments"), false);
});

test("expense attachments: legacy URL renders as-is, private goes through the auth route", () => {
  assert.deepEqual(resolveExpenseAttachmentViewSource({ id: "att1", url: LEGACY_URL }), {
    src: LEGACY_URL,
    isPrivate: false,
  });
  assert.deepEqual(
    resolveExpenseAttachmentViewSource({ id: "att1", url: "expense-attachments/exp1/1-a.webp" }),
    { src: "/api/admin/expense-attachments/att1", isPrivate: true },
  );
});

test("delivery proofs: missing -> null, legacy unchanged, private -> kind route", () => {
  assert.equal(resolveDeliveryProofImageSource("p1", "signature", null), null);
  assert.equal(resolveDeliveryProofImageSource("p1", "photo", ""), null);

  const legacy = "https://abc.public.blob.vercel-storage.com/delivery-proofs/s1/1-photo-u.jpg";
  assert.deepEqual(resolveDeliveryProofImageSource("p1", "photo", legacy), { src: legacy, isPrivate: false });

  assert.deepEqual(resolveDeliveryProofImageSource("p1", "signature", "delivery-proofs/s1/1-signature-u.png"), {
    src: "/api/admin/delivery-proofs/p1/signature",
    isPrivate: true,
  });
  assert.deepEqual(resolveDeliveryProofImageSource("p1", "photo", "delivery-proofs/s1/1-photo-u.jpg"), {
    src: "/api/admin/delivery-proofs/p1/photo",
    isPrivate: true,
  });
});
