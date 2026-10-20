import assert from "node:assert/strict";
import test from "node:test";

import { buildCarModelGroundingLookup, buildCarModelVariantLookup } from "@/lib/car-model-alias-cache";
import type { ChatReplyHistoryItem, ChatSearchIntent } from "@/lib/chat-core/ai-service";
import { guardChatSearchIntent } from "@/lib/chat-core/search-guards";
import {
  buildChatVehicleConfirmPrompt,
  buildChatVehicleMentionAskReply,
  isChatAffirmativeReply,
  isChatNegativeReply,
  parseChatVehicleConfirmPrompt,
  rankVehicleMentionClusters,
  resolveChatVehicleConfirmationReplay,
  vehicleModelCore,
  vehicleModelTypoDistance,
} from "@/lib/chat-core/vehicle-mention-conflict";
import {
  CAR_MODEL_SYNONYM_ROWS_2026_10_20,
  CAR_MODEL_SYNONYM_ROWS_WITH_CITY_FIX,
} from "@/lib/__tests__/fixtures/car-model-synonyms-2026-10-20";

// Golden tests for the vehicle-mention conflict check (incident 2026-10-20, LINE
// conv cmr39eesa): the customer asked "คอยเย็นซี๊ดตี้09" + "มีไหมคับ" (a Honda City
// 2009 evaporator). Gemini returned carModel "Fiesta" for "ซี๊ดตี้" (a rerun flips
// between City and Fiesta), the guard grounded the model only when a required token
// was present, and the customer was shown Mazda 2 / Ford Fiesta evaporators P0548 and
// P0056 although the shop stocks City 2008-2013 coils (P0053, P0894, P0919).
// Owner decisions 2026-10-20: ก add the City spellings to SearchSynonym, ข drop a
// model that contradicts the customer's car words and ask which car, ค when one
// model stands out ask "หมายถึง <car> ใช่ไหมคะ", continue with that car on "ใช่" and
// ask which car on "ไม่ใช่". LINE and Messenger share all of it.

const LIVE = {
  modelLookup: buildCarModelVariantLookup(CAR_MODEL_SYNONYM_ROWS_2026_10_20),
  modelGroundingLookup: buildCarModelGroundingLookup(CAR_MODEL_SYNONYM_ROWS_2026_10_20),
};
const WITH_CITY_FIX = {
  modelLookup: buildCarModelVariantLookup(CAR_MODEL_SYNONYM_ROWS_WITH_CITY_FIX),
  modelGroundingLookup: buildCarModelGroundingLookup(CAR_MODEL_SYNONYM_ROWS_WITH_CITY_FIX),
};

const intentOf = (fields: Partial<ChatSearchIntent>): ChatSearchIntent => ({
  group: "product",
  query: "",
  isProductQuery: true,
  partType: null,
  carBrand: null,
  carModel: null,
  carMentionInLatest: null,
  year: null,
  partKind: "fitment",
  tooBroad: false,
  ...fields,
});

const turns = (...items: Array<["c" | "s", string]>): ChatReplyHistoryItem[] =>
  items.map(([role, text]) => ({ role: role === "c" ? "customer" : "shop", text }));

const INCIDENT_LATEST = "คอยเย็นซี๊ดตี้09\nมีไหมคับ";
// What Gemini returned for the incident turn (audit INQUIRY_FRAME + a direct rerun).
const INCIDENT_INTENT = intentOf({
  query: "คอยเย็น ซี๊ดตี้ 2009",
  partType: "คอยเย็น",
  carBrand: "Ford",
  carModel: "Fiesta",
  carMentionInLatest: "ซี๊ดตี้",
  year: 2009,
});
const INCIDENT_REPLY =
  "มีคอยล์เย็นสำหรับรุ่นใกล้เคียงตามนี้เลยค่ะ 😊\n\n1️⃣ คอยล์เย็น Mazda 2  / Ford Fiesta  2009-2013 VALEO 560087";

test("golden ข+ค: the incident turn drops Fiesta, keeps part and year, and proposes City", () => {
  const guarded = guardChatSearchIntent({ intent: INCIDENT_INTENT, latestText: INCIDENT_LATEST, history: [], ...LIVE });

  assert.equal(guarded.intent?.carModel, null, "Fiesta has no basis in the customer's words");
  assert.equal(guarded.intent?.carBrand, null, "Ford was never typed either");
  assert.equal(guarded.intent?.year, 2009, "09 is the customer's year");
  assert.equal(guarded.intent?.partType, "คอยเย็น");
  assert.deepEqual(guarded.vehicleMentionConflict, {
    mention: "ซี๊ดตี้",
    classifierModel: "Fiesta",
    suggestion: { canonicalModel: "City", distance: 2 },
  });
  assert.equal(guarded.confirmedVehicle, null);
});

