import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

test("an already-linked LINE identity returns without another phone lookup or customer mutation", async () => {
  const { db } = await import("@/lib/db");
  const { resolveLiffCustomerFromPhone } = await import("@/lib/liff-customer");

  const originalCustomerFindFirst = db.customer.findFirst;
  const originalCustomerFindMany = db.customer.findMany;
  const originalCustomerUpdate = db.customer.update;
  const originalCustomerCreate = db.customer.create;
  const originalThrottleFindMany = db.loginThrottle.findMany;

  let phoneLookupCalled = false;
  let customerMutationCalled = false;
  let throttleLookupCalled = false;

  db.customer.findFirst = (async () => ({
    id: "customer-1",
    code: "C0001",
    name: "Linked customer",
    phone: "0812345678",
    lineUserId: "line-user-1",
    lineLinkedAt: new Date("2026-07-14T05:51:09.000Z"),
    source: "LINE_LIFF",
  })) as unknown as typeof db.customer.findFirst;
  db.customer.findMany = (async () => {
    phoneLookupCalled = true;
    return [];
  }) as unknown as typeof db.customer.findMany;
  db.customer.update = (async () => {
    customerMutationCalled = true;
    throw new Error("customer update must not run for an idempotent retry");
  }) as unknown as typeof db.customer.update;
  db.customer.create = (async () => {
    customerMutationCalled = true;
    throw new Error("customer create must not run for an idempotent retry");
  }) as unknown as typeof db.customer.create;
  db.loginThrottle.findMany = (async () => {
    throttleLookupCalled = true;
    return [];
  }) as unknown as typeof db.loginThrottle.findMany;

  try {
    const result = await resolveLiffCustomerFromPhone({
      lineUserId: "line-user-1",
      displayName: "LINE customer",
      phone: "",
      throttleKeys: ["liff-phone-lookup:line:line-user-1"],
    });

    assert.deepEqual(result, {
      status: "LINKED",
      customerId: "customer-1",
      customerName: "Linked customer",
    });
    assert.equal(phoneLookupCalled, false);
    assert.equal(customerMutationCalled, false);
    assert.equal(throttleLookupCalled, false);
  } finally {
    db.customer.findFirst = originalCustomerFindFirst;
    db.customer.findMany = originalCustomerFindMany;
    db.customer.update = originalCustomerUpdate;
    db.customer.create = originalCustomerCreate;
    db.loginThrottle.findMany = originalThrottleFindMany;
  }
});

test("the LIFF Route Handler uses route-compatible immediate cache expiration", () => {
  const repoRoot = process.cwd();
  const transactionOptionsSource = readFileSync(path.join(repoRoot, "lib/transaction-options.ts"), "utf8");
  const liffCustomerSource = readFileSync(path.join(repoRoot, "lib/liff-customer.ts"), "utf8");
  const verifyLinkRouteSource = readFileSync(path.join(repoRoot, "app/api/liff/verify-link/route.ts"), "utf8");

  assert.match(
    transactionOptionsSource,
    /revalidateTag\(TRANSACTION_CUSTOMER_OPTIONS_TAG, \{ expire: 0 \}\)/,
  );
  assert.doesNotMatch(liffCustomerSource, /invalidateTransactionCustomerOptions/);
  assert.match(verifyLinkRouteSource, /revalidateTransactionCustomerOptions\(\)/);
});
