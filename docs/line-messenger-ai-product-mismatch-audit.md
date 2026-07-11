# LINE/Messenger AI — Product Mismatch Audit & Handoff

> เอกสารส่งต่องาน (AI handoff) — บันทึกความเสี่ยงที่ AI แชท (LINE + Facebook Messenger)
> อาจ **ส่งสินค้ามั่ว / ผิดหมวด / ไม่ตรงสิ่งที่ลูกค้าค้นหา** พร้อมจุดโค้ด สาเหตุ และข้อเสนอแก้
>
> **ธงของเจ้าของงาน:** ห้ามส่งคำตอบมั่ว — ถ้าไม่มั่นใจให้ส่งเรื่องต่อแอดมินเท่านั้น
>
> สถานะเอกสาร: **แก้ข้อ A + F + G1/G2 + Fix1/Fix2 + D + Relevance Gate (เคส 🔴1/2/3) แล้ว** (2026-07-11) · C, E ยังรอทำ (ดู §5)
> วันที่บันทึก: 2026-07-10 · ผู้ตรวจ: Claude (Fable 5) · อัปเดต: 2026-07-11 (Claude Opus 4.8)

---

## 0. อ่านตรงนี้ก่อน (สำหรับ AI ที่มารับงานต่อ)

- งานนี้เป็น **investigation-only** จนกว่าเจ้าของจะสั่งแก้ (`แก้เลย` / `ทำ A` / `implement`)
- ห้ามแก้ business logic ค้นหา/สต๊อก/ราคา จนกว่าจะยืนยัน — ดู `.rules` §0, §8
- โค้ดที่เกี่ยวข้องทั้งหมดอยู่ใน `lib/chat-core/*` (สมองร่วม LINE+Messenger), `lib/line-webhook-processor.ts`, `lib/messenger/messenger-webhook-processor.ts`, `lib/product-search.ts` (engine ค้นหา ใช้ร่วมกับ storefront)
- **สำคัญ:** `product-search.ts` ใช้ร่วมกับหน้าเว็บ storefront ด้วย — การแก้ที่ engine กระทบหน้าเว็บ ให้เลี่ยงถ้าทำที่ชั้นแชทได้
- test รันด้วย `npx tsx --test <file>` (ไม่มี `npm test`) — `mock.module` ใช้ไม่ได้ใน env นี้ (test `messenger-webhook-processor.test.ts` จะ fail ที่ env นี้เป็นปกติ ไม่เกี่ยวกับโค้ด)

---

## 1. บริบท: งานรอบก่อนที่ทำไปแล้ว (commit `577eaa5`)

รอบก่อนปิดช่อง "ตอบมั่ว" ไป 6 ข้อ (ข้อ 2–7 ของ audit เดิม) — **แก้แล้ว merge เข้า main แล้ว**:

1. **Evidence-ground ยี่ห้อ+ปี ทุกเทิร์น** ([search-guards.ts](../lib/chat-core/search-guards.ts) `guardChatSearchIntent`) — กัน classifier hallucinate รถ/ปี. **โมเดล** ground เฉพาะเมื่อมี numeric anchor (transliteration ไทย↔อังกฤษ "วีโก้"↔"Vigo" ไม่มีใน evidence data → ground เสมอจะ drop โมเดลจริง)
2. **did-you-mean transparency note** ([search-gate.ts](../lib/chat-core/search-gate.ts) `buildDidYouMeanNote`, [product-search-bridge.ts](../lib/chat-core/product-search-bridge.ts) field `didYouMean`)
3. **Image confidence gating** — frame รับ vision เฉพาะ HIGH, LOW ไม่ป้อน searchHints
4. **FAQ ไม่กลบ escalation** + ไม่เรียก FAQ กับ product turn ที่ frame มี partType
5. **matchedButNoneShowable** (total>0 แต่ไม่มี summary) → handoff+notify
6. **price tier fail → UNKNOWN** ("สอบถามราคา") ไม่ default retail
7. **แปลง พ.ศ.→ค.ศ. ก่อนค้น** ([car-year-shorthand.ts](../lib/car-year-shorthand.ts) `toGregorianCarYear`, ใช้ใน `cleanIntentYear`/image `cleanYear`)