test("golden ก: with the City spellings added, the same misreading is corrected to City without asking", () => {
  const guarded = guardChatSearchIntent({
    intent: INCIDENT_INTENT,
    latestText: INCIDENT_LATEST,
    history: [],
    ...WITH_CITY_FIX,
  });

  assert.equal(guarded.intent?.carModel, "City");
  assert.equal(guarded.vehicleMentionConflict, null);
  assert.equal(guarded.forceLiteralQuery, true, "the classifier query still says Fiesta, so search the customer's text");
});

test("golden ค: the customer's \"ใช่\" replays the original question with the confirmed car", () => {
  const prompt = buildChatVehicleConfirmPrompt({ mention: "ซี๊ดตี้", vehicleLabel: "Honda City" });
  const history = turns(["c", "คอยเย็นซี๊ดตี้09"], ["c", "มีไหมคับ"], ["s", prompt]);

  const replay = resolveChatVehicleConfirmationReplay({ latestText: "ใช่คับ", history });
  assert.deepEqual(replay, {
    kind: "confirmed",
    mention: "ซี๊ดตี้",
    vehicleLabel: "Honda City",
    originalText: "คอยเย็นซี๊ดตี้09\nมีไหมคับ",
    replayText: "คอยเย็นซี๊ดตี้09\nมีไหมคับ\nHonda City",
  });

  // Gemini may repeat the misreading on the replayed text; the confirmed car wins.
  const guarded = guardChatSearchIntent({
    intent: INCIDENT_INTENT,
    latestText: replay?.replayText,
    history,
    ...LIVE,
    vehicleConfirmation: replay,
  });
  assert.equal(guarded.intent?.carModel, "City");
  assert.equal(guarded.intent?.carBrand, "Honda");
  assert.equal(guarded.intent?.year, 2009);
  assert.equal(guarded.vehicleMentionConflict, null);
  assert.deepEqual(guarded.confirmedVehicle, { carBrand: "Honda", carModel: "City" });
  assert.equal(guarded.forceLiteralQuery, true);
});

test("golden ค: a bare \"ไม่ใช่\" replays the question without a car and always asks which car", () => {
  const prompt = buildChatVehicleConfirmPrompt({ mention: "ซี๊ดตี้", vehicleLabel: "Honda City" });
  const history = turns(["c", "คอยเย็นซี๊ดตี้09"], ["c", "มีไหมคับ"], ["s", prompt]);

  const replay = resolveChatVehicleConfirmationReplay({ latestText: "ไม่ใช่ครับ", history });
  assert.deepEqual(replay, {
    kind: "rejected",
    mention: "ซี๊ดตี้",
    vehicleLabel: "Honda City",
    originalText: "คอยเย็นซี๊ดตี้09\nมีไหมคับ",
    replayText: "คอยเย็นซี๊ดตี้09\nมีไหมคับ",
  });

  // Whatever the classifier reads now — the old misreading, or the very car the shop
  // proposed — the customer has said no, so nothing is searched.
  for (const reading of [INCIDENT_INTENT, { ...INCIDENT_INTENT, carBrand: "Honda", carModel: "City", carMentionInLatest: null }]) {
    const guarded = guardChatSearchIntent({
      intent: reading,
      latestText: replay?.replayText,
      history,
      ...WITH_CITY_FIX,
      vehicleConfirmation: replay,
    });
    assert.equal(guarded.intent?.carModel, null, String(reading.carModel));
    assert.deepEqual(guarded.vehicleMentionConflict, {
      mention: "ซี๊ดตี้",
      classifierModel: reading.carModel,
      suggestion: null,
    });
    assert.equal(guarded.confirmedVehicle, null);
  }
});

test("golden ค: a confirmed label resolves through the synonym data, brand optional", () => {
  const confirm = (label: string) =>
    guardChatSearchIntent({
      intent: intentOf({ partType: "คอยเย็น", carModel: "Fiesta", carMentionInLatest: "x" }),
      latestText: `คอยเย็น\n${label}`,
      history: [],
      ...LIVE,
      vehicleConfirmation: { kind: "confirmed", mention: "x", vehicleLabel: label },
    }).confirmedVehicle;

  assert.deepEqual(confirm("Honda City"), { carBrand: "Honda", carModel: "City" });
  assert.deepEqual(confirm("City"), { carBrand: null, carModel: "City" });
  assert.deepEqual(confirm("Toyota Hilux Vigo"), { carBrand: "Toyota", carModel: "Hilux Vigo" });
  assert.deepEqual(confirm("Nissan March"), { carBrand: "Nissan", carModel: "March" });
});

