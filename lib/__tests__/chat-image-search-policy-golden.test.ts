import assert from "node:assert/strict";
import test from "node:test";

import { resolveChatImageSearchPolicy } from "@/lib/chat-core/image-search-policy";
import {
  isVehicleFreeChatPartType,
  resolveChatGatePartKind,
} from "@/lib/chat-core/product-spec-resolve";

const safeCatalogGroups = [
  { label: "น้ำยาล้างคอยล์/ระบบแอร์", skuCodes: ["P0482", "P0458"], samples: ["น้ำยาล้างคอยล์", "น้ำยาล้างระบบแอร์"] },
  { label: "เทปงานแอร์", skuCodes: ["P0537", "P0863", "P0777", "P0778"], samples: ["เทปละลาย", "เทปขี้หมา", "เทปฉนวน AEROTAPE"] },
  { label: "หัวเติมน้ำยา", skuCodes: ["P0597", "P0945", "P0946"], samples: ["หัวคอปเปอร์", "หัวเติมน้ำยา R134a"] },
  { label: "ชุดเกจ์", skuCodes: ["P0865"], samples: ["ชุดเกจ์วัดน้ำยาแอร์", "manifold gauge set R134a"] },
  { label: "น็อตวาล์ว", skuCodes: ["P0478", "P0479"], samples: ["น็อตวาล์ว", "น็อตหัวจม"] },
  { label: "เครื่องมือถอดวาล์ว", skuCodes: ["P0534"], samples: ["ตัวถอดไส้ศร", "เครื่องมือถอดวาล์ว"] },
  { label: "ฝาปิดวาล์ว", skuCodes: ["P0535", "P0546"], samples: ["ฝาปิดวาล์วเติมน้ำยา"] },
  { label: "ไส้ศรแอร์", skuCodes: ["P0547", "P0804"], samples: ["วาล์วลูกศร", "ไส้ศรแอร์ R134a"] },
  { label: "ฟองน้ำเส้น", skuCodes: ["P0567"], samples: ["ฟองน้ำเส้นตู้แอร์"] },
  { label: "เข็มขัดรัดท่อ", skuCodes: ["P0630", "P0631"], samples: ["เข็มขัดรัดท่อยาง"] },
  { label: "ท่อส่งลม", skuCodes: ["P0806"], samples: ["ท่อส่งลมแอร์แบบยืด"] },
] as const;

const safeProductionProducts = [
  { code: "P0458", name: "น้ำยาล้างระบบแอร์ F-11 Hi-CLEAR SUN POWER 500ml สำหรับแอร์รถยนต์และแอร์บ้าน" },
  { code: "P0478", name: "น็อตหัวจมหกเหลี่ยมแบบกลาง สีเงิน เกลียวมิล (น๊อตวาล์วแบบกลาง)" },
  { code: "P0479", name: "น็อตหัวจมหกเหลี่ยมแบบยาว สีเงิน เกลียวมิล (น๊อตวาล์วแบบยาว)" },
  { code: "P0482", name: "น้ำยาล้างคอยล์ Hi-SPEC ไม่มีโซดาไฟ 1200CC" },
  { code: "P0534", name: "ตัวถอดไส้ศรแอร์รถยนต์ เครื่องมือถอดวาล์วลูกศรน้ำยาแอร์" },
  { code: "P0535", name: "ฝาปิดวาล์วเติมน้ำยาแอร์รถยนต์ R134a ด้าน High H สีฟ้า พร้อมโอริง (H)" },
  { code: "P0537", name: "เทปละลาย เทปขี้หมา COTRAN KC80 Waterseal Mastic Tape 2 นิ้ว x 10 ฟุต" },
  { code: "P0546", name: "ฝาปิดวาล์วเติมน้ำยาแอร์รถยนต์ R134a ด้าน Low L สีฟ้า พร้อมโอริง (L)" },
  { code: "P0547", name: "วาล์วลูกศรแอร์ Universal รถยนต์ระบบ R12 (501)" },
  { code: "P0567", name: "ฟองน้ำเส้นตู้แอร์ รถยนต์ทั่วไป ขนาด 1.5x1.5x99.5 ซม." },
  { code: "P0597", name: "หัวคอปเปอร์เติมน้ำยาแอร์รถยนต์ HONGSEN R134a High Side 1/4 (HS-QH-1/4) (แดง)" },
  { code: "P0630", name: "เข็มขัดรัดท่อยาง 25-35 มม. เบอร์ 35 W1" },
  { code: "P0631", name: "เข็มขัดรัดท่อยาง 35-50 มม. เบอร์ 2A W1" },
  { code: "P0777", name: "AEROTAPE แอโรเทป เทปโฟมฉนวนพันท่อแอร์ 3mm x 50mm x 9.1m" },
  { code: "P0778", name: "AEROTAPE แอโรเทป เทปโฟมฉนวนมีกาวในตัว ยาว 2 เมตร" },
  { code: "P0804", name: "ไส้ศรแอร์ R134 STAL RE.88.001" },
  { code: "P0806", name: "ท่อส่งลมแอร์รถยนต์แบบยืด สีดำ" },
  { code: "P0863", name: "Cock Taper เทปกาวขี้หมา STAL STP-3003" },
  { code: "P0865", name: "ชุดเกจ์วัดน้ำยาแอร์รถยนต์ STAL R134a TQ.88.001" },
  { code: "P0945", name: "หัวคอปเปอร์เติมน้ำยาแอร์รถยนต์ R134 QC-LP LOW สีน้ำเงิน STAL TO.88.006" },
  { code: "P0946", name: "หัวคอปเปอร์สายเกจแอร์รถยนต์ QC-HP R134a ฝั่ง HIGH สีแดง STAL TO.88.007" },
] as const;