**งานรอบนี้ (เอกสารนี้) เป็นคนละมิติ**: ไม่ใช่ "ข้อความตอบมั่ว" แต่เป็น **"สินค้าที่ค้นเจอ/โชว์ ผิดหมวดหรือผิดสิ่งที่หา"** — คือ engine ค้นหาคืนของผิด แล้วชั้นแชทเอามาโชว์ตรง ๆ

---

## 2. แก่นของปัญหา

**อันตรายทั้งหมดกระจุกที่ "เทิร์นที่ resolve หมวด (categoryName) ไม่ได้"**

- เมื่อ `resolveChatFitmentFilters` ([fitment-resolve.ts](../lib/chat-core/fitment-resolve.ts)) แปลงคำอะไหล่เป็น `categoryName` **ได้** → เป็น **hard filter** (`AND psd.category_name = X` ที่ [product-search.ts:1076](../lib/product-search.ts)) คาไว้ทั้ง primary + OR fallback → **ปลอดภัย ไม่หลุดหมวด**
- เมื่อ `categoryName = null` → **ไม่มี category filter เลย** → มี 3 กลไกใน engine ดึงของนอกหมวดขึ้นมา และ **ชั้นแชทไม่มี relevance gate** → top-5 อะไรก็โชว์หมด

**จุดร่วมที่ทำให้หลุดถึงลูกค้า:** `searchChatProductInquiry` คืน `result.ids` ตรง ๆ → processor เอา `getChatProductSummaries(ids)` มาโชว์ **โดยไม่เช็คว่า match แข็งพอไหม / หมวดตรงไหม**

**เมื่อไหร่ categoryName ถึง null:**
- คำอะไหล่สะกดผิด/ไม่รู้จัก ไม่อยู่ใน CategoryAlias/dictionary (LLM fallback ช่วยได้บางเคสบน LINE text เท่านั้น)
- ค้นจาก image hint ที่ partType เป็น generic ("อะไหล่แอร์…")
- universal/accessory (น้ำยา/น็อต/โอริง)
- อะไหล่จริงที่ยังไม่มี alias หมวด
- **เทิร์นที่ลูกค้ายังไม่บอกชนิดอะไหล่เลย** (gate rule 2: รถ+ปี ไม่มี part)

---

## 3. เคสเสี่ยง (เรียงตามความรุนแรง)

> **อัปเดต 2026-07-11:** เคส 🔴1/2/3 **ถูกปิดที่ชั้นแชทแล้ว**ด้วย Relevance Gate (ดู §9 changelog) — engine ยังคืนของหลวม ๆ เหมือนเดิม แต่ processor ไม่โชว์เมื่อ `categoryName=null` และ match ไม่แข็งพอ (ส่งแอดมินแทน). ยังไม่แตะ engine → storefront เดิม.

### 🔴 1. ไม่มี relevance floor — ตัดแค่ `score > 0`
- **จุด:** [product-search.ts:1506](../lib/product-search.ts) `WHERE ranked.score > 0`
- **กลไก:** คะแนน trigram ให้แต้มแม้ similarity ต่ำ ~0.12 ([product-search.ts:1477](../lib/product-search.ts)) → ของเกี่ยวหลวม ๆ ได้ score>0 → ถ้าไม่มีของตรงกว่าก็ติด top-5
- **ผล:** ลูกค้าถามของที่ร้านไม่มี ระบบดัน "ของใกล้เคียงคนละอย่าง" มาโชว์อย่างมั่นใจ
- **confidence:** ยืนยันได้ (โครงสร้าง query ไม่มีเกณฑ์คะแนนขั้นต่ำก่อนโชว์)

### 🔴 2. Broad OR fallback ดึงของที่ตรงแค่ครึ่งเดียว
- **จุด:** [product-search.ts:1581-1589](../lib/product-search.ts)
- **กลไก:** AND query (part & car) = 0 → retry ด้วย OR → ของที่ match **แค่รถ** หรือ **แค่ชนิดอะไหล่** ก็ผ่าน
- **เคส:** "คอมแอร์ vios" ไม่มีตรง → OR → โชว์ **หม้อน้ำ Vios** (match แค่ "vios") หรือ **คอมแอร์รถรุ่นอื่น** (match แค่ "คอมแอร์")
- **ซ้ำร้าย:** bridge did-you-mean ตัดปีทิ้งเพิ่ม (มี note แจ้งแล้วรอบก่อน แต่ OR fallback ของ engine เองยังไม่มี note)
- **confidence:** ยืนยันได้

