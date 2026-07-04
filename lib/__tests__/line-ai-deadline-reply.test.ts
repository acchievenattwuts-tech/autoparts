import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

// Imported dynamically inside tests so the DATABASE_URL stub above is set before
// @/lib/chat-core/ai-service (which transitively loads the db client) is evaluated.
const loadService = () => import("@/lib/chat-core/ai-service");

test("buildMissingFitmentQuestion asks only for the missing slots", async () => {
  const { buildMissingFitmentQuestion } = await loadService();
  // Complete fitment → no question (stay silent / no redundant re-ask).
  assert.equal(
    buildMissingFitmentQuestion({ partType: "แผงแอร์", carBrand: "Toyota", carModel: "Vios", year: 2003 }),
    null,
  );
  // Only year missing → asks for the year alone, never part/car.
  const yearOnly = buildMissingFitmentQuestion({ partType: "แผงแอร์", carBrand: "Toyota", carModel: "Vios", year: null });
  assert.ok(yearOnly && yearOnly.includes("ปีรถ"));
  assert.ok(yearOnly && !yearOnly.includes("ชนิดอะไหล่"));
  // Only part missing → asks for the part alone.
  const partOnly = buildMissingFitmentQuestion({ partType: null, carBrand: "Toyota", carModel: "Vios", year: 2003 });
  assert.ok(partOnly && partOnly.includes("ชนิดอะไหล่"));
  assert.ok(partOnly && !partOnly.includes("ปีรถ"));
});

test("deadline reply does not re-ask known info when the subject is complete and empty", async () => {
  const { buildJuneDeadlineReply } = await loadService();
  const reply = buildJuneDeadlineReply({
    query: "แผงแอร์ Toyota Vios",
    products: [],
    known: { partType: "แผงแอร์", carBrand: "Toyota", carModel: "Vios", year: 2003 },
  });
  // Must NOT re-ask the year/model it already knows, and must not demand a photo.
  assert.ok(!reply.includes("ปีรถ"));
  assert.ok(!reply.includes("รุ่นรถ"));
  assert.ok(!reply.includes("รูปอะไหล่"));
});

test("deadline reply asks only the missing slot when the subject is incomplete", async () => {
  const { buildJuneDeadlineReply } = await loadService();
  const reply = buildJuneDeadlineReply({
    query: "แผงแอร์ Toyota Vios",
    products: [],
    known: { partType: "แผงแอร์", carBrand: "Toyota", carModel: "Vios", year: null },
  });
  assert.ok(reply.includes("ปีรถ"));
});

test("deadline reply still lists products when matches exist", async () => {
  const { buildJuneDeadlineReply } = await loadService();
  const reply = buildJuneDeadlineReply({
    query: "แผงแอร์ Toyota Vios",
    products: [{ name: "แผงแอร์ TOYOTA VIOS / YARIS 2013-2016", code: "P0066", salePrice: 1500 }],
    known: { partType: "แผงแอร์", carBrand: "Toyota", carModel: "Vios", year: 2003 },
  });
  assert.ok(reply.includes("P0066"));
});
