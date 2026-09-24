import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { before, beforeEach, mock } from "node:test";
import { pathToFileURL } from "node:url";

// Expense attachments, delivery-proof images and WHT certificate attachments are
// PII: new uploads must land
// in the PRIVATE Blob store (access "private" + BLOB_SLIPS_READ_WRITE_TOKEN), the
// DB must receive the object pathname, and a missing token must fail rather than
// silently fall back to the public store. Deletion must hit the store the value
// lives in. No real Blob calls — @vercel/blob is mocked.

type PutCall = { pathname: string; options: Record<string, unknown> };
type DelCall = { target: string | string[]; options: Record<string, unknown> | undefined };

let putCalls: PutCall[] = [];
let delCalls: DelCall[] = [];

type ExpenseStorage = typeof import("@/lib/expense-attachment-storage");
type DeliveryStorage = typeof import("@/lib/delivery-proof-storage");
type WhtStorage = typeof import("@/lib/wht-attachment-storage");
let expenseStorage: ExpenseStorage;
let deliveryStorage: DeliveryStorage;
let whtStorage: WhtStorage;

const PRIVATE_TOKEN = "vercel_blob_rw_private_test";
const LEGACY_EXPENSE_URL = "https://abc.public.blob.vercel-storage.com/expense-attachments/exp1/1-a.webp";

before(async () => {
  mock.method(console, "error", () => undefined);
  // App modules load @vercel/blob through its CommonJS entry, so mock that file
  // (the bare specifier alone resolves to the ESM entry and would not intercept).
  const blobCjsUrl = pathToFileURL(createRequire(__filename).resolve("@vercel/blob")).href;
  await mock.module(blobCjsUrl, {
    namedExports: {
      put: async (pathname: string, _body: unknown, options: Record<string, unknown>) => {
        putCalls.push({ pathname, options });
        return { pathname, url: `https://store.private.blob.vercel-storage.com/${pathname}` };
      },
      del: async (target: string | string[], options?: Record<string, unknown>) => {
        delCalls.push({ target, options });
      },
      get: async () => null,
    },
  });
  expenseStorage = await import("@/lib/expense-attachment-storage");
  deliveryStorage = await import("@/lib/delivery-proof-storage");
  whtStorage = await import("@/lib/wht-attachment-storage");
});

beforeEach(() => {
  putCalls = [];
  delCalls = [];
  process.env.BLOB_SLIPS_READ_WRITE_TOKEN = PRIVATE_TOKEN;
});

const prepared = { body: new Uint8Array([1, 2, 3]), contentType: "image/webp", extension: "webp" };

test("a new expense attachment is put privately with the private token and stores the pathname", async () => {
  const stored = await expenseStorage.uploadExpenseAttachmentObject({ expenseId: "exp1", prepared });

  assert.equal(putCalls.length, 1);
  const call = putCalls[0]!;
  assert.equal(call.options.access, "private");
  assert.equal(call.options.token, PRIVATE_TOKEN);
  assert.equal(call.options.contentType, "image/webp");
  assert.match(call.pathname, /^expense-attachments\/exp1\/\d+-[0-9a-f-]+\.webp$/);
  assert.equal(stored, call.pathname);
  assert.equal(stored.startsWith("https://"), false);
});

test("a new delivery-proof image is put privately with the private token and stores the pathname", async () => {
  const stored = await deliveryStorage.uploadDeliveryProofObject({
    objectPath: "delivery-proofs/sale1/1-signature-u.png",
    body: new Uint8Array([1]),
    contentType: "image/png",
  });

  assert.equal(putCalls.length, 1);
  assert.equal(putCalls[0]!.options.access, "private");
  assert.equal(putCalls[0]!.options.token, PRIVATE_TOKEN);
  assert.equal(stored, "delivery-proofs/sale1/1-signature-u.png");
});

test("without the private token uploads throw and nothing reaches the public store", async () => {
  delete process.env.BLOB_SLIPS_READ_WRITE_TOKEN;

  await assert.rejects(expenseStorage.uploadExpenseAttachmentObject({ expenseId: "exp1", prepared }));
  await assert.rejects(
    deliveryStorage.uploadDeliveryProofObject({
      objectPath: "delivery-proofs/sale1/1-photo-u.jpg",
      body: new Uint8Array([1]),
      contentType: "image/jpeg",
    }),
  );
  assert.deepEqual(putCalls, []);
});

test("expense attachment deletion routes each value to the store it lives in", async () => {
  await expenseStorage.deleteExpenseAttachmentObjects([
    "expense-attachments/exp1/2-b.webp",
    LEGACY_EXPENSE_URL,
    "2026/09/24/slip1.webp", // a payment slip path — never deletable through here
    "https://evil.example.com/expense-attachments/x.webp", // not our Blob host
  ]);

  assert.deepEqual(delCalls, [
    { target: ["expense-attachments/exp1/2-b.webp"], options: { token: PRIVATE_TOKEN } },
    { target: [LEGACY_EXPENSE_URL], options: undefined },
  ]);
});

test("delivery-proof cleanup deletes private objects only and leaves legacy URLs alone", async () => {
  await deliveryStorage.deleteDeliveryProofObjects([
    "delivery-proofs/sale1/1-photo-u.jpg",
    "https://abc.public.blob.vercel-storage.com/delivery-proofs/sale1/0-photo-u.jpg",
    "expense-attachments/exp1/a.webp",
  ]);

  assert.deepEqual(delCalls, [
    { target: ["delivery-proofs/sale1/1-photo-u.jpg"], options: { token: PRIVATE_TOKEN } },
  ]);
});

// WHT certificate (50 ทวิ) attachments carry tax IDs — same private-store contract.
const LEGACY_WHT_URL = "https://abc.public.blob.vercel-storage.com/wht-attachments/wht1/1-a.webp";

test("a new WHT attachment is put privately with the private token and stores the pathname", async () => {
  const stored = await whtStorage.uploadWhtAttachmentObject({ whtReceivedId: "wht1", prepared });

  assert.equal(putCalls.length, 1);
  const call = putCalls[0]!;
  assert.equal(call.options.access, "private");
  assert.equal(call.options.token, PRIVATE_TOKEN);
  assert.equal(call.options.contentType, "image/webp");
  assert.match(call.pathname, /^wht-attachments\/wht1\/\d+-[0-9a-f-]+\.webp$/);
  assert.equal(stored, call.pathname);
  assert.equal(stored.startsWith("https://"), false);
});

test("without the private token a WHT upload throws and nothing reaches the public store", async () => {
  delete process.env.BLOB_SLIPS_READ_WRITE_TOKEN;

  await assert.rejects(whtStorage.uploadWhtAttachmentObject({ whtReceivedId: "wht1", prepared }));
  assert.deepEqual(putCalls, []);
});

test("WHT attachment deletion routes each value to its store and never leaves its root", async () => {
  await whtStorage.deleteWhtAttachmentObjects([
    "wht-attachments/wht1/2-b.pdf",
    LEGACY_WHT_URL,
    "wht-attachments/../2026/09/24/slip1.webp", // climbs out of the root
    "expense-attachments/exp1/a.webp", // another module's private object
    "2026/09/24/slip1.webp", // a payment slip path
    "https://abc.public.blob.vercel-storage.com/products/p1/a.webp", // another public root
    "https://evil.example.com/wht-attachments/x.webp", // not our Blob host
  ]);

  assert.deepEqual(delCalls, [
    { target: ["wht-attachments/wht1/2-b.pdf"], options: { token: PRIVATE_TOKEN } },
    { target: [LEGACY_WHT_URL], options: undefined },
  ]);
});