### 🔴 3. Vector semantic recall ดึงของที่ "ไม่ match ตัวอักษรเลย"
- **จุด:** [product-search.ts:1395](../lib/product-search.ts) `OR v.product_id IS NOT NULL` + score `sim * 500` ([product-search.ts:1397](../lib/product-search.ts))
- **กลไก:** top-100 เพื่อนบ้านใกล้สุดด้วย embedding เข้าชุด ranked แม้ไม่มี token ตรง ถ้า categoryName null ไม่มีอะไรกัน "ใกล้เชิงความหมายแต่ผิดตัว" คะแนน vector สูงพอจะขึ้น top-5
- **ผล:** มั่วแบบดูสมเหตุสมผล — อันตรายกับแชทที่โชว์มั่นใจ
- **confidence:** ยืนยันได้ (โครงสร้าง candidate admission)

### 🟠 4. Gate rule 2 (รถ+ปี ไม่มีชนิดอะไหล่) → โชว์อะไหล่คละของรถรุ่นนั้น
- **จุด:** [search-gate.ts:49-51](../lib/chat-core/search-gate.ts) (`CAR_PLUS_YEAR` → action search) → ค้นโดย categoryName null + ไม่มี part anchor
- **กลไก:** ลูกค้าบอกแค่ "Vios 2015" ยังไม่บอกเอาอะไหล่อะไร → gate ให้ search → engine คืนอะไหล่อะไรก็ได้ของ Vios เรียง score → โชว์ พร้อม follow-up ถามชนิดทีหลัง
- **หมายเหตุ:** `unresolvedFitmentPartHeadNoun` (anchor กันดริฟท์) ไม่ทำงานเพราะ partType null
- **confidence:** ยืนยันได้ — **แต่เป็น decision ที่เคยคอนเฟิร์มกับเจ้าของร้าน** (decision ก) ต้องถามก่อนเปลี่ยน

### 🟠 5. หมวด resolve "ผิด" → hard filter ผิด (ดูแม่นแต่ผิด)
- **จุด:** [fitment-resolve.ts:195-232](../lib/chat-core/fitment-resolve.ts) `PART_TYPE_CATEGORY_ALIASES` (substring first-hit)
- **กลไก:**
  - (a) ลำดับ alias สำคัญมาก — มี comment เตือน fan-motor vs condenser เอง; คำที่เป็น substring ของ alias ผิดจะ route ผิด
  - (b) สมมติฐาน hardcode "ร้านไม่มี thermostat → วาล์ว = expansion valve เสมอ" ([fitment-resolve.ts:200-205](../lib/chat-core/fitment-resolve.ts)) — พังทันทีถ้าเพิ่มสินค้า thermostat/วาล์วน้ำ
  - (c) `matchDbCategoryAlias` MATCH ที่แอดมิน approve ผิด → หมวดผิด
- **ผล:** แย่กว่าไม่มีหมวด เพราะ hard filter ทำให้ "ดูตรงเป๊ะ" แต่หมวดผิด
- **confidence:** น่าจะ (โครงสร้างเสี่ยง; ยังไม่ replay เคสจริง)

### 🟡 6. accessory anchor broaden-on-empty แล้วดริฟท์
- **จุด:** [product-search-bridge.ts:347-360](../lib/chat-core/product-search-bridge.ts)
- **กลไก:** accessory (categoryName null) ค้นด้วย head-noun anchor แล้ว 0 → drop anchor → ค้น free-text กว้าง → คืน accessory อื่นที่แชร์ token → โชว์ผิดชิ้น (comment ยอมรับ "worst case = พฤติกรรมเดิม" = การดริฟท์)
- **confidence:** ยืนยันได้ (แต่ผลกระทบจำกัดเฉพาะ accessory)

### 🟡 7. model resolve แบบ contains over-match
- **จุด:** [fitment-resolve.ts:432-439](../lib/chat-core/fitment-resolve.ts) fallback `contains`
- **กลไก:** carModel "3" → contains-match "323"/"CX-3"; "2" → หลายรุ่น → อาจปักรถผิดเป็น hard filter (โอกาสต่ำเพราะ scope ด้วย brand แต่มีช่อง)
- **confidence:** น่าจะ

