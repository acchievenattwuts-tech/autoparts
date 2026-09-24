import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { before, beforeEach, mock } from "node:test";
import { pathToFileURL } from "node:url";

// Session-checked view routes for PII evidence files. Without permission they
// answer 401/403; unknown ids 404; private pathnames stream from the private
// store with a browser-only cache; legacy public URLs redirect unchanged.
// No real DB or Blob — both are mocked.

type AuthMode = "ok" | "unauthorized" | "forbidden";
let authMode: AuthMode = "ok";
let requestedPermissions: string[][] = [];
let expenseRows: Record<string, { url: string; fileName: string }> = {};
let proofRows: Record<string, { signatureImageUrl: string | null; deliveryPhotoUrl: string | null }> = {};
let whtRows: Record<string, { url: string; fileName: string }> = {};
let blobGets: Array<{ pathname: string; options: Record<string, unknown> }> = [];

const PRIVATE_TOKEN = "vercel_blob_rw_private_test";
const EXPENSE_LEGACY_URL = "https://abc.public.blob.vercel-storage.com/expense-attachments/exp1/1-a.webp";
const WHT_LEGACY_URL = "https://abc.public.blob.vercel-storage.com/wht-attachments/wht1/1-a.webp";

const checkAuth = (permissions: string[]) => {
  requestedPermissions.push(permissions);
  if (authMode === "unauthorized") throw new Error("UNAUTHORIZED");
  if (authMode === "forbidden") throw new Error("FORBIDDEN");
  return { user: { id: "user-1" } };
};

type RouteModule = {
  GET: (request: never, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
};
let expenseRoute: RouteModule;
let proofRoute: RouteModule;
let whtRoute: RouteModule;

before(async () => {
  mock.method(console, "error", () => undefined);
  await mock.module("@/lib/require-auth", {
    namedExports: {
      requirePermission: async (permission: string) => checkAuth([permission]),
      requireAnyPermission: async (permissions: string[]) => checkAuth(permissions),
    },
  });
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        expenseAttachment: {
          findUnique: async ({ where }: { where: { id: string } }) => expenseRows[where.id] ?? null,
        },
        deliveryProof: {
          findUnique: async ({ where }: { where: { id: string } }) => proofRows[where.id] ?? null,
        },
        whtReceivedAttachment: {
          findUnique: async ({ where }: { where: { id: string } }) => whtRows[where.id] ?? null,
        },
      },
    },
  });
  // App modules load @vercel/blob through its CommonJS entry, so mock that file
  // (the bare specifier alone resolves to the ESM entry and would not intercept).
  const blobCjsUrl = pathToFileURL(createRequire(__filename).resolve("@vercel/blob")).href;
  await mock.module(blobCjsUrl, {
    namedExports: {
      get: async (pathname: string, options: Record<string, unknown>) => {
        blobGets.push({ pathname, options });
        if (pathname.endsWith("missing.webp")) return null;
        return {
          statusCode: 200,
          stream: new Blob([`bytes:${pathname}`]).stream(),
          headers: new Headers({ "content-type": pathname.endsWith(".pdf") ? "application/pdf" : "image/webp" }),
        };
      },
      put: async () => {
        throw new Error("put must not be called");
      },
      del: async () => undefined,
    },
  });
  expenseRoute = (await import("../expense-attachments/[id]/route")) as unknown as RouteModule;
  proofRoute = (await import("../delivery-proofs/[id]/[kind]/route")) as unknown as RouteModule;
  whtRoute = (await import("../wht-attachments/[id]/route")) as unknown as RouteModule;
});

beforeEach(() => {
  authMode = "ok";
  requestedPermissions = [];
  blobGets = [];
  process.env.BLOB_SLIPS_READ_WRITE_TOKEN = PRIVATE_TOKEN;
  expenseRows = {
    attprivate: { url: "expense-attachments/exp1/2-b.webp", fileName: "สลิป (1).webp" },
    attpdf: { url: "expense-attachments/exp1/3-c.pdf", fileName: "receipt.pdf" },
    attlegacy: { url: EXPENSE_LEGACY_URL, fileName: "old.webp" },
    attmissing: { url: "expense-attachments/exp1/missing.webp", fileName: "gone.webp" },
    attforeign: { url: "2026/09/24/slip1.webp", fileName: "slip.webp" },
  };
  proofRows = {
    proofprivate: {
      signatureImageUrl: "delivery-proofs/sale1/1-signature-u.png",
      deliveryPhotoUrl: "delivery-proofs/sale1/1-photo-u.jpg",
    },
    prooflegacy: {
      signatureImageUrl: null,
      deliveryPhotoUrl: "https://abc.public.blob.vercel-storage.com/delivery-proofs/sale1/0-photo-u.jpg",
    },
  };
  whtRows = {
    whtprivate: { url: "wht-attachments/wht1/2-b.pdf", fileName: "50ทวิ.pdf" },
    whtlegacy: { url: WHT_LEGACY_URL, fileName: "old.webp" },
    whtmissing: { url: "wht-attachments/wht1/missing.webp", fileName: "gone.webp" },
    whtforeign: { url: "expense-attachments/exp1/2-b.webp", fileName: "other.webp" },
  };
});

const callExpense = (id: string) => expenseRoute.GET({} as never, { params: Promise.resolve({ id }) });
const callProof = (id: string, kind: string) =>
  proofRoute.GET({} as never, { params: Promise.resolve({ id, kind }) });