const legacyVehicleFreeSamples = [
  "น้ำยาแอร์ R32",
  "สารทำความเย็น R134a",
  "น้ำมันคอมแอร์ PAG46",
  "น้ำยาหล่อเย็นหม้อน้ำ",
  "ใบพัดลม 12 นิ้ว",
] as const;

const fitmentNegativeSamples = [
  "หม้อน้ำ",
  "สายพานหน้าเครื่อง",
  "ตู้แอร์",
  "คอมแอร์",
  "สายน้ำยาแอร์",
  "วาล์วแอร์",
  "วาล์วแอร์ Toyota Vios",
  "ท่อน้ำยาแอร์",
  "ฟองน้ำตู้แอร์ Toyota Captiva",
  "มอเตอร์พัดลม",
  "แผงคอยล์ร้อน",
  "น็อต",
  "เทป",
] as const;

const baselineVehicleFreePartType = (partType: string): boolean =>
  [
    /^(?:น้ำยา\s*แอร์|สาร\s*ทำความเย็น|refrigerant)(?:\s+.*)?$/iu,
    /^(?:น้ำมัน\s*คอม(?:แอร์)?|compressor\s*oil)(?:\s+.*)?$/iu,
    /^(?:น้ำยา\s*หล่อเย็น(?:\s*หม้อน้ำ)?|radiator\s*coolant|coolant)(?:\s+.*)?$/iu,
    /^(?:ใบ\s*พัดลม|fan\s*blade)(?:\s+.*)?$/iu,
  ].some((pattern) => pattern.test(partType));

const goldenCases = [
  // Confirmed vehicle-free subjects: HIGH may search without asking for a car.
  { confidence: "HIGH", partType: "น้ำยาแอร์", modelPartKind: "universal", action: "search_without_vehicle" },
  { confidence: "HIGH", partType: "น้ำยาแอร์ R32", modelPartKind: "universal", action: "search_without_vehicle" },
  { confidence: "HIGH", partType: "Refrigerant R134a", modelPartKind: "fitment", action: "search_without_vehicle" },
  { confidence: "HIGH", partType: "น้ำมันคอมแอร์", modelPartKind: "fitment", action: "search_without_vehicle" },
  { confidence: "HIGH", partType: "น้ำยาหล่อเย็นหม้อน้ำ", modelPartKind: null, action: "search_without_vehicle" },
  { confidence: "HIGH", partType: "ใบพัดลม 12 นิ้ว", modelPartKind: "fitment", action: "search_without_vehicle" },

  // A model claim of `universal` is not evidence. These production-like false
  // positives must retain the fitment gate and ask for a vehicle when incomplete.
  { confidence: "HIGH", partType: "หม้อน้ำ", modelPartKind: "universal", action: "use_fitment_gate" },
  { confidence: "HIGH", partType: "สายพานหน้าเครื่อง", modelPartKind: "universal", action: "use_fitment_gate" },
  { confidence: "HIGH", partType: "ตู้แอร์", modelPartKind: "universal", action: "use_fitment_gate" },
  { confidence: "HIGH", partType: "คอมแอร์", modelPartKind: "universal", action: "use_fitment_gate" },
  { confidence: "HIGH", partType: "สายน้ำยาแอร์", modelPartKind: "universal", action: "use_fitment_gate" },

  // Owner-confirmed confidence policy: all uncertain images go to an admin.
  { confidence: "MEDIUM", partType: "น้ำยาแอร์", modelPartKind: "universal", action: "handoff_admin" },
  { confidence: "LOW", partType: "น้ำยาแอร์", modelPartKind: "universal", action: "handoff_admin" },
  { confidence: "MEDIUM", partType: "คอมแอร์", modelPartKind: "fitment", action: "handoff_admin" },
  { confidence: "LOW", partType: null, modelPartKind: null, action: "handoff_admin" },
] as const;