test("golden ข: the 12:15 and 12:17 follow-ups (\"Stal\", a parts brand) ask which car instead of keeping Fiesta", () => {
  const history = turns(["c", "คอยเย็นซี๊ดตี้09"], ["c", "มีไหมคับ"], ["s", INCIDENT_REPLY]);
  for (const latest of ["Stal", "Stal\nส่งด้วยคับ"]) {
    const guarded = guardChatSearchIntent({
      intent: intentOf({ partType: "คอยล์เย็น", carModel: "Fiesta", carMentionInLatest: "Stal", year: 2009 }),
      latestText: latest,
      history,
      ...LIVE,
    });
    assert.equal(guarded.intent?.carModel, null, latest);
    assert.deepEqual(
      guarded.vehicleMentionConflict,
      { mention: "Stal", classifierModel: "Fiesta", suggestion: null },
      "the shop's own reply naming Fiesta is not the customer's evidence",
    );
  }
});

// Every production turn the shadow evaluator flagged NO_EVIDENCE between
// 2026-08-21 and 2026-10-20 (35 turns). Only the three incident turns may change;
// the other 32 are real models the customer typed (or carried from earlier turns)
// and must keep their model — this is why the shadow policy was never enforced.
type HistoricalTurn = {
  at: string;
  latest: string;
  history: ChatReplyHistoryItem[];
  model: string;
  mention: string | null;
  conflict: boolean;
};
const GREETING = "สวัสดีค่ะ ยินดีต้อนรับสู่ศรีวรรณอะไหล่แอร์นะคะ 😊";
const HISTORICAL: HistoricalTurn[] = [
  { at: "08-27 13:12", latest: "คอมแท้มาสด้า2ปี 2017 มีไหมคับ", history: [], model: "Mazda 2", mention: "มาสด้า 2", conflict: false },
  { at: "08-28 11:11a", latest: "สายกลางปาเจโร่บินซิน 2013", history: [], model: "Pajero", mention: "ปาเจโร่", conflict: false },
  { at: "08-28 11:11b", latest: "สายกลางปาเจโร่บินซิน 2013", history: [], model: "Pajero", mention: "ปาเจโร่", conflict: false },
  { at: "08-28 11:11c", latest: "สายกลางปาเจโร่บินซิน 2013", history: [], model: "Pajero", mention: "ปาเจโร่", conflict: false },
  {
    at: "08-28 16:01",
    latest: "วาวฉีดน้ำยามีด้วยไหมคับ\nด้วยคับ\nstal",
    history: turns(["c", "มีไหมคับ"], ["s", "จูนขอส่งเรื่องให้แอดมินช่วยเช็กของให้ชัวร์ก่อนนะคะ"], ["c", "ราคาคับ"], ["c", "เอาคนลูเกียร์"]),
    model: "Civic",
    mention: null,
    conflict: false,
  },
  { at: "08-30 12:27", latest: "คอยเย็นวรโก้", history: turns(["s", GREETING]), model: "Vigo", mention: "วรโก้", conflict: false },
  {
    at: "08-30 12:28a",
    latest: "คอยเย็นวีโก้",
    history: turns(["s", GREETING], ["c", "คอยเย็นวรโก้"], ["s", "รบกวนลูกค้ายืนยันยี่ห้อ/รุ่นรถอีกครั้งนะคะ"]),
    model: "Vigo",
    mention: "วีโก้",
    conflict: false,
  },
  {
    at: "08-30 12:28b",
    latest: "คอยเย็นวีโก้\nคอยเย็นรีโว่",
    history: turns(["s", GREETING], ["c", "คอยเย็นวรโก้"], ["s", "รบกวนลูกค้ายืนยันยี่ห้อ/รุ่นรถอีกครั้งนะคะ"]),
    model: "Vigo, Revo",
    mention: "วีโก้ คอยเย็นรีโว่",
    conflict: false,
  },
  {
    at: "09-03 10:20",
    latest: "ตัวมีบ่า",
    history: turns(["c", "มาสด้า3"], ["s", "จูนเห็นรูปคอมแอร์สำหรับ Mazda Mazda3 ที่ส่งมาแล้วนะคะ"]),
    model: "Mazda 3",
    mention: null,
    conflict: false,
  },
  {
    at: "09-03 10:22",
    latest: "ตัวมีบ่า\n1.6",
    history: turns(["c", "มาสด้า3"], ["s", "จูนเห็นรูปคอมแอร์สำหรับ Mazda Mazda3 ที่ส่งมาแล้วนะคะ"]),
    model: "Mazda 3",
    mention: null,
    conflict: false,
  },
  { at: "09-03 13:05", latest: "มาสด้า2\n2015", history: [], model: "Mazda 2", mention: "มาสด้า 2", conflict: false },
  {
    at: "09-03 13:12",
    latest: "ไดเออมีด้วยไหมคับ",
    history: turns(["c", "มาสด้า2"], ["c", "2015"], ["s", "สำหรับ Mazda 2 ปี 2015 เบื้องต้นในระบบยังไม่พบรายการที่ระบุปีนี้"]),
    model: "Mazda 2",
    mention: null,
    conflict: false,
  },
  {
    at: "09-03 13:35",
    latest: "มีไหมคับ",
    history: turns(["c", "มาสด้า2"], ["c", "2015"], ["s", "สำหรับ Mazda 2 ปี 2015"], ["c", "ไดเออมีด้วยไหมคับ"]),
    model: "Mazda 2",
    mention: null,
    conflict: false,
  },
  { at: "09-09 08:43", latest: "มาสด้า2", history: [], model: "Mazda 2", mention: "มาสด้า 2", conflict: false },
  {
    at: "09-09 08:55a",
    latest: "สกายคับ",
    history: turns(["c", "มาสด้า2"], ["s", "มาสด้า 2 มีหลายโฉมเลยค่ะ"]),
    model: "Mazda 2 Skyactiv",
    mention: "สกายคับ",
    conflict: false,
  },
  {
    at: "09-09 08:55b",
    latest: "สกายคับ\nใช่คับ",
    history: turns(["c", "มาสด้า2"], ["s", "มาสด้า 2 มีหลายโฉมเลยค่ะ"]),
    model: "Mazda 2 Skyactiv",
    mention: "สกายคับ",
    conflict: false,
  },
  { at: "09-09 10:19", latest: "แผงร้อนคับ\nมาสด้า2สกาย", history: [], model: "Mazda 2", mention: "มาสด้า 2 สกาย", conflict: false },
  {
    at: "09-09 10:20",
    latest: "แผงร้อนคับ\nมาสด้า2สกาย\nพร้อมไดเออร์ไหมคับ",
    history: [],
    model: "Mazda 2",
    mention: "มาสด้า 2 สกาย",
    conflict: false,
  },
  {
    at: "09-09 10:21",
    latest: "แผงร้อนคับ\nมาสด้า2สกาย\nพร้อมไดเออร์ไหมคับ\nบินซินคับ",
    history: [],
    model: "Mazda 2 Skyactiv",
    mention: "มาสด้า 2 สกาย",
    conflict: false,
  },
  { at: "09-10 10:17", latest: "คอยเย็นวีโก้", history: [], model: "Vigo", mention: "วีโก้", conflict: false },
  { at: "09-11 14:48", latest: "คอยเย็นอีซูซุเดก้า", history: [], model: "Deka", mention: "อีซูซุเดก้า", conflict: false },
  { at: "09-14 09:32", latest: "คอยเย็นโตโยต้ารีโว", history: [], model: "Revo", mention: "โตโยต้ารีโว", conflict: false },
  {
    at: "09-14 09:33",
    latest: "คอยร้อนรีโว",
    history: turns(["c", "คอยเย็นโตโยต้ารีโว"], ["s", "คอยล์เย็นสำหรับ Toyota Revo ทางร้านมีให้เลือกหลายเกรดเลยค่ะ"]),
    model: "Revo",
    mention: "รีโว",
    conflict: false,
  },
  {
    at: "09-14 09:39",
    latest: "หม้อน้ำรีโว",
    history: turns(
      ["c", "คอยเย็นโตโยต้ารีโว"],
      ["s", "คอยล์เย็นสำหรับ Toyota Revo ทางร้านมีให้เลือกหลายเกรดเลยค่ะ"],
      ["c", "คอยร้อนรีโว"],
      ["s", "แผงแอร์สำหรับ Toyota Revo ทางร้านมีรายการนี้ค่ะ"],
    ),
    model: "Revo",
    mention: "รีโว",
    conflict: false,
  },
  {
    at: "09-23 14:02",
    latest: "เป็นรถเครน Claler Crane 70ตันค่ะ IHI",
    history: turns(["s", GREETING], ["c", "ที่ร้านพอจะมี\nReceiver Drier,OEM-60mmx254mm ไหมคะ"], ["c", "หน้าตาน่าจะประมาณนี้ค่ะ"]),
    model: "Crawler Crane 70 ตัน",
    mention: "Claler Crane 70 ตันค่ะ IHI",
    conflict: false,
  },
  {
    at: "09-24 19:05",
    latest: "โบลเวอร์แอร์หลังนิสันเออแวนe26 มีไหมครับ",
    history: turns(["s", GREETING]),
    model: "Urvan E26",
    mention: "นิสันเออแวนe26",
    conflict: false,
  },
  {
    at: "09-24 19:07",
    latest: "โบลเวอร์แอร์ตู้หลังครับ",
    history: turns(
      ["s", GREETING],
      ["c", "โบลเวอร์แอร์หลังนิสันเออแวนe26 มีไหมครับ"],
      ["s", "โบลเวอร์แอร์ Nissan Urvan E26 มีรายการที่ใกล้เคียงในระบบค่ะ"],
    ),
    model: "Urvan E26",
    mention: null,
    conflict: false,
  },
  {
    // Location wording in this burst is replaced; only the car slots matter here.
    at: "09-29 21:47",
    latest: "ราคาพิเศษลดได้อีกเท่าไรครับ\nอยู่ต่างจังหวัดครับ\nเหลือเท่าไรครับ\nน่าจะมีคอมแอร์ รุ่นรถนี้ด้วย ช่วยส่งมาครับ",
    history: turns(["c", "เครื่อง2,500cc.ใช้ได้นะครับ"], ["s", "จูนขอส่งเรื่องให้แอดมินช่วยเช็กสินค้า"], ["c", "ครับ"], ["c", "อู่ครับ"]),
    model: "Camry",
    mention: null,
    conflict: false,
  },
  {
    at: "09-29 21:50",
    latest: "อยู่ต่างจังหวัดครับ\nเหลือเท่าไรครับ\nน่าจะมีคอมแอร์ รุ่นรถนี้ด้วย ช่วยส่งมาครับ\nลดเหลือเท่าไรครับ",
    history: turns(["s", "จูนขอส่งเรื่องให้แอดมินช่วยเช็กสินค้า"], ["c", "ครับ"], ["c", "อู่ครับ"], ["c", "ราคาพิเศษลดได้อีกเท่าไรครับ"]),
    model: "Camry",
    mention: null,
    conflict: false,
  },
  {
    // The classifier's mention ("สตาด้า") is not what the customer typed ("สต้าดา"),
    // so it is unverified and the check stays out of it.
    at: "10-03 11:31",
    latest: "ครับ\nไม่เอาครับ\nไดเออ ของ  สต้าดาครับ",
    history: turns(["c", "ครับขอบคุณมากครับ"], ["c", "น่าจะเป็น เดนโซน้ะคนับ"], ["c", "B ครัย"]),
    model: "สตาด้า",
    mention: "สตาด้า",
    conflict: false,
  },
  { at: "10-05 08:49", latest: "แผงคอยร้อนรีโว่ปี17", history: [], model: "Revo", mention: "รีโว่", conflict: false },
  {
    at: "10-07 08:55",
    latest: "คอมนิสสันมาสราคาคับ",
    history: turns(["c", "ติดต่อร้าน"], ["s", "🔧 ศรีวรรณ อะไหล่แอร์ ยินดีให้บริการค่ะ"]),
    model: "March",
    mention: "นิสสันมาส",
    conflict: false,
  },
  { at: "10-20 12:11", latest: INCIDENT_LATEST, history: [], model: "Fiesta", mention: "ซี๊ดตี้", conflict: true },
  {
    at: "10-20 12:15",
    latest: "Stal",
    history: turns(["c", "คอยเย็นซี๊ดตี้09"], ["c", "มีไหมคับ"], ["s", INCIDENT_REPLY]),
    model: "Fiesta",
    mention: "Stal",
    conflict: true,
  },
  {
    at: "10-20 12:17",
    latest: "Stal\nส่งด้วยคับ",
    history: turns(["c", "คอยเย็นซี๊ดตี้09"], ["c", "มีไหมคับ"], ["s", INCIDENT_REPLY]),
    model: "Fiesta",
    mention: "Stal",
    conflict: true,
  },
];