---

## 4. จุดสำคัญที่ต้องเข้าใจก่อนแก้

- **categoryName เป็น hard filter ที่แข็งและปลอดภัย** — คาไว้ทั้ง primary + OR fallback (`exactScope` [product-search.ts:1252-1272](../lib/product-search.ts) ใช้ร่วมกันทั้งสอง path) ดังนั้น "หมวด resolve ได้" = ปลอดภัย, "หมวด resolve ไม่ได้" = อันตราย
- **`searchChatProductInquiry` คืน `result` ที่มี `mode` ("v2"/"fallback"), `matchReasons`, `total`, `reason` อยู่แล้ว** แต่ bridge/processor **ยังไม่ได้ใช้ข้อมูลเหล่านี้กรอง** — คือ data พร้อมทำ relevance gate แล้ว แค่ยังไม่มีตัวกรอง
- `matchReasons` (code/oem/name/keyword/fitment/year) = สัญญาณว่า match แข็งแค่ไหน — ใช้เป็นเกณฑ์ gate ได้ ([product-search.ts:1688-1701](../lib/product-search.ts))

---

## 5. ข้อเสนอแก้ (รอยืนยัน — ยังไม่ทำ)

| # | ข้อเสนอ | แก้เคส | ทำที่ไหน | ความเสี่ยง |
|---|---------|--------|----------|-----------|
| **A** ✅ | **Vehicle-unresolved gate (ทำแล้ว 2026-07-11)**: carModel grounded แต่ไม่กลายเป็น hard filter (carModelName/carBrandName ว่าง) + มีผลจะโชว์ → ไม่โชว์การ์ด, ถามยืนยันรุ่นรถ + ส่งแอดมิน | 1,2,3 | processor (ไม่แตะ engine → ไม่กระทบ storefront) | recall ลดในเคสก้ำกึ่ง (ตรงธง) |
| **F** ✅ | **Model synonym grounding (ทำแล้ว 2026-07-11)**: ground "สตาด้า"↔"Strada" ผ่าน `SearchSynonym` ใน `guardChatSearchIntent` เพื่อไม่ให้รุ่นที่ลูกค้าพิมพ์ไทยถูกทิ้ง | ต้นเหตุ Strada | search-guards + processor | over-ground ต่ำ (lookup เฉพาะรุ่น) |
| **B** | **categoryName null ต้องมี part-anchor เสมอ**: ขยาย `fitmentPartHeadNoun` ให้ครอบ image-hint/generic; ถ้าไม่มี part ระบุ (gate rule 2) → ไม่ค้น/ถามชนิดก่อน | 2,4,6 | search-gate + processor | **decision ก (โชว์ของรถให้ดูก่อน) หายไป — ต้องถามเจ้าของร้าน** |
| **C** | จำกัด vector recall เมื่อ categoryName null (ปิด vectorCandidate หรือ require แต้ม lexical ควบ) | 3 | engine (กระทบ storefront — ระวัง) | semantic recall แคบลงตอนไม่มีหมวด |
| **D** ✅ | **OR-fallback near-match note (ทำแล้ว 2026-07-11)**: แจ้ง note "รายการใกล้เคียง อาจไม่ตรงทั้งหมด" เมื่อผลมาจาก broad OR recall | 2 | engine (flag additive) + bridge + processor | เพิ่มความโปร่งใส ไม่กระทบ ranking/logic/storefront |
| **E** | ลบสมมติฐาน hardcode "ไม่มี thermostat" → ย้ายไป DB CategoryAlias ล้วน + review ลำดับ `PART_TYPE_CATEGORY_ALIASES` | 5 | fitment-resolve | ต้องเช็คว่ามีสินค้า thermostat/วาล์วน้ำ ในระบบหรือยัง |

### คำแนะนำลำดับ
1. **A + B ก่อน** — ตรงธง "ไม่มั่นใจส่งแอดมิน" ที่สุด ปิดเคส 🔴 ที่ต้นทาง (แทนไล่ปิดทีละกลไกใน engine ที่กระทบ storefront)
2. A ทำที่ bridge/processor อย่างเดียว → ไม่กระทบหน้าเว็บ
3. D ทำง่าย เพิ่มความโปร่งใส
4. C, E ทำทีหลัง (กระทบ storefront / ต้องเช็คข้อมูล master)