test("expense attachment route: 401 without a session, 403 without expenses.view", async () => {
  authMode = "unauthorized";
  assert.equal((await callExpense("attprivate")).status, 401);
  authMode = "forbidden";
  assert.equal((await callExpense("attprivate")).status, 403);
  assert.deepEqual(requestedPermissions, [["expenses.view"], ["expenses.view"]]);
  assert.deepEqual(blobGets, []);
});

test("expense attachment route: 404 for unknown, malformed or out-of-root values", async () => {
  assert.equal((await callExpense("nosuchid")).status, 404);
  assert.equal((await callExpense("../etc")).status, 404);
  assert.equal((await callExpense("attmissing")).status, 404);
  assert.equal((await callExpense("attforeign")).status, 404);
  assert.deepEqual(blobGets.map((g) => g.pathname), ["expense-attachments/exp1/missing.webp"]);
});

test("expense attachment route: streams a private file with a private, short cache", async () => {
  const response = await callExpense("attprivate");
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "bytes:expense-attachments/exp1/2-b.webp");
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.equal(response.headers.get("cache-control"), "private, max-age=300");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(
    response.headers.get("content-disposition"),
    "inline; filename*=UTF-8''%E0%B8%AA%E0%B8%A5%E0%B8%B4%E0%B8%9B%20%281%29.webp",
  );
  assert.deepEqual(blobGets, [
    { pathname: "expense-attachments/exp1/2-b.webp", options: { access: "private", token: PRIVATE_TOKEN } },
  ]);

  const pdf = await callExpense("attpdf");
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
});

test("expense attachment route: a legacy public URL redirects to itself", async () => {
  const response = await callExpense("attlegacy");
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), EXPENSE_LEGACY_URL);
  assert.deepEqual(blobGets, []);
});

test("delivery proof route: 401/403 gate on sales.view or delivery.view", async () => {
  authMode = "unauthorized";
  assert.equal((await callProof("proofprivate", "photo")).status, 401);
  authMode = "forbidden";
  assert.equal((await callProof("proofprivate", "photo")).status, 403);
  assert.deepEqual(requestedPermissions, [
    ["sales.view", "delivery.view"],
    ["sales.view", "delivery.view"],
  ]);
  assert.deepEqual(blobGets, []);
});

test("delivery proof route: 404 for unknown id, bad kind, or a kind the proof lacks", async () => {
  assert.equal((await callProof("nosuchid", "photo")).status, 404);
  assert.equal((await callProof("proofprivate", "selfie")).status, 404);
  assert.equal((await callProof("prooflegacy", "signature")).status, 404);
  assert.deepEqual(blobGets, []);
});

test("delivery proof route: streams each private kind", async () => {
  const signature = await callProof("proofprivate", "signature");
  assert.equal(signature.status, 200);
  assert.equal(await signature.text(), "bytes:delivery-proofs/sale1/1-signature-u.png");
  assert.equal(signature.headers.get("cache-control"), "private, max-age=300");

  const photo = await callProof("proofprivate", "photo");
  assert.equal(await photo.text(), "bytes:delivery-proofs/sale1/1-photo-u.jpg");
});

test("delivery proof route: a legacy public URL redirects to itself", async () => {
  const response = await callProof("prooflegacy", "photo");
  assert.equal(response.status, 302);
  assert.equal(
    response.headers.get("location"),
    "https://abc.public.blob.vercel-storage.com/delivery-proofs/sale1/0-photo-u.jpg",
  );
});

const callWht = (id: string) => whtRoute.GET({} as never, { params: Promise.resolve({ id }) });

test("WHT attachment route: 401 without a session, 403 without wht.view", async () => {
  authMode = "unauthorized";
  assert.equal((await callWht("whtprivate")).status, 401);
  authMode = "forbidden";
  assert.equal((await callWht("whtprivate")).status, 403);
  assert.deepEqual(requestedPermissions, [["wht.view"], ["wht.view"]]);
  assert.deepEqual(blobGets, []);
});

test("WHT attachment route: 404 for unknown, malformed or out-of-root values", async () => {
  assert.equal((await callWht("nosuchid")).status, 404);
  assert.equal((await callWht("../etc")).status, 404);
  assert.equal((await callWht("whtmissing")).status, 404);
  assert.equal((await callWht("whtforeign")).status, 404);
  assert.deepEqual(blobGets.map((g) => g.pathname), ["wht-attachments/wht1/missing.webp"]);
});

test("WHT attachment route: streams a private file with a private, short cache", async () => {
  const response = await callWht("whtprivate");
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "bytes:wht-attachments/wht1/2-b.pdf");
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(response.headers.get("cache-control"), "private, max-age=300");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(
    response.headers.get("content-disposition"),
    "inline; filename*=UTF-8''50%E0%B8%97%E0%B8%A7%E0%B8%B4.pdf",
  );
  assert.deepEqual(blobGets, [
    { pathname: "wht-attachments/wht1/2-b.pdf", options: { access: "private", token: PRIVATE_TOKEN } },
  ]);
});

test("WHT attachment route: a legacy public URL redirects to itself", async () => {
  const response = await callWht("whtlegacy");
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), WHT_LEGACY_URL);
  assert.deepEqual(blobGets, []);
});