test("golden ข: replaying all 35 production NO_EVIDENCE turns changes only the three incident turns", () => {
  assert.equal(HISTORICAL.length, 35);
  for (const turn of HISTORICAL) {
    const guarded = guardChatSearchIntent({
      intent: intentOf({ query: turn.latest, carModel: turn.model, carMentionInLatest: turn.mention }),
      latestText: turn.latest,
      history: turn.history,
      ...LIVE,
    });
    if (turn.conflict) {
      assert.ok(guarded.vehicleMentionConflict, `${turn.at}: must ask instead of keeping ${turn.model}`);
      assert.equal(guarded.intent?.carModel, null, turn.at);
    } else {
      assert.equal(guarded.vehicleMentionConflict, null, `${turn.at}: ${turn.model} must stay`);
      assert.ok(guarded.intent?.carModel, `${turn.at}: model kept`);
    }
  }
});

test("golden ข: the check fails open whenever it cannot judge", () => {
  const run = (fields: Partial<ChatSearchIntent>, latest: string, lookups: Partial<typeof LIVE> = LIVE) =>
    guardChatSearchIntent({ intent: intentOf({ partType: "คอยเย็น", ...fields }), latestText: latest, history: [], ...lookups });

  // No synonym data (DB down / unit tests) → previous behaviour, Fiesta kept.
  const noData = run({ carModel: "Fiesta", carMentionInLatest: "ซี๊ดตี้" }, INCIDENT_LATEST, {});
  assert.equal(noData.intent?.carModel, "Fiesta");
  assert.equal(noData.vehicleMentionConflict, null);

  // A model with no known spellings cannot be contradicted.
  assert.equal(run({ carModel: "Odyssey", carMentionInLatest: "ออดิซี่" }, "กรองอากาศออดิซี่").intent?.carModel, "Odyssey");

  // Golf only has Latin spellings, so Thai "กอล์ฟ" says nothing about it.
  assert.equal(run({ carModel: "Golf", carMentionInLatest: "กอล์ฟ" }, "คอยเย็นกอล์ฟ").intent?.carModel, "Golf");

  // An LLM mention the customer never typed is ignored.
  assert.equal(run({ carModel: "Fiesta", carMentionInLatest: "ซี๊ดตี้" }, "คอยเย็น 09").intent?.carModel, "Fiesta");

  // With a required token the pre-existing rule already drops an ungrounded model.
  const anchored = run({ carModel: "Fiesta", carMentionInLatest: "ซี๊ดตี้" }, "คอยเย็นซี๊ดตี้ STE-1047");
  assert.equal(anchored.intent?.carModel, null);
  assert.equal(anchored.vehicleMentionConflict, null);
});

