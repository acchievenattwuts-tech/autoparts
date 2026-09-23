import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// uploadExpenseAttachments must never delete a stored file whose ExpenseAttachment
// row was already saved — that left rows pointing at a 404 file.

let uploaded: string[] = [];
let deleted: string[][] = [];
let createdRows: string[] = [];
let auditMetas: unknown[] = [];
let failCreateOnCall = 0;
let unsupportedFileNames = new Set<string>();

type Actions = typeof import("../attachment-actions");
let actions: Actions;

before(async () => {
  mock.method(console, "error", () => undefined);
  await mock.module("next/cache", { namedExports: { revalidatePath: () => undefined } });
  await mock.module("@/lib/audit-log", {
    namedExports: {
      getAuditActorFromSession: () => ({}),
      getRequestContext: async () => ({}),
      safeWriteAuditLog: async (entry: { meta?: unknown }) => {
        auditMetas.push(entry.meta);
      },
    },
  });
  await mock.module("@/lib/require-auth", {
    namedExports: { requirePermission: async () => ({ user: { id: "user-1" } }) },
  });
  await mock.module("@/lib/expense-attachment-storage", {
    namedExports: {
      prepareExpenseAttachment: async (bytes: Uint8Array) => {
        const name = new TextDecoder().decode(bytes);
        return unsupportedFileNames.has(name)
          ? null
          : { contentType: "image/webp", extension: "webp", body: bytes };
      },
      uploadExpenseAttachmentObject: async ({ prepared }: { prepared: { body: Uint8Array } }) => {
        const url = `https://blob.test/${new TextDecoder().decode(prepared.body)}`;
        uploaded.push(url);
        return url;
      },
      deleteExpenseAttachmentObjects: async (urls: string[]) => {
        deleted.push([...urls]);
      },
    },
  });
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        expense: { findUnique: async () => ({ id: "exp1", expenseNo: "EX26090001", status: "ACTIVE" }) },
        expenseAttachment: {
          count: async () => 0,
          create: async ({ data }: { data: { url: string } }) => {
            if (createdRows.length + 1 === failCreateOnCall) throw new Error("connection reset");
            createdRows.push(data.url);
            return { id: `att-${createdRows.length}` };
          },
        },
      },
    },
  });
  actions = await import("../attachment-actions");
});

const filesForm = (...names: string[]) => {
  const form = new FormData();
  for (const name of names) form.append("files", new File([name], `${name}.jpg`, { type: "image/jpeg" }));
  return form;
};

beforeEach(() => {
  uploaded = [];
  deleted = [];
  createdRows = [];
  auditMetas = [];
  failCreateOnCall = 0;
  unsupportedFileNames = new Set();
});

test("an unsupported file rejects the batch before anything is stored", async () => {
  unsupportedFileNames = new Set(["heic"]);
  const result = await actions.uploadExpenseAttachments("exp1", filesForm("a", "heic"));
  assert.deepEqual(result, { error: 'ไฟล์ "heic.jpg" ไม่ใช่รูปภาพหรือ PDF ที่รองรับ' });
  assert.deepEqual(uploaded, []);
  assert.deepEqual(createdRows, []);
});

test("a failure mid-batch deletes only the unsaved file and keeps saved rows valid", async () => {
  failCreateOnCall = 2;
  const result = await actions.uploadExpenseAttachments("exp1", filesForm("a", "b"));
  assert.deepEqual(result, { error: "อัปโหลดไฟล์แนบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" });
  assert.deepEqual(createdRows, ["https://blob.test/a"]);
  assert.deepEqual(deleted, [["https://blob.test/b"]]);
  assert.deepEqual(auditMetas, [{ attachmentsAdded: ["a.jpg"], partialUpload: true }]);
});

test("a successful batch stores every file and writes one audit entry", async () => {
  const result = await actions.uploadExpenseAttachments("exp1", filesForm("a", "b"));
  assert.deepEqual(result, { success: true, uploaded: 2 });
  assert.deepEqual(createdRows, ["https://blob.test/a", "https://blob.test/b"]);
  assert.deepEqual(deleted, []);
  assert.deepEqual(auditMetas, [{ attachmentsAdded: ["a.jpg", "b.jpg"] }]);
});