---

## 6. คำถามที่ต้องเคลียร์ก่อนลงมือ (blockers)

1. **Gate rule 2** — จะเปลี่ยนจาก "โชว์อะไหล่ของรถให้ดูก่อน" เป็น "ถามชนิดอะไหล่ก่อน" ได้ไหม? (decision ก เคยคอนเฟิร์มไว้ — ต้องเจ้าของร้านยืนยัน) → กระทบข้อ B
2. ~~**มีสินค้า thermostat / วาล์วน้ำ ในระบบหรือยัง?**~~ → **เจ้าของยืนยัน 2026-07-11: ยังไม่มี** → ข้อ E ยังไม่เร่งด่วน (hardcode ยังถูกต้องอยู่ตอนนี้ แต่ต้องทำทันทีเมื่อจะเพิ่มสินค้ากลุ่มนี้)
3. **relevance gate ของข้อ A** — เกณฑ์ "match แข็ง" ควรเข้มแค่ไหน? (เช่น ต้องมี fitment/name-exact เสมอ หรือยอม trigram สูง ๆ ได้)

---

## 7. วิธีตรวจ/ยืนยันเพิ่ม (ก่อนหรือระหว่างแก้)

- **Replay จาก audit log:** ตาราง `LineAiAuditLog` action `PRODUCT_SEARCH_SUMMARY` (มี `searched`, `total`, `query`) + `SEARCH_QUERY_CONSOLIDATED` (มี `categoryName`, filters) → หาเคสจริงที่ `categoryName=null` แล้ว `total>0` = เคสเสี่ยงจริง
  - repo helper: `countConsecutiveFailedLineSearches` อ่าน audit นี้อยู่แล้ว ([line-conversation-repository.ts:219](../lib/line-conversation-repository.ts))
- **ดู mode="fallback" หรือ reason ขึ้นต้น "DID_YOU_MEAN"** = ผลมาจาก OR/สะกดใหม่ = กลุ่มเสี่ยง
- Test ที่เกี่ยวข้อง: `lib/__tests__/line-product-search-bridge.test.ts`, `line-search-gate.test.ts`, `line-fitment-resolve.test.ts`, `line-webhook-processor.test.ts`

---

## 8. ไฟล์อ้างอิงหลัก

| ไฟล์ | บทบาท |
|------|-------|
| [lib/product-search.ts](../lib/product-search.ts) | Engine ค้นหาจริง (ใช้ร่วม storefront) — ranked query, OR fallback, vector recall, score>0 |
| [lib/chat-core/product-search-bridge.ts](../lib/chat-core/product-search-bridge.ts) | สะพานแชท→engine: buildSearchQuery, requiredTokens, head-noun anchors, did-you-mean, applyChatPriceTier |
| [lib/chat-core/fitment-resolve.ts](../lib/chat-core/fitment-resolve.ts) | แปลงคำอะไหล่/รถ → categoryName/brand/model (master data) — จุด resolve หมวด |
| [lib/chat-core/search-gate.ts](../lib/chat-core/search-gate.ts) | completeness gate (part/car/year พอค้นไหม), gate rule 2 |
| [lib/chat-core/search-guards.ts](../lib/chat-core/search-guards.ts) | evidence grounding brand/model/year |
| [lib/line-webhook-processor.ts](../lib/line-webhook-processor.ts) | pipeline LINE (frame, forced-response chain, handoff) |
| [lib/messenger/messenger-webhook-processor.ts](../lib/messenger/messenger-webhook-processor.ts) | pipeline Messenger (parity) |
| [docs/line-oa-ai-agent-runbook.md](line-oa-ai-agent-runbook.md) | runbook LINE OA เดิม |

---