test("golden ข: typos of the classifier's own model, and models carried from history, are supported", () => {
  const run = (model: string, mention: string, latest: string, history: ChatReplyHistoryItem[] = []) =>
    guardChatSearchIntent({
      intent: intentOf({ partType: "แผงแอร์", carModel: model, carMentionInLatest: mention }),
      latestText: latest,
      history,
      ...LIVE,
    });

  assert.equal(run("Civic", "ซิวิค", "แผงแอร์ซิวิค").intent?.carModel, "Civic");
  assert.equal(run("Fiesta", "เฟียสต้", "แผงแอร์เฟียสต้").intent?.carModel, "Fiesta");
  assert.equal(run("Jazz", "แจ๊ด", "แผงแอร์แจ๊ด").intent?.carModel, "Jazz");
  assert.equal(run("March", "นิสสันมาส", "คอมนิสสันมาสราคาคับ").intent?.carModel, "March");
  // The car came from an earlier turn; a parts brand misread as a car changes nothing.
  assert.equal(
    run("Vigo", "Denso", "Denso", turns(["c", "คอยเย็นวีโก้"], ["s", "มีค่ะ"])).intent?.carModel,
    "Vigo",
  );
});

test("golden ข: a brand-only mention with an invented model asks for the model, keeping the brand", () => {
  const guarded = guardChatSearchIntent({
    intent: intentOf({ partType: "คอยเย็น", carBrand: "Toyota", carModel: "Vios", carMentionInLatest: "โตโยต้า" }),
    latestText: "คอยเย็นโตโยต้า",
    history: [],
    ...LIVE,
  });
  assert.equal(guarded.intent?.carModel, null);
  assert.equal(guarded.intent?.carBrand, "Toyota", "the brand the customer typed stays");
  assert.deepEqual(guarded.vehicleMentionConflict, { mention: "โตโยต้า", classifierModel: "Vios", suggestion: null });
});

