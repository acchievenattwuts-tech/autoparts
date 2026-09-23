import assert from "node:assert/strict";
import test, { before, mock } from "node:test";

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type UploadResult = { success?: boolean; uploaded?: number; error?: string };

// Each call records how many files it carried; the handler decides the result.
const calls: number[] = [];
let respond: (callIndex: number) => Promise<UploadResult> = async () => ({ success: true, uploaded: 1 });

before(async () => {
  if (moduleMocksUnavailable) return;
  await mock.module("../attachment-actions", {
    namedExports: {
      uploadExpenseAttachments: async (_expenseId: string, formData: FormData) => {
        calls.push(formData.getAll("files").length);
        return respond(calls.length - 1);
      },
    },
  });
});

const file = (name: string) => new File([new Uint8Array(10)], name, { type: "image/png" });

const load = async () => (await import("../upload-attachments-sequentially")).uploadExpenseAttachmentsSequentially;

test("sends exactly one file per server action call", { skip: moduleMocksUnavailable }, async () => {
  calls.length = 0;
  respond = async () => ({ success: true, uploaded: 1 });
  const upload = await load();

  const result = await upload("exp-1", [file("a.png"), file("b.png"), file("c.png")]);

  assert.deepEqual(calls, [1, 1, 1]);
  assert.deepEqual(result, { uploadedCount: 3, error: null });
});

test("stops at the first server error and reports how many were stored", { skip: moduleMocksUnavailable }, async () => {
  calls.length = 0;
  respond = async (i) => (i === 1 ? { error: "แนบไฟล์ได้สูงสุด 5 ไฟล์ต่อเอกสาร" } : { success: true, uploaded: 1 });
  const upload = await load();

  const result = await upload("exp-1", [file("a.png"), file("b.png"), file("c.png")]);

  assert.equal(calls.length, 2, "the third file is not attempted after a failure");
  assert.deepEqual(result, { uploadedCount: 1, error: "แนบไฟล์ได้สูงสุด 5 ไฟล์ต่อเอกสาร" });
});

test("a thrown request (e.g. body too large) becomes a Thai message instead of crashing", { skip: moduleMocksUnavailable }, async () => {
  calls.length = 0;
  respond = async () => {
    throw new Error("Body exceeded 3mb limit");
  };
  const upload = await load();

  const result = await upload("exp-1", [file("a.png")]);

  assert.deepEqual(result, { uploadedCount: 0, error: "อัปโหลดไฟล์แนบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" });
});

test("no files means no calls", { skip: moduleMocksUnavailable }, async () => {
  calls.length = 0;
  const upload = await load();
  assert.deepEqual(await upload("exp-1", []), { uploadedCount: 0, error: null });
  assert.equal(calls.length, 0);
});
