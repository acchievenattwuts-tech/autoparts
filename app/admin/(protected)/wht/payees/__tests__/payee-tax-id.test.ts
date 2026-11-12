import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import { TAX_ID_CHECK_DIGIT_MESSAGE } from "@/lib/tax-id";

// Review round 3 (tax ID check digit): the WHT payee 13-digit id (`taxId13`) must pass the Thai
// check digit when it is new or changed — with the same Thai message as the customer form. The
// stored value saved again unchanged still saves; the format rule, its message and the 10-digit
// `taxId10` handling are unchanged.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

const VALID_CHECK_DIGIT = "1101700207030";
const OTHER_VALID_CHECK_DIGIT = "1234567890121";
const WRONG_CHECK_DIGIT = "1101700207031";
/** A legacy stored value that fails the check digit. */
const STORED_INVALID = "0000000000000";
const FORMAT_MESSAGE = "เลขประจำตัวผู้เสียภาษี/เลขประจำตัวประชาชนต้องเป็นตัวเลข 13 หลัก";
const TAX_ID10_MESSAGE = "เลขประจำตัวผู้เสียภาษีแบบ 10 หลักต้องเป็นตัวเลข 10 หลัก";

type StoredProfile = { id: string; taxId13: string; taxId10: string | null };

let storedProfile: StoredProfile | null = null;
let upserts: Array<{ create: Record<string, unknown>; update: Record<string, unknown> }> = [];
let audits: Array<{ action: string }> = [];
let criticalReports = 0;

before(async () => {
  if (moduleMocksUnavailable) return;
  await mock.module("next/cache", {
    namedExports: { revalidatePath: () => undefined, revalidateTag: () => undefined },
  });
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        supplier: {
          findUnique: async () => ({ id: "sup-1", name: "ร้านอะไหล่ทดสอบ", whtPayeeProfile: storedProfile }),
        },
        whtPayeeProfile: {
          upsert: async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
            upserts.push(args);
            return {};
          },
          findUnique: async () => ({ id: "payee-1", ...(upserts.at(-1)?.update ?? {}) }),
        },
      },
    },
  });
  await mock.module("@/lib/require-auth", {
    namedExports: { requirePermission: async () => ({ user: { id: "admin-1" } }) },
  });
  await mock.module("@/lib/audit-log", {
    namedExports: {
      diffEntity: (beforeValue: unknown, afterValue: unknown) => ({ before: beforeValue, after: afterValue }),
      getAuditActorFromSession: () => ({ userId: "admin-1" }),
      getRequestContext: async () => ({}),
      safeWriteAuditLog: async (entry: { action: string }) => {
        audits.push(entry);
      },
    },
  });
  await mock.module("@/lib/error-reporting", {
    namedExports: {
      reportCriticalError: async () => {
        criticalReports += 1;
      },
    },
  });
});

beforeEach(() => {
  storedProfile = null;
  upserts = [];
  audits = [];
  criticalReports = 0;
});

const payeeForm = (taxId13: string, taxId10 = ""): FormData => {
  const form = new FormData();
  form.set("supplierId", "sup-1");
  form.set("payeeType", "JURISTIC");
  form.set("taxId13", taxId13);
  form.set("taxId10", taxId10);
  form.set("titleName", "บริษัท");
  form.set("firstName", "ร้านอะไหล่ทดสอบ");
  form.set("lastName", "");
  form.set("branchNo", "000000");
  form.set("isActive", "true");
  return form;
};

const stored = (taxId13: string): StoredProfile => ({ id: "payee-1", taxId13, taxId10: null });

test("a new payee id with a wrong check digit is refused in Thai before any write", { skip: moduleMocksUnavailable }, async () => {
  const { saveWhtPayeeProfile } = await import("../actions");
  assert.deepEqual(await saveWhtPayeeProfile(payeeForm(WRONG_CHECK_DIGIT)), { error: TAX_ID_CHECK_DIGIT_MESSAGE });
  assert.deepEqual(upserts, []);
  assert.equal(audits.length, 0);
  assert.equal(criticalReports, 0);
});

test("changing a stored id to one with a wrong check digit is refused", { skip: moduleMocksUnavailable }, async () => {
  const { saveWhtPayeeProfile } = await import("../actions");
  storedProfile = stored(VALID_CHECK_DIGIT);
  assert.deepEqual(await saveWhtPayeeProfile(payeeForm(WRONG_CHECK_DIGIT)), { error: TAX_ID_CHECK_DIGIT_MESSAGE });
  assert.deepEqual(upserts, []);
});

test("the stored id saved again unchanged still saves, even a legacy one that fails the check", { skip: moduleMocksUnavailable }, async () => {
  const { saveWhtPayeeProfile } = await import("../actions");
  storedProfile = stored(STORED_INVALID);
  assert.deepEqual(await saveWhtPayeeProfile(payeeForm(STORED_INVALID)), { success: true });
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].update.taxId13, STORED_INVALID);
  assert.deepEqual(audits.map((entry) => entry.action), ["UPDATE"]);
});

test("a new or changed valid id saves as before", { skip: moduleMocksUnavailable }, async () => {
  const { saveWhtPayeeProfile } = await import("../actions");
  assert.deepEqual(await saveWhtPayeeProfile(payeeForm(VALID_CHECK_DIGIT)), { success: true });
  assert.equal(upserts[0].create.taxId13, VALID_CHECK_DIGIT);
  assert.deepEqual(audits.map((entry) => entry.action), ["CREATE"]);

  upserts = [];
  audits = [];
  storedProfile = stored(STORED_INVALID);
  assert.deepEqual(await saveWhtPayeeProfile(payeeForm(OTHER_VALID_CHECK_DIGIT)), { success: true });
  assert.equal(upserts[0].update.taxId13, OTHER_VALID_CHECK_DIGIT);
  assert.deepEqual(audits.map((entry) => entry.action), ["UPDATE"]);
});

test("the 13-digit format rule and its message are unchanged (empty is still refused)", { skip: moduleMocksUnavailable }, async () => {
  const { saveWhtPayeeProfile } = await import("../actions");
  for (const value of ["", "123", "11017002070301", "๑๑๐๑๗๐๐๒๐๗๐๓๐"]) {
    assert.deepEqual(await saveWhtPayeeProfile(payeeForm(value)), { error: FORMAT_MESSAGE }, value);
  }
  assert.deepEqual(upserts, []);
});

test("taxId10 handling is unchanged", { skip: moduleMocksUnavailable }, async () => {
  const { saveWhtPayeeProfile } = await import("../actions");
  assert.deepEqual(await saveWhtPayeeProfile(payeeForm(VALID_CHECK_DIGIT, "12345")), { error: TAX_ID10_MESSAGE });
  assert.equal(upserts.length, 0);
  // Any 10 digits are accepted as before (no check digit on the 10-digit id).
  assert.deepEqual(await saveWhtPayeeProfile(payeeForm(VALID_CHECK_DIGIT, "1234567899")), { success: true });
  assert.equal(upserts[0].create.taxId10, "1234567899");
  upserts = [];
  assert.deepEqual(await saveWhtPayeeProfile(payeeForm(VALID_CHECK_DIGIT, "  ")), { success: true });
  assert.equal(upserts[0].create.taxId10, null);
});