test("golden ค: ranking the customer's car words against every known spelling", () => {
  const lookup = LIVE.modelGroundingLookup;
  const rank = (mention: string) => rankVehicleMentionClusters(mention, lookup);

  assert.deepEqual(rank("ซี๊ดตี้"), { keys: ["city"], distance: 2 });
  assert.deepEqual(rank("ซี๊ดตี้09"), { keys: ["city"], distance: 2 }, "digits are not part of the model");
  assert.deepEqual(rank("ฮอนด้าซี๊ดตี้"), { keys: ["city"], distance: 2 }, "the brand is not part of the model");
  assert.deepEqual(rank("นิสสันมาส"), { keys: ["march"], distance: 1 });
  assert.deepEqual(rank("เฟียสต้"), { keys: ["fiesta"], distance: 1 });
  assert.deepEqual(rank("วรโก้"), { keys: ["hilux vigo"], distance: 0 });
  assert.deepEqual(rank("รีโว่"), { keys: ["hilux revo"], distance: 0 }, "an exact Revo beats a two-edit Vigo");
  assert.deepEqual(rank("นิสันเออแวนe26"), { keys: ["urvan"], distance: 0 });
  assert.deepEqual(rank("มาสด้า 2 สกาย"), { keys: ["mazda2"], distance: 0 });
  // A shared spelling is a tie, never a single suggestion.
  assert.deepEqual(rank("ปาเจโร่"), { keys: ["pajero sport", "pajero"], distance: 0 });
  assert.deepEqual(rank("อัลติด"), { keys: ["corolla", "altis"], distance: 1 });
  // Nothing close: no suggestion.
  assert.equal(rank("Stal"), null);
  assert.equal(rank("สกายคับ"), null);
  assert.equal(rank("โตโยต้า"), null);
  assert.equal(rank("กอล์ฟ"), null);
});