## 9. Changelog เอกสาร
- 2026-07-10: สร้างเอกสาร — audit ความเสี่ยงสินค้ามั่ว/ผิดหมวด 7 เคส + ข้อเสนอ A–E (ยังไม่แก้)
- 2026-07-11: **แก้ข้อ A + เพิ่มข้อ F** (เคสจริง "สายแอร์ใหญ่สตาด้า2500" → ขึ้น D-Max/Revo/Colorado)
  - **สาเหตุจริง (replay audit log):** classifier ได้ carModel "Strada" แต่ evidence-grounding ทิ้งเพราะ "สตาด้า" (ไทย) ไม่ match "Strada" (อังกฤษ) — transliteration ไม่อยู่ใน evidence data. เหลือ hard filter แค่หมวด A/C Hose + requiredToken "2500" (ซีซี) → คืนสายแอร์รถรุ่นอื่นที่มีรุ่น 2500cc. **มาสเตอร์มี CarModel Strada + SearchSynonym "สตาด้า"→Strada ครบ** — จุดพังอยู่ที่ grounding ต้นน้ำ ไม่ใช่ข้อมูลขาด
  - **F (model synonym grounding):** ใหม่ `lib/car-model-alias-cache.ts` + `lib/car-model-alias-loader.ts` (โหลด `SearchSynonym` แบบ cache) → ส่ง `modelLookup` เข้า `guardChatSearchIntent` ([search-guards.ts](../lib/chat-core/search-guards.ts) `lineModelHasCustomerSynonymEvidence`) เพื่อ ground "สตาด้า"→"Strada". wire ทั้ง LINE + Messenger processor
  - **A (vehicle-unresolved gate):** เมื่อ carModel grounded แต่ resolve เป็น hard filter ไม่ได้ (carModelName/carBrandName ว่าง) + มีผลลัพธ์จะโชว์ → ไม่โชว์การ์ด, ตอบ `CHAT_VEHICLE_UNRESOLVED_HANDOFF_REPLY` (ยืนยันรุ่นรถ) + ส่งแอดมิน. audit `AI_VEHICLE_UNRESOLVED_HANDOFF`. ทำทั้ง LINE ([line-webhook-processor.ts](../lib/line-webhook-processor.ts)) + Messenger ([messenger-webhook-processor.ts](../lib/messenger/messenger-webhook-processor.ts))
  - **ไม่แตะ engine `product-search.ts`** → ไม่กระทบ storefront. Test: `line-search-guards.test.ts` (Strada grounding), `car-model-alias-cache.test.ts`, `line-webhook-processor.test.ts` (Strada gate end-to-end)
  - **ยังไม่ทำ:** C (จำกัด vector recall), D (note OR-fallback), E (ลบ hardcode thermostat)
- 2026-07-11: **แก้ข้อ G1 + G2** (เคสจริง "อะไหล่แอร์ สิบล้อ HINO ISUZU" → ตอบสายแอร์ D-Max กระบะ — เทิร์นถัดจาก Strada)
  - **สาเหตุจริง (replay `LineAiAuditLog` conv `cmq4ziq6l…`):** classifier เทิร์นนี้ `partType=null` → inquiry-frame **carry "สายแอร์" + หมวด A/C Hose** จากเทิร์นก่อน → completeness gate ([line-webhook-processor.ts](../lib/line-webhook-processor.ts)) ตัดสินจาก **frame partType** ("สายแอร์" ไม่กว้าง) ไม่ใช่ข้อความลูกค้าจริง ("อะไหล่แอร์ สิบล้อ") → ค้น + hard-filter หมวดเดิม → คืน D-Max (กระบะ) ให้คำถามรถสิบล้อ. คนละบั๊กกับ A+F (frame-level ไม่ใช่ model-resolution)
  - **G1 (broad-gate อ่านข้อความจริง):** gate เช็ค `isBroadChatPartType(consolidatedQuery ‖ processText)` เพิ่มจากเดิมที่อ่านแค่ frame partType → เทิร์นกว้างบังคับ BROAD_PART_TYPE handoff แม้ frame carry part เฉพาะ. **LINE-only** (Messenger มี `isBroadChatPartType(processText)` ใน `resolveMessengerFitmentHints` อยู่แล้ว = parity)
  - **G2 เล็ก (decision เจ้าของ: ความกว้างมาก่อน + คำเชื่อมคง frame):** เทิร์นใหม่ระบุ**คลาสรถ** (สิบล้อ/รถบรรทุก/เทรลเลอร์) + ไม่มี part ใหม่ + ไม่มีคำเชื่อม (แล้ว/และ/หรือ/…ล่ะ) → drop partType เดิม ไม่ให้หมวดเดิม hard-filter → gate ถามชนิดอะไหล่. helper `namesVehicleClassTerm` / `hasFollowUpConnective` ([inquiry-frame.ts](../lib/chat-core/inquiry-frame.ts)), audit `droppedCarriedPartOnVehicleClassSwitch`. **LINE-only** (Messenger ไม่มี frame). คำเชื่อม → คง frame (follow-up จริง เช่น "แล้ว Vigo ล่ะ"); ความกว้างชนะเสมอ (G1 จับก่อน)
  - **ไม่แตะ engine `product-search.ts`.** Test: `line-inquiry-frame.test.ts`, `line-webhook-processor.test.ts` (G1 broad-after-specific + G2 drop/keep)
