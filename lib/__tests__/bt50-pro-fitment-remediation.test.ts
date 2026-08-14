import test from "node:test";
import assert from "node:assert/strict";

import {
  selectBt50ProRemediationCandidates,
  type Bt50ProAuditProduct,
} from "@/lib/bt50-pro-fitment-remediation";

const fitment = (
  id: string,
  carModelName: string,
  submodel: string | null,
  carBrandName = "Mazda",
) => ({
  id,
  carModelId: `model-${id}`,
  carBrandName,
  carModelName,
  submodel,
  yearStart: 2012,
  yearEnd: 2020,
  engineCode: null,
  engineSize: null,
  fitmentType: "DIRECT",
  note: null,
});

const product = (
  code: string,
  name: string,
  fitments: Bt50ProAuditProduct["fitments"],
  aliases: string[] = [],
): Bt50ProAuditProduct => ({ id: `product-${code}`, code, name, aliases, fitments });

test("selects only explicit BT-50 Pro products with the confirmed legacy BT-50/Pro shape", () => {
  const candidates = selectBt50ProRemediationCandidates([
    product("P0009", "กรองแอร์ Mazda BT-50 Pro", [fitment("a", "BT-50", "Pro")]),
    product("P0080", "แผงแอร์ Ford Ranger", [fitment("b", "BT-50", "Pro")], ["Condenser Mazda BT-50 Pro"]),
    product("P0111", "โบเวอร์ Ford Ranger", [fitment("c", "BT-50", null)], ["Mazda BT-50 Pro"]),
    product("P9998", "อะไหล่ Mazda BT-50 Pro", [fitment("d", "BT-50", "Freestyle Cab")]),
    product("P9999", "อะไหล่ Mazda BT-50 Pro", [fitment("e", "BT-50", "Pro", "Ford")]),
  ]);

  assert.deepEqual(candidates.map((row) => row.productCode), ["P0009", "P0080"]);
});

test("does not duplicate a product already linked to the BT-50 Pro master", () => {
  const candidates = selectBt50ProRemediationCandidates([
    product("P0009", "กรองแอร์ Mazda BT-50 Pro", [
      fitment("legacy", "BT-50", "Pro"),
      fitment("target", "BT-50 Pro", null),
    ]),
  ]);

  assert.deepEqual(candidates, []);
});