test("golden ค: approximate comparison is whole-word and anchored on the first sounded letter", () => {
  assert.equal(vehicleModelCore("ฮอนด้าซี๊ดตี้09"), "ซีดตี");
  assert.equal(vehicleModelCore("นิสสันมาร์ช"), "มารช");
  assert.equal(vehicleModelCore("Honda City"), "city");

  assert.equal(vehicleModelTypoDistance("ซีดตี", "ซิตี"), 2);
  // A sliding window used to match these inside "ซีดตี"; the anchor rules them out.
  assert.equal(vehicleModelTypoDistance("ซีดตี", "ฟรีด"), null);
  assert.equal(vehicleModelTypoDistance("ซีดตี", "ทีดา"), null);
  assert.equal(vehicleModelTypoDistance("ซีดตี", "ไมตี"), null);
  // A Thai leading vowel is skipped when anchoring: เฟียส ≠ เซียส.
  assert.equal(vehicleModelTypoDistance("เฟียสต", "เซียส"), null);
  assert.equal(vehicleModelTypoDistance("เฟียสต", "เฟียสตา"), 1);
  // Three-letter Thai words get one edit; Latin follows the shared budget.
  assert.equal(vehicleModelTypoDistance("มาส", "มาช"), 1);
  assert.equal(vehicleModelTypoDistance("stal", "spin"), null);
});

test("golden ค: the confirmation question round-trips and nothing else parses as one", () => {
  const prompt = buildChatVehicleConfirmPrompt({ mention: "ซี๊ดตี้", vehicleLabel: "Honda City" });
  assert.equal(
    prompt,
    'จูนขอเช็กรุ่นรถให้ชัวร์ก่อนนะคะ 🙏 "ซี๊ดตี้" หมายถึง Honda City ใช่ไหมคะ\nถ้าใช่ ตอบ "ใช่" ได้เลยค่ะ ถ้าไม่ใช่ รบกวนพิมพ์ยี่ห้อ/รุ่นรถอีกครั้งนะคะ 🚗',
  );
  assert.deepEqual(parseChatVehicleConfirmPrompt(prompt), { mention: "ซี๊ดตี้", vehicleLabel: "Honda City" });
  assert.deepEqual(
    parseChatVehicleConfirmPrompt(buildChatVehicleConfirmPrompt({ mention: 'ซี๊ด"ตี้\n09', vehicleLabel: "Toyota Hilux Vigo" })),
    { mention: "ซี๊ด ตี้ 09", vehicleLabel: "Toyota Hilux Vigo" },
    "quotes and newlines in the customer's words cannot break the question",
  );
  assert.equal(parseChatVehicleConfirmPrompt(INCIDENT_REPLY), null);
  assert.equal(parseChatVehicleConfirmPrompt("หมายถึง Honda City ใช่ไหมคะ"), null);
  assert.equal(parseChatVehicleConfirmPrompt(null), null);

  assert.equal(
    buildChatVehicleMentionAskReply("Stal"),
    'จูนยังไม่แน่ใจว่า "Stal" หมายถึงรถรุ่นไหนค่ะ 🙏 รบกวนแจ้งยี่ห้อ/รุ่นรถอีกครั้งนะคะ (เช่น Honda City, Toyota Vios) จะได้หาอะไหล่ให้ตรงรุ่นค่ะ 🚗',
  );
});

