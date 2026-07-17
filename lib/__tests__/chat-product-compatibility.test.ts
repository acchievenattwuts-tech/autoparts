import test from "node:test";
import assert from "node:assert/strict";

import {
  extractChatVehicleConstraints,
  filterChatProductsByVehicleCompatibility,
} from "@/lib/chat-core/product-compatibility";

const crvFitment = (overrides: Partial<{
  submodel: string | null;
  engineSize: string | null;
  note: string | null;
}> = {}) => ({
  carBrandName: "Honda",
  carModelName: "CRV",
  submodel: overrides.submodel ?? null,
  engineSize: overrides.engineSize ?? null,
  note: overrides.note ?? null,
});

test("keeps the driver-side CRV candidate and suppresses catalogued passenger-side rows", () => {
  const result = filterChatProductsByVehicleCompatibility({
    customerText: "มอเตอร์พัดลมหน้าเครื่องฝั่งคนขับ crv g3 2.0 มีของเลยไหมครับ",
    carBrandName: "Honda",
    carModelName: "CRV",
    products: [
      {
        id: "P0903",
        name: "มอเตอร์พัดลม CRV G3 ฝั่งคนขับ",
        fitments: [crvFitment({ note: "CRV G3 07-12 ฝั่งคนขับ" })],
      },
      {
        id: "P0270",
        name: "มอเตอร์พัดลม CRV G3",
        fitments: [crvFitment({ note: "CRV G3 07-12 ฝั่งคนนั่ง" })],
      },
      {
        id: "P0594",
        name: "มอเตอร์พัดลม CRV G3 ฝั่งคนนั่ง",
        fitments: [crvFitment({ note: "CRV G3 07-12 ฝั่งคนนั่ง" })],
      },
    ],
  });

  assert.deepEqual(result.products.map((product) => product.id), ["P0903"]);
  assert.deepEqual(result.suppressed, [
    { id: "P0270", reasons: ["opposite_side"] },
    { id: "P0594", reasons: ["opposite_side"] },
  ]);
  assert.doesNotMatch(result.verificationNote ?? "", /ตำแหน่งฝั่งคนขับ/);
  assert.match(result.verificationNote ?? "", /เครื่อง 2\.0/);
  assert.doesNotMatch(result.verificationNote ?? "", /ยืนยันรุ่น G3/);
  assert.match(result.verificationNote ?? "", /เทียบรูปอะไหล่เดิม/);
});

test("suppresses explicit generation and engine conflicts while retaining missing metadata", () => {
  const result = filterChatProductsByVehicleCompatibility({
    customerText: "มอเตอร์พัดลมฝั่งคนขับ CR-V G3 2.0",
    carBrandName: "Honda",
    carModelName: "CRV",
    products: [
      {
        id: "wrong-generation",
        name: "มอเตอร์พัดลม CRV G2 2.0",
        fitments: [crvFitment({ note: "CRV G2", engineSize: "2.0" })],
      },
      {
        id: "wrong-engine",
        name: "มอเตอร์พัดลม CRV G3 2.4",
        fitments: [crvFitment({ note: "CRV G3", engineSize: "2.4" })],
      },
      {
        id: "unknown",
        name: "มอเตอร์พัดลม Honda CRV",
        fitments: [crvFitment()],
      },
    ],
  });

  assert.deepEqual(result.products.map((product) => product.id), ["unknown"]);
  assert.deepEqual(result.suppressed, [
    { id: "wrong-generation", reasons: ["wrong_generation"] },
    { id: "wrong-engine", reasons: ["wrong_engine"] },
  ]);
  assert.match(result.verificationNote ?? "", /รุ่น G3/);
  assert.match(result.verificationNote ?? "", /ตำแหน่งฝั่งคนขับ/);
  assert.match(result.verificationNote ?? "", /เครื่อง 2\.0/);
});

test("does not interpret digits inside real model names as generation markers", () => {
  assert.deepEqual(extractChatVehicleConstraints("อะไหล่ MG3 1.5"), {
    side: null,
    generation: null,
    engineSize: 1.5,
  });
  assert.deepEqual(extractChatVehicleConstraints("อะไหล่ CX-3 2.0"), {
    side: null,
    generation: null,
    engineSize: 2,
  });
  assert.deepEqual(extractChatVehicleConstraints("อะไหล่ Mazda3 2.0"), {
    side: null,
    generation: null,
    engineSize: 2,
  });
});