- 2026-07-11: **แก้ Fix 1 + Fix 2** (เคสจริง "คอล์ยเย็นนิสสันมาร์ค" — LINE ถามชนิดอะไหล่ซ้ำทั้งที่ลูกค้าพิมพ์มาแล้ว)
  - **สาเหตุจริง (replay `LineAiAuditLog` conv `cmr2xbf16…`):** classifier **แก้ typo สำเร็จ** (`classifierPartType="คอยล์เย็น"`) แต่ `groundedLatestPartType` ([line-webhook-processor.ts](../lib/line-webhook-processor.ts)) โยนทิ้ง → frame `partType=null` → gate `CAR_ONLY` → ถามชนิดอะไหล่ + search ถูกบล็อกก่อน LLM category fallback ทำงาน. 2 ชั้น: (1) gate ไม่เช็ค `sessionStale` → frame เก่า 9 วันเปิด gate ทั้งที่เป็น session ใหม่; (2) evidence check เอาคำที่แก้ถูก ("คอยล์เย็น") เทียบ substring กับข้อความพิมพ์ผิด ("คอล์ย") → ไม่เจอ → drop
  - **หลักการ (เจ้าของสั่ง):** ก่อนตัด partType ต้องผ่าน resolve/LLM/process ก่อน — หาก map สำเร็จต้องโชว์สินค้า ไม่ใช่ตัดทิ้งแล้วถามซ้ำ
  - **Fix 1:** เพิ่มเงื่อนไข `!sessionStale` — session ใหม่ไม่มี part เก่าให้ปกป้อง → เชื่อ partType ที่ classifier แก้มา
  - **Fix 2:** `lineValueHasCustomerTypoEvidence` ([search-guards.ts](../lib/chat-core/search-guards.ts)) — Damerau-OSA distance + sliding window บน glued Thai → typo ของ partType ("คอล์ย"↔"คอยล์") นับเป็น evidence → ไม่ตัด → ปล่อยไป resolve + ค้น + โชว์. hallucination guard เดิม (รถล้วน ไม่มีคำอะไหล่ → ไม่มี literal+typo evidence) ยังทำงาน
  - **ไม่แตะ engine.** Test: `line-search-guards.test.ts` (typo/hallucination), `line-webhook-processor.test.ts` (Fix1 stale keep+search, Fix2 live typo keep, hallucination guard เดิมยังผ่าน)
- 2026-07-11: **แก้ข้อ D (OR-fallback near-match note)**
  - **แก้ความเข้าใจผิดในเอกสารเดิม:** สมมติฐานว่า "`mode`/`reason` บอกว่าผลมาจาก OR fallback ได้" **ไม่จริง** — `searchProductIdsV2` คืน `mode:"v2"` เสมอ ([product-search.ts:1619](../lib/product-search.ts)) ไม่ว่า broad OR ([:1581](../lib/product-search.ts)) จะยิงหรือไม่. ส่วน `mode:"fallback"` ([:862](../lib/product-search.ts)) คือ legacy Prisma path คนละเรื่อง → engine เดิม**ไม่มีสัญญาณ**บอก caller ว่า OR fallback ทำงาน
  - **แก้:** เพิ่ม field additive `usedBroadFallback?: boolean` ใน `ProductSearchResult` — set `true` เฉพาะเมื่อ precise AND = 0 แล้ว broad OR คืนแถวจริง. **ไม่กระทบ ranking/filtering** (แค่ field ใหม่ storefront เพิกเฉยได้) → ปลอดภัยกับหน้าเว็บ
  - **bridge:** เพิ่ม field เดียวกันใน `ProductSearchOutput` (DI boundary) → `productSearch.result.usedBroadFallback` ถึง processor
  - **processor:** note ใหม่ `BROAD_FALLBACK_NEAR_MATCH_NOTE` ([search-gate.ts](../lib/chat-core/search-gate.ts), shared) — วางในลำดับ note ใต้ did-you-mean (เจาะจงกว่า) เหนือ search follow-up. ทำทั้ง LINE ([line-webhook-processor.ts](../lib/line-webhook-processor.ts)) + Messenger ([messenger-webhook-processor.ts](../lib/messenger/messenger-webhook-processor.ts)) = parity
  - Test: `line-product-search-bridge.test.ts` (flag propagate + precise ไม่ flag). `tsc --noEmit` ผ่าน. `line-webhook-processor.test.ts` = 71 pass / 5 fail เท่าเดิม (fail เดิมเป็น env `mock.module` ไม่เกี่ยวกับโค้ด)
  - **ยังไม่ทำ:** C (จำกัด vector recall — กระทบ storefront), E (ลบ hardcode thermostat — ยืนยันแล้วว่า**ยังไม่มีสินค้า thermostat/วาล์วน้ำ** จึงยังไม่เร่งด่วน)