test("golden ค: only a bare yes confirms the car and only a bare no rejects it", () => {
  const yes = ["ใช่", "ใช่คับ", "ใช่ครับผม", "ใช่ค่ะ", "ใช่ๆ", "ใช่แล้วครับ", "ครับ", "คับผม", "โอเคค่ะ 🙏", "ok", "Yes", "ถูกต้องครับ", "ใช้คับ", "ใช่\nครับ"];
  const no = ["ไม่ใช่", "ไม่ใช่ครับ", "ไม่ใช่คับผม", "ไม่ใช่รุ่นนี้ค่ะ", "ผิดครับ", "ไม่ครับ", "No", "ไม่ใช่\nครับ"];
  const neither = [
    "ไม่ใช่ครับ ซีวิค",
    "ใช่ครับ ซิตี้ 2009",
    "ใช้ได้ไหม",
    "ไม่เอาครับ",
    "Honda City",
    "มีไหมคับ",
    "Stal",
    "",
    "ใช่\nไม่ใช่",
  ];
  for (const text of yes) {
    assert.equal(isChatAffirmativeReply(text), true, text);
    assert.equal(isChatNegativeReply(text), false, text);
  }
  for (const text of no) {
    assert.equal(isChatNegativeReply(text), true, text);
    assert.equal(isChatAffirmativeReply(text), false, text);
  }
  for (const text of neither) {
    assert.equal(isChatAffirmativeReply(text), false, text);
    assert.equal(isChatNegativeReply(text), false, text);
  }
});

test("golden ค: the replay needs our question as the shop's last message and a yes after it", () => {
  const prompt = buildChatVehicleConfirmPrompt({ mention: "ซี๊ดตี้", vehicleLabel: "Honda City" });
  const asked = turns(["c", "คอยเย็นซี๊ดตี้09"], ["c", "มีไหมคับ"], ["s", prompt]);

  // Messenger stores the burst before replying, so the yes is already in history.
  assert.equal(
    resolveChatVehicleConfirmationReplay({ latestText: "ใช่คับ", history: [...asked, ...turns(["c", "ใช่คับ"])] })
      ?.replayText,
    "คอยเย็นซี๊ดตี้09\nมีไหมคับ\nHonda City",
  );
  // A no that names the right car, or a new question, goes through the normal pipeline.
  assert.equal(resolveChatVehicleConfirmationReplay({ latestText: "ไม่ใช่ครับ ซีวิค", history: asked }), null);
  assert.equal(resolveChatVehicleConfirmationReplay({ latestText: "ราคาเท่าไหร่ครับ", history: asked }), null);
  // Messenger keeps the burst in history: "ไม่ใช่" + a separate "ครับ" is still a no.
  assert.equal(
    resolveChatVehicleConfirmationReplay({ latestText: "ไม่ใช่\nครับ", history: [...asked, ...turns(["c", "ไม่ใช่"], ["c", "ครับ"])] })
      ?.kind,
    "rejected",
  );
  // A mixed burst ("ใช่" then "ไม่ใช่") is neither.
  assert.equal(
    resolveChatVehicleConfirmationReplay({ latestText: "ไม่ใช่", history: [...asked, ...turns(["c", "ใช่"])] }),
    null,
  );
  assert.equal(
    resolveChatVehicleConfirmationReplay({ latestText: "ใช่คับ", history: [...asked, ...turns(["c", "ซีวิคครับ"])] }),
    null,
  );
  // The shop's last message is something else (the bot already answered).
  assert.equal(
    resolveChatVehicleConfirmationReplay({ latestText: "ใช่คับ", history: [...asked, ...turns(["s", INCIDENT_REPLY])] }),
    null,
  );
  // Nothing to replay: the question has no customer message before it.
  assert.equal(resolveChatVehicleConfirmationReplay({ latestText: "ใช่", history: turns(["s", prompt]) }), null);
  // Image placeholders are not part of the replayed question.
  assert.equal(
    resolveChatVehicleConfirmationReplay({
      latestText: "ใช่",
      history: turns(["c", "[รูปภาพ]"], ["c", "คอยเย็นซี๊ดตี้09"], ["s", prompt]),
    })?.originalText,
    "คอยเย็นซี๊ดตี้09",
  );
});
