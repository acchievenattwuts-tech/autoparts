import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import { TAX_ID_CHECK_DIGIT_MESSAGE } from "@/lib/tax-id";

// Review round 3 (tax ID check digit): the company tax payer id (`tax_payer_id`) must pass the Thai
// 13-digit check digit when it is new or changed — with the same Thai message as the customer form.
// The stored value saved again unchanged still saves, an empty value is still allowed, and the
// existing 13-digit format message is unchanged.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

const TAX_PAYER_ID_KEY = "tax_payer_id";
const VALID_CHECK_DIGIT = "1101700207030";
const OTHER_VALID_CHECK_DIGIT = "1234567890121";
const WRONG_CHECK_DIGIT = "1101700207031";
/** A legacy stored value that fails the check digit. */
const STORED_INVALID = "0000000000000";
const FORMAT_MESSAGE = "เลขประจำตัวผู้เสียภาษี/เลขประจำตัวประชาชนต้องเป็นตัวเลข 13 หลัก";

let storedTaxPayerId: string | null = null;
let upserts: Array<{ key: string; value: string }> = [];
let audits: Array<{ before: unknown; after: unknown }> = [];

const fakeTx = {
  siteContent: {
    upsert: async ({ where, update }: { where: { key: string }; update: { value: string } }) => {
      upserts.push({ key: where.key, value: update.value });
      return {};
    },
  },
  saleLineDeliveryDispatch: { updateMany: async () => ({ count: 0 }) },
};

before(async () => {
  if (moduleMocksUnavailable) return;
  await mock.module("next/cache", {
    namedExports: { revalidatePath: () => undefined, revalidateTag: () => undefined },
  });
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        siteContent: {
          findMany: async () =>
            storedTaxPayerId === null ? [] : [{ key: TAX_PAYER_ID_KEY, value: storedTaxPayerId }],
        },
      },
      dbTx: async <T>(fn: (tx: typeof fakeTx) => Promise<T>): Promise<T> => fn(fakeTx),
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
      safeWriteAuditLog: async (entry: { before: unknown; after: unknown }) => {
        audits.push(entry);
      },
    },
  });
  await mock.module("@/lib/products-bucket-storage", {
    namedExports: { uploadProductsBucketObject: async () => "" },
  });
});

beforeEach(() => {
  storedTaxPayerId = null;
  upserts = [];
  audits = [];
});

const BOOLEAN_FIELDS = [
  "shop_facebook_enabled", "shop_tiktok_enabled", "shop_shopee_enabled", "shop_lazada_enabled",
  "product_search_auto_apply_synonyms_enabled", "line_ai_auto_reply_enabled", "line_ai_dry_run",
  "line_ai_image_search_enabled",
];
const TEXT_FIELDS = [
  "shop_slogan", "shop_address", "shop_phone", "shop_phone_secondary", "shop_email", "shop_line_id",
  "shop_line_url", "shop_line_qr_url", "shop_logo_url", "shop_google_map_url", "shop_google_map_embed_url",
  "shop_business_hours", "shop_holiday_note", "shop_contact_note", "hero_title", "hero_subtitle",
  "shop_website_url", "shop_facebook_url", "shop_tiktok_url", "shop_shopee_url", "shop_lazada_url",
  "print_notice_text", "tax_branch_no", "tax_addr_no", "tax_addr_road",
  "tax_addr_subdistrict", "tax_addr_district", "tax_addr_province", "tax_addr_postcode", "tax_efiling_user_id",
];

const companyForm = (taxPayerId: string): FormData => {
  const form = new FormData();
  form.set("shop_name", "ร้านทดสอบ");
  for (const field of TEXT_FIELDS) form.set(field, "");
  for (const field of BOOLEAN_FIELDS) form.set(field, "false");
  form.set("vat_type", "NO_VAT");
  form.set("vat_rate", "7");
  form.set("delivery_commission_percent", "0");
  form.set(TAX_PAYER_ID_KEY, taxPayerId);
  return form;
};

const savedTaxPayerId = (): string | undefined => upserts.find((row) => row.key === TAX_PAYER_ID_KEY)?.value;

test("a new tax payer id with a wrong check digit is refused in Thai before any write", { skip: moduleMocksUnavailable }, async () => {
  const { updateCompanySettings } = await import("../actions");
  storedTaxPayerId = VALID_CHECK_DIGIT;
  assert.deepEqual(await updateCompanySettings(companyForm(WRONG_CHECK_DIGIT)), { error: TAX_ID_CHECK_DIGIT_MESSAGE });
  assert.deepEqual(upserts, []);
  assert.equal(audits.length, 0);
});

test("a wrong check digit is refused when no tax payer id was stored yet", { skip: moduleMocksUnavailable }, async () => {
  const { updateCompanySettings } = await import("../actions");
  storedTaxPayerId = null;
  assert.deepEqual(await updateCompanySettings(companyForm(WRONG_CHECK_DIGIT)), { error: TAX_ID_CHECK_DIGIT_MESSAGE });
  assert.deepEqual(upserts, []);
});

test("the stored tax payer id saved again unchanged still saves, even a legacy one that fails the check", { skip: moduleMocksUnavailable }, async () => {
  const { updateCompanySettings } = await import("../actions");
  storedTaxPayerId = STORED_INVALID;
  assert.deepEqual(await updateCompanySettings(companyForm(STORED_INVALID)), { success: true });
  assert.equal(savedTaxPayerId(), STORED_INVALID);
  assert.equal(audits.length, 1);

  upserts = [];
  storedTaxPayerId = VALID_CHECK_DIGIT;
  assert.deepEqual(await updateCompanySettings(companyForm(VALID_CHECK_DIGIT)), { success: true });
  assert.equal(savedTaxPayerId(), VALID_CHECK_DIGIT);
});

test("a new or changed valid tax payer id saves as before", { skip: moduleMocksUnavailable }, async () => {
  const { updateCompanySettings } = await import("../actions");
  storedTaxPayerId = STORED_INVALID;
  assert.deepEqual(await updateCompanySettings(companyForm(OTHER_VALID_CHECK_DIGIT)), { success: true });
  assert.equal(savedTaxPayerId(), OTHER_VALID_CHECK_DIGIT);
  assert.equal((audits[0].before as Record<string, unknown>)[TAX_PAYER_ID_KEY], STORED_INVALID);
  assert.equal((audits[0].after as Record<string, unknown>)[TAX_PAYER_ID_KEY], OTHER_VALID_CHECK_DIGIT);
});

test("an empty tax payer id is still allowed", { skip: moduleMocksUnavailable }, async () => {
  const { updateCompanySettings } = await import("../actions");
  storedTaxPayerId = VALID_CHECK_DIGIT;
  assert.deepEqual(await updateCompanySettings(companyForm("")), { success: true });
  assert.equal(savedTaxPayerId(), "");
});

test("the 13-digit format rule and its message are unchanged", { skip: moduleMocksUnavailable }, async () => {
  const { updateCompanySettings } = await import("../actions");
  storedTaxPayerId = VALID_CHECK_DIGIT;
  // Too short, dashes, Thai digits: this field has no normaliser, so these stay refused as today.
  for (const value of ["123", "1-1017-002070", "๑๑๐๑๗๐๐๒๐๗๐๓๐"]) {
    assert.deepEqual(await updateCompanySettings(companyForm(value)), { error: FORMAT_MESSAGE }, value);
  }
  assert.deepEqual(upserts, []);
});
