import test from "node:test";
import assert from "node:assert/strict";

import { Prisma } from "@/lib/generated/prisma";
import {
  getUniqueViolationFields,
  isDatabaseLayerError,
  isUniqueViolationOn,
  withDocNumberRetry,
} from "../doc-number-retry";

const adapterP2002 = (fields: string[]) =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: {
      driverAdapterError: {
        name: "DriverAdapterError",
        cause: { kind: "UniqueConstraintViolation", constraint: { fields } },
      },
    },
  });

test("reads quoted column names from the Prisma 7 driver-adapter shape", () => {
  assert.deepEqual(getUniqueViolationFields(adapterP2002(['"saleNo"'])), ["saleNo"]);
  assert.deepEqual(getUniqueViolationFields(adapterP2002(["channel", '"channelRefNo"'])), ["channel", "channelRefNo"]);
});

test("reads the legacy meta.target shape and index names", () => {
  assert.deepEqual(getUniqueViolationFields({ code: "P2002", meta: { target: ["receiptNo"] } }), ["receiptNo"]);
  assert.equal(
    isUniqueViolationOn({ code: "P2002", meta: { driverAdapterError: { cause: { constraint: { index: "Sale_saleNo_key" } } } } }, "saleNo"),
    true,
  );
});

test("non-P2002 errors are not unique violations", () => {
  assert.equal(getUniqueViolationFields(new Error("x")), null);
  assert.equal(getUniqueViolationFields({ code: "P2025" }), null);
  assert.equal(isUniqueViolationOn(null, "saleNo"), false);
});

test("isUniqueViolationOn only matches the named field", () => {
  const onRef = adapterP2002(["channel", '"channelRefNo"']);
  assert.equal(isUniqueViolationOn(onRef, "channelRefNo"), true);
  assert.equal(isUniqueViolationOn(onRef, "saleNo"), false);
  assert.equal(isUniqueViolationOn({ code: "P2002", meta: {} }, "saleNo"), false);
});

test("withDocNumberRetry returns the first successful result without retrying", async () => {
  const generated: string[] = [];
  const result = await withDocNumberRetry({
    uniqueField: "saleNo",
    generate: async () => {
      generated.push(`SA${generated.length + 1}`);
      return generated[generated.length - 1];
    },
    run: async (docNo) => `saved ${docNo}`,
  });
  assert.equal(result, "saved SA1");
  assert.deepEqual(generated, ["SA1"]);
});

test("withDocNumberRetry regenerates the number after a collision on the doc-number column", async () => {
  let calls = 0;
  const seen: string[] = [];
  const result = await withDocNumberRetry({
    uniqueField: "saleNo",
    generate: async () => `SA${++calls}`,
    run: async (docNo) => {
      seen.push(docNo);
      if (docNo === "SA1") throw adapterP2002(['"saleNo"']);
      return docNo;
    },
  });
  assert.equal(result, "SA2");
  assert.deepEqual(seen, ["SA1", "SA2"]);
});

test("withDocNumberRetry rethrows other errors immediately", async () => {
  let runs = 0;
  const refError = adapterP2002(["channel", '"channelRefNo"']);
  await assert.rejects(
    withDocNumberRetry({
      uniqueField: "saleNo",
      generate: async () => "SA1",
      run: async () => {
        runs += 1;
        throw refError;
      },
    }),
    (error) => error === refError,
  );
  assert.equal(runs, 1);

  const business = new Error("ยอดไม่ถูกต้อง");
  await assert.rejects(
    withDocNumberRetry({ uniqueField: "saleNo", generate: async () => "SA1", run: async () => { throw business; } }),
    (error) => error === business,
  );
});

test("withDocNumberRetry gives up after maxAttempts and rethrows the last collision", async () => {
  let runs = 0;
  await assert.rejects(
    withDocNumberRetry({
      uniqueField: "expenseNo",
      maxAttempts: 3,
      generate: async () => "EX1",
      run: async () => {
        runs += 1;
        throw adapterP2002(['"expenseNo"']);
      },
    }),
    (error) => isUniqueViolationOn(error, "expenseNo"),
  );
  assert.equal(runs, 3);
});

test("isDatabaseLayerError flags Prisma / driver errors but not business errors", () => {
  assert.equal(isDatabaseLayerError(adapterP2002(['"receiptNo"'])), true);
  assert.equal(isDatabaseLayerError(new Prisma.PrismaClientUnknownRequestError("boom", { clientVersion: "test" })), true);
  const driverError = new Error("canceling statement due to lock timeout");
  driverError.name = "DriverAdapterError";
  assert.equal(isDatabaseLayerError(driverError), true);
  assert.equal(isDatabaseLayerError(new Error("ไม่พบบัญชีรับเงิน")), false);
  assert.equal(isDatabaseLayerError("x"), false);
});

// The two pre-existing retry loops (delivery-commission runs and profit
// distributions) read only meta.target, which Prisma 7 driver adapters never
// set, so they never recognised a collision. These are the exact columns those
// actions now check through isUniqueViolationOn.
test("Prisma 7 collisions on the delivery-commission and profit-distribution columns are recognised", () => {
  for (const column of ["runNo", "expenseNo", "activeSaleId", "distributionNo", "activePeriodKey"]) {
    const error = adapterP2002([`"${column}"`]);
    assert.equal((error.meta as { target?: unknown }).target, undefined, "Prisma 7 sets no meta.target");
    assert.equal(isUniqueViolationOn(error, column), true, column);
  }
  assert.equal(isUniqueViolationOn(adapterP2002(['"activePeriodKey"']), "distributionNo"), false);
});

test("a distributionNo collision reruns the whole unit of work with a fresh number", async () => {
  const numbers = ["PD26090001", "PD26090002"];
  const seen: string[] = [];
  const result = await withDocNumberRetry({
    uniqueField: "distributionNo",
    generate: async () => numbers.shift() ?? "none",
    run: async (docNo) => {
      seen.push(docNo);
      if (seen.length === 1) throw adapterP2002(['"distributionNo"']);
      return docNo;
    },
  });
  assert.deepEqual(seen, ["PD26090001", "PD26090002"]);
  assert.equal(result, "PD26090002");
});