- 2026-07-11: **แก้เคส 🔴1 + 🔴2 + 🔴3 พร้อมกันด้วย Chat-layer Relevance Gate** (แก่นของ audit — ปิดที่ต้นทางแทนไล่ปิดกลไก engine ทีละตัว)
  - **เจ้าของเคาะเกณฑ์:** กฎ ก (แข็ง = code/oem/name/**keyword**/fitment) + ข้อยกเว้น (พิมพ์ part+car ครบ + trigram≥0.5) + สาย accessory (`ANCHORED`→โชว์ / `FALLBACK`→แอดมิน) ; สงสัยส่งแอดมิน ห้ามเดา. ยิง**เฉพาะเทิร์น `categoryName=null`** (categoryName resolve ได้ = hard filter ปลอดภัยเดิม ไม่แตะ)
  - **หมวด "อะไหล่อื่นๆ"/universal:** ครอบด้วย ก อัตโนมัติ เพราะ ก จับที่**ข้อความของตัวสินค้าเอง** (ชื่อ/คำพ้อง) ไม่ขึ้นกับหมวด → สินค้า universal ที่ร้านมีจริง+ตั้งชื่อ/keyword ตรง จะไม่โดน over-block. `matchPartTypeToCategoryHint` **ถูกตัดออก**จากเงื่อนไข (พึ่ง keyword ใน ก แทน ไม่พึ่งตาราง hardcode ที่ไม่รู้จักอะไหล่อื่นๆ)
  - **Engine (additive, ไม่แตะ ranking/filter):** เพิ่มคอลัมน์ `match_trigram_high` (`GREATEST(similarity code/oem/name/keyword/search_text) ≥ 0.5`, const `SEARCH_V2_CHAT_TRIGRAM_STRONG`) + คืน field `highTrigramProductIds`. **ไม่แตะ `matchReasons`** (มันคุม chip storefront ที่ [ProductMatchChips.tsx](../components/shared/ProductMatchChips.tsx))
  - **Processor:** guard `weakCategoryMatchGuard` ([line-webhook-processor.ts](../lib/line-webhook-processor.ts)) → ตอบ `CHAT_WEAK_MATCH_HANDOFF_REPLY` + notify + audit `AI_WEAK_CATEGORY_MATCH_HANDOFF`. Messenger parity ใน `replyWithProductSearch` ([messenger-webhook-processor.ts](../lib/messenger/messenger-webhook-processor.ts)) — ใช้ fitment hints แทน frame (Messenger ไม่มี frame)
  - **หมายเหตุ (นิยาม "name"):** `match_name` ยิงตั้งแต่ similarity 0.18 → ตามที่เจ้าของเลือก name อยู่ใน ก จึงเป็นเกณฑ์ที่ค่อนข้างผ่อนสำหรับชื่อ. หากอยากเข้มขึ้น (name เฉพาะ exact/prefix, fuzzy ให้ไปเข้า trigram≥0.5) แก้ได้ภายหลัง
  - **ไม่แตะ ranking/filtering ของ engine** → ไม่กระทบ storefront. Test: `line-product-search-bridge.test.ts` (propagate highTrigram), `line-webhook-processor.test.ts` (weak→handoff, strong name→show). `tsc --noEmit` ผ่าน, ชุด LINE 73 pass/5 fail เท่า baseline (5 fail = env `mock.module`)
