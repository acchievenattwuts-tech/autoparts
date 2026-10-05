import assert from "node:assert/strict";
import test from "node:test";

import {
  allocateSaleLots,
  buildReturnLotNo,
  creditNoteSourceLotNo,
  findSaleLotRowError,
  matchSaleLotNo,
  remainingSaleLots,
  sumLotBaseQty,
  type SaleLotOption,
} from "../credit-note-return-lots";

const saleLots: SaleLotOption[] = [
  { lotNo: "L001", baseQty: 3, unitCostBase: 10, mfgDate: "2026-01-01", expDate: "2027-01-01" },
  { lotNo: "L002", baseQty: 5, unitCostBase: 12, mfgDate: "", expDate: "2027-06-01" },
];

test("allocateSaleLots spreads the return quantity over the sale lots in sale order", () => {
  const rows = allocateSaleLots(saleLots, 4, 1);
  assert.deepEqual(
    rows.map((row) => [row.lotNo, row.qty, row.unitCost, row.expDate]),
    [
      ["L001", 3, 10, "2027-01-01"],
      ["L002", 1, 12, "2027-06-01"],
    ],
  );
});

test("allocateSaleLots converts base quantities and cost to the line unit", () => {
  // A pack of 2 base units: L001 holds 1.5 packs.
  const rows = allocateSaleLots(saleLots, 2, 2);
  assert.deepEqual(rows.map((row) => [row.lotNo, row.qty, row.unitCost]), [
    ["L001", 1.5, 20],
    ["L002", 0.5, 24],
  ]);
});

test("allocateSaleLots keeps the RET-lot choice already made for a lot", () => {
  const first = allocateSaleLots(saleLots, 4, 1).map((row) =>
    row.lotNo === "L002" ? { ...row, isReturnLot: true } : row,
  );
  const reallocated = allocateSaleLots(saleLots, 5, 1, first);
  assert.equal(reallocated.find((row) => row.lotNo === "L002")?.isReturnLot, true);
  assert.equal(reallocated.find((row) => row.lotNo === "L001")?.isReturnLot, false);
});

test("allocateSaleLots stops short when the sale lots cannot cover the quantity", () => {
  const rows = allocateSaleLots(saleLots, 10, 1);
  assert.equal(rows.reduce((sum, row) => sum + row.qty, 0), 8);
});

test("remainingSaleLots subtracts what the other lines of the credit note use", () => {
  const used = sumLotBaseQty([{ lotItems: [{ lotNo: "L001", qty: 1 }], scale: 2 }]);
  assert.deepEqual(
    remainingSaleLots(saleLots, used).map((lot) => [lot.lotNo, lot.baseQty]),
    [
      ["L001", 1],
      ["L002", 5],
    ],
  );
});

test("findSaleLotRowError rejects a lot outside the sale and a quantity over the sold lot", () => {
  assert.equal(findSaleLotRowError(saleLots, [{ lotNo: "L001", qty: 3 }], 1, "ชิ้น"), null);
  assert.match(findSaleLotRowError(saleLots, [{ lotNo: "X9", qty: 1 }], 1, "ชิ้น") ?? "", /X9 ไม่อยู่ใน/);
  assert.match(
    findSaleLotRowError(saleLots, [{ lotNo: "L001", qty: 2 }], 2, "แพ็ค") ?? "",
    /L001 คืนได้อีกไม่เกิน 1\.5 แพ็ค/,
  );
});

test("a RET-lot name maps back to its source lot, so re-saving does not grow it", () => {
  const cnItemId = "cmabcdefgh12345678";
  const stored = buildReturnLotNo("L001", cnItemId);
  assert.equal(stored, "RET-L001-12345678");
  assert.equal(creditNoteSourceLotNo(stored, true, cnItemId), "L001");
  assert.equal(creditNoteSourceLotNo("L001", false, cnItemId), "L001");
  // Re-saving rebuilds the same name from the source lot.
  assert.equal(buildReturnLotNo(creditNoteSourceLotNo(stored, true, cnItemId), cnItemId), stored);
});

test("matchSaleLotNo accepts a unique prefix for a source lot cut short in its RET- name", () => {
  const longLot = "L".repeat(95);
  const cnItemId = "cm0000000000abcdefgh";
  const source = creditNoteSourceLotNo(buildReturnLotNo(longLot, cnItemId), true, cnItemId);
  assert.notEqual(source, longLot);
  assert.equal(matchSaleLotNo(source, [longLot, "L002"]), longLot);
  assert.equal(matchSaleLotNo("L00", ["L001", "L002"]), null);
});
