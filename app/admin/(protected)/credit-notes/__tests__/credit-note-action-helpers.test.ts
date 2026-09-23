import assert from "node:assert/strict";
import test from "node:test";

import {
  CreditNoteNotActiveError,
  creditNoteUnitKey,
  dropLotRowsUnlessReturn,
  loadCreditNoteLineRefs,
  lockActiveCreditNote,
} from "../credit-note-action-helpers";

type Line = { productId: string; unitName: string; lotItems: { lotNo: string }[] };
const lines: Line[] = [
  { productId: "p1", unitName: "ชิ้น", lotItems: [{ lotNo: "" }] },
  { productId: "p2", unitName: "กล่อง", lotItems: [] },
];

test("#25 non-RETURN credit notes drop the hidden, empty lot rows", () => {
  for (const type of ["DISCOUNT", "OTHER"]) {
    const result = dropLotRowsUnlessReturn(lines, type);
    assert.deepEqual(result.map((line) => line.lotItems), [[], []]);
    assert.equal(result[0].productId, "p1", "other fields are kept");
  }
  assert.deepEqual(lines[0].lotItems, [{ lotNo: "" }], "input is not mutated");
});

test("#25 RETURN credit notes keep their lot rows untouched", () => {
  assert.equal(dropLotRowsUnlessReturn(lines, "RETURN"), lines);
});

test("#182 one lookup returns the same unit scale and product flags per line", async () => {
  const calls: string[] = [];
  const tx = {
    productUnit: {
      findMany: async () => {
        calls.push("units");
        return [
          { productId: "p1", name: "ชิ้น", scale: 1 },
          { productId: "p2", name: "กล่อง", scale: 12 },
        ];
      },
    },
    product: {
      findMany: async () => {
        calls.push("products");
        return [
          { id: "p1", inventoryTracking: "TRACKED", isLotControl: true },
          { id: "p2", inventoryTracking: "TRACKED", isLotControl: false },
        ];
      },
    },
  };
  const refs = await loadCreditNoteLineRefs(tx as never, lines);

  assert.deepEqual(calls, ["units", "products"], "two queries for any number of lines");
  assert.equal(refs.unitByKey.get(creditNoteUnitKey("p2", "กล่อง"))?.scale, 12);
  assert.equal(refs.productById.get("p1")?.isLotControl, true);
  assert.equal(refs.unitByKey.get(creditNoteUnitKey("p2", "ชิ้น")), undefined, "unknown unit stays missing");
});

test("#182 no lines means no queries", async () => {
  const tx = { productUnit: { findMany: async () => assert.fail() }, product: { findMany: async () => assert.fail() } };
  const refs = await loadCreditNoteLineRefs(tx as never, []);
  assert.equal(refs.unitByKey.size, 0);
});

test("#113 the row lock passes for an ACTIVE credit note", async () => {
  const tx = { $queryRaw: async () => [{ status: "ACTIVE" }] };
  await lockActiveCreditNote(tx as never, "cn-1");
});

test("#113 a credit note cancelled by a concurrent request stops the transaction", async () => {
  for (const rows of [[{ status: "CANCELLED" }], []]) {
    const tx = { $queryRaw: async () => rows };
    await assert.rejects(lockActiveCreditNote(tx as never, "cn-1"), CreditNoteNotActiveError);
  }
});

test("#113 the lock query uses SELECT ... FOR UPDATE on the credit note id", async () => {
  let sql = "";
  let values: unknown[] = [];
  const tx = {
    $queryRaw: async (query: { strings: string[]; values: unknown[] }) => {
      sql = query.strings.join("?");
      values = query.values;
      return [{ status: "ACTIVE" }];
    },
  };
  await lockActiveCreditNote(tx as never, "cn-42");
  assert.match(sql, /FROM "CreditNote" WHERE "id" = \? FOR UPDATE/);
  assert.deepEqual(values, ["cn-42"]);
});
