import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import { LINE_DELIVERY_NOTIFICATIONS_DISABLED_AT_KEY } from "@/lib/line-delivery-settings";

// The LINE delivery-card switch changes only when the form actually submits it.
// A stale form (or any caller) that omits the field must leave the setting on and
// must not run the shutdown branch that skips every pending card.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

const LINE_DELIVERY_KEY = "line_delivery_notifications_enabled";

let upsertedKeys: string[] = [];
let skippedDispatchUpdates = 0;
let audits: Array<{ before: unknown; after: unknown; meta: unknown }> = [];

const fakeTx = {
  siteContent: {
    upsert: async ({ where }: { where: { key: string } }) => {
      upsertedKeys.push(where.key);
      return {};
    },
  },
  saleLineDeliveryDispatch: {
    updateMany: async () => {
      skippedDispatchUpdates += 1;
      return { count: 3 };
    },
  },
};

before(async () => {
  if (moduleMocksUnavailable) return;
  await mock.module("next/cache", {
    namedExports: { revalidatePath: () => undefined, revalidateTag: () => undefined },
  });
  await mock.module("@/lib/db", {
    namedExports: {
      db: { siteContent: { findMany: async () => [{ key: LINE_DELIVERY_KEY, value: "true" }] } },
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
      safeWriteAuditLog: async (entry: { before: unknown; after: unknown; meta: unknown }) => {
        audits.push(entry);
      },
    },
  });
  await mock.module("@/lib/products-bucket-storage", {
    namedExports: { uploadProductsBucketObject: async () => "" },
  });
});

beforeEach(() => {
  upsertedKeys = [];
  skippedDispatchUpdates = 0;
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
  "print_notice_text", "tax_payer_id", "tax_branch_no", "tax_addr_no", "tax_addr_road",
  "tax_addr_subdistrict", "tax_addr_district", "tax_addr_province", "tax_addr_postcode", "tax_efiling_user_id",
];

const companyForm = (lineDeliveryEnabled?: "true" | "false"): FormData => {
  const form = new FormData();
  form.set("shop_name", "ร้านทดสอบ");
  for (const field of TEXT_FIELDS) form.set(field, "");
  for (const field of BOOLEAN_FIELDS) form.set(field, "false");
  form.set("vat_type", "NO_VAT");
  form.set("vat_rate", "7");
  form.set("delivery_commission_percent", "0");
  if (lineDeliveryEnabled) form.set(LINE_DELIVERY_KEY, lineDeliveryEnabled);
  return form;
};

test("a submit without the LINE delivery field leaves the setting and pending cards untouched", { skip: moduleMocksUnavailable }, async () => {
  const { updateCompanySettings } = await import("../actions");
  assert.deepEqual(await updateCompanySettings(companyForm()), { success: true });
  assert.ok(upsertedKeys.includes("shop_name"));
  assert.ok(!upsertedKeys.includes(LINE_DELIVERY_KEY));
  assert.ok(!upsertedKeys.includes(LINE_DELIVERY_NOTIFICATIONS_DISABLED_AT_KEY));
  assert.equal(skippedDispatchUpdates, 0);
  assert.equal(audits.length, 1);
  assert.ok(!Object.hasOwn(audits[0].after as object, LINE_DELIVERY_KEY));
  assert.deepEqual(audits[0].meta, { lineDeliveryDispatchesSkipped: 0 });
});

test("an explicit off still turns the feature off and skips pending cards", { skip: moduleMocksUnavailable }, async () => {
  const { updateCompanySettings } = await import("../actions");
  assert.deepEqual(await updateCompanySettings(companyForm("false")), { success: true });
  assert.ok(upsertedKeys.includes(LINE_DELIVERY_KEY));
  assert.ok(upsertedKeys.includes(LINE_DELIVERY_NOTIFICATIONS_DISABLED_AT_KEY));
  assert.equal(skippedDispatchUpdates, 1);
  assert.deepEqual(audits[0].meta, { lineDeliveryDispatchesSkipped: 3 });
});

test("an explicit on saves the setting without the shutdown branch", { skip: moduleMocksUnavailable }, async () => {
  const { updateCompanySettings } = await import("../actions");
  assert.deepEqual(await updateCompanySettings(companyForm("true")), { success: true });
  assert.ok(upsertedKeys.includes(LINE_DELIVERY_KEY));
  assert.equal(skippedDispatchUpdates, 0);
});

// ── V1: VAT registration date (date-only, "" = not registered, absent = unchanged) ──

const VAT_REGISTERED_FROM = "vat_registered_from";

test("the VAT registration date is saved and audited before/after", { skip: moduleMocksUnavailable }, async () => {
  const { updateCompanySettings } = await import("../actions");
  const form = companyForm();
  form.set(VAT_REGISTERED_FROM, "2026-11-01");
  assert.deepEqual(await updateCompanySettings(form), { success: true });
  assert.ok(upsertedKeys.includes(VAT_REGISTERED_FROM));
  assert.equal((audits[0].before as Record<string, unknown>)[VAT_REGISTERED_FROM], null);
  assert.equal((audits[0].after as Record<string, unknown>)[VAT_REGISTERED_FROM], "2026-11-01");
});

test("clearing the VAT registration date saves an empty value (not registered)", { skip: moduleMocksUnavailable }, async () => {
  const { updateCompanySettings } = await import("../actions");
  const form = companyForm();
  form.set(VAT_REGISTERED_FROM, "");
  assert.deepEqual(await updateCompanySettings(form), { success: true });
  assert.equal((audits[0].after as Record<string, unknown>)[VAT_REGISTERED_FROM], "");
});

test("a stale form without the field leaves the VAT registration date unchanged", { skip: moduleMocksUnavailable }, async () => {
  const { updateCompanySettings } = await import("../actions");
  assert.deepEqual(await updateCompanySettings(companyForm()), { success: true });
  assert.ok(!upsertedKeys.includes(VAT_REGISTERED_FROM));
});

test("an invalid VAT registration date is refused in Thai before any write", { skip: moduleMocksUnavailable }, async () => {
  const { updateCompanySettings } = await import("../actions");
  const form = companyForm();
  form.set(VAT_REGISTERED_FROM, "01/11/2026");
  assert.deepEqual(await updateCompanySettings(form), {
    error: "วันที่จดทะเบียน VAT ไม่ถูกต้อง (เว้นว่างได้ถ้ายังไม่ได้จดทะเบียน)",
  });
  assert.deepEqual(upsertedKeys, []);
  assert.equal(audits.length, 0);
});