test("golden: image confidence + vehicle-free policy never trusts model partKind alone", () => {
  const actual = goldenCases.map((input) => ({
    ...input,
    actual: resolveChatImageSearchPolicy(input).action,
  }));

  for (const result of actual) {
    assert.equal(
      result.actual,
      result.action,
      `${result.confidence} ${result.partType ?? "(unknown)"} model=${result.modelPartKind}`,
    );
  }
});

test("golden: the reviewed allow-list covers exactly the 21 production SKUs", () => {
  const skuCodes = safeCatalogGroups.flatMap((group) => [...group.skuCodes]);
  assert.equal(skuCodes.length, 21);
  assert.equal(new Set(skuCodes).size, 21);
  assert.deepEqual(
    [...safeProductionProducts.map((product) => product.code)].sort(),
    [...skuCodes].sort(),
    "every reviewed code has an exact production-name golden",
  );

  for (const product of safeProductionProducts) {
    assert.equal(isVehicleFreeChatPartType(product.name), true, `${product.code}: ${product.name}`);
  }

  for (const group of safeCatalogGroups) {
    for (const partType of group.samples) {
      assert.equal(isVehicleFreeChatPartType(partType), true, `${group.label}: ${partType}`);
      assert.equal(
        resolveChatImageSearchPolicy({ confidence: "HIGH", partType, modelPartKind: "fitment" }).action,
        "search_without_vehicle",
        `HIGH image: ${partType}`,
      );
      assert.equal(
        resolveChatGatePartKind({ partType, fallbackPartKind: "fitment" }),
        "universal",
        `text gate: ${partType}`,
      );
    }
  }
});

test("golden: all pre-existing vehicle-free products remain direct-searchable", () => {
  for (const partType of legacyVehicleFreeSamples) {
    assert.equal(isVehicleFreeChatPartType(partType), true, partType);
    assert.equal(
      resolveChatImageSearchPolicy({ confidence: "HIGH", partType, modelPartKind: null }).action,
      "search_without_vehicle",
      partType,
    );
  }
});

test("golden: near-name fitment products remain on the exact legacy fallback", () => {
  for (const partType of fitmentNegativeSamples) {
    assert.equal(isVehicleFreeChatPartType(partType), false, partType);
    assert.equal(
      resolveChatImageSearchPolicy({ confidence: "HIGH", partType, modelPartKind: "universal" }).action,
      "use_fitment_gate",
      `image must distrust model universal: ${partType}`,
    );
    assert.equal(
      resolveChatGatePartKind({ partType, fallbackPartKind: "fitment" }),
      "fitment",
      `fitment fallback unchanged: ${partType}`,
    );
    assert.equal(
      resolveChatGatePartKind({ partType, fallbackPartKind: "universal" }),
      "universal",
      `legacy universal fallback unchanged: ${partType}`,
    );
  }
});

test("golden: MEDIUM/LOW always hand off even for every reviewed safe group", () => {
  for (const group of safeCatalogGroups) {
    for (const partType of group.samples) {
      for (const confidence of ["MEDIUM", "LOW"] as const) {
        assert.equal(
          resolveChatImageSearchPolicy({ confidence, partType, modelPartKind: "universal" }).action,
          "handoff_admin",
          `${confidence}: ${partType}`,
        );
      }
    }
  }
});

test("golden score: candidate improves reviewed-safe recall and never regresses controls", () => {
  const addedSamples = safeCatalogGroups.flatMap((group) => [...group.samples]);
  const baselineAddedRecall = addedSamples.filter(baselineVehicleFreePartType).length;
  const candidateAddedRecall = addedSamples.filter(isVehicleFreeChatPartType).length;
  const baselineLegacyRecall = legacyVehicleFreeSamples.filter(baselineVehicleFreePartType).length;
  const candidateLegacyRecall = legacyVehicleFreeSamples.filter(isVehicleFreeChatPartType).length;
  const baselineFalsePositives = fitmentNegativeSamples.filter(baselineVehicleFreePartType).length;
  const candidateFalsePositives = fitmentNegativeSamples.filter(isVehicleFreeChatPartType).length;

  assert.equal(baselineAddedRecall, 0);
  assert.equal(candidateAddedRecall, addedSamples.length);
  assert.equal(candidateLegacyRecall, baselineLegacyRecall, "legacy recall must be at least unchanged");
  assert.ok(candidateAddedRecall > baselineAddedRecall, "reviewed-safe recall must improve");
  assert.ok(
    candidateFalsePositives <= baselineFalsePositives,
    "fitment false positives must be no worse than baseline",
  );
});
