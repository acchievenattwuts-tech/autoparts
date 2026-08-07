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
    voltage: null,
  });
  assert.deepEqual(extractChatVehicleConstraints("อะไหล่ CX-3 2.0"), {
    side: null,
    generation: null,
    engineSize: 2,
    voltage: null,
  });
  assert.deepEqual(extractChatVehicleConstraints("อะไหล่ Mazda3 2.0"), {
    side: null,
    generation: null,
    engineSize: 2,
    voltage: null,
  });
});

test("voltage guard suppresses only an explicit opposite voltage and retains missing metadata", () => {
  const result = filterChatProductsByVehicleCompatibility({
    customerText: "คอมแอร์ 508 24V",
    products: [
      { id: "P0460", name: "คอมแอร์ SANDEN 508 24V" },
      { id: "P0532", name: "คอมแอร์ Sanden 508 24V STAL" },
      { id: "P0459", name: "คอมแอร์ SANDEN 508 12V" },
      { id: "unknown", name: "คอมแอร์ Sanden 508 ไม่ระบุระบบไฟ" },
    ],
  });

  assert.equal(result.constraints.voltage, 24);
  assert.deepEqual(result.products.map((product) => product.id), ["P0460", "P0532", "unknown"]);
  assert.deepEqual(result.suppressed, [{ id: "P0459", reasons: ["wrong_voltage"] }]);
  assert.match(result.verificationNote ?? "", /ระบบไฟ 24V/);
});

test("voltage guard stays off when the customer does not name one voltage", () => {
  for (const customerText of ["คอมแอร์ 508", "คอมแอร์ 508 12V\/24V"]) {
    const result = filterChatProductsByVehicleCompatibility({
      customerText,
      products: [
        { id: "12v", name: "คอมแอร์ 508 12V" },
        { id: "24v", name: "คอมแอร์ 508 24V" },
      ],
    });
    assert.equal(result.constraints.voltage, null);
    assert.deepEqual(result.products.map((product) => product.id), ["12v", "24v"]);
    assert.deepEqual(result.suppressed, []);
  }
});
