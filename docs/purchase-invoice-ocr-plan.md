# Purchase Invoice OCR — สเปกและแผนงาน (AI ช่วยกรอกใบซื้อจากรูป)

> สถานะ: **Phase 1–2 เสร็จ (server + UI) / Phase 3 เหลือทดสอบใบจริง**
> อัปเดตล่าสุด: 2026-06-16
> เจ้าของฟีเจอร์: ข้อ 3 จากการประเมิน AI agent (Purchase Invoice OCR)

## 1. เป้าหมาย

ให้แอดมินถ่าย/อัปโหลดรูปใบส่งของหรือใบกำกับจากซัพพลายเออร์ แล้วระบบใช้ AI (Gemini multimodal)
อ่านรายการสินค้า + ราคา + จำนวน ออกมา แล้ว **เติมเป็น draft ในฟอร์มใบซื้อ** เพื่อลดเวลา key ข้อมูล
จุดบันทึกจริงยังเป็น `createPurchase` เดิม — flow MAVG / Audit Log / docNo ไม่เปลี่ยน

## 2. หลักการและข้อจำกัด (guardrails)

- AI ทำได้แค่ **"เติม draft ในฟอร์ม"** เท่านั้น — ห้ามแตะ `writeStockCard`, ห้ามเขียน DB, ห้าม auto-submit (กฎ §8)
- เป็นฟีเจอร์ **เสริม (additive)** — ถ้า Gemini keys ไม่มี/พัง ต้อง degrade gracefully (ฟอร์มกรอกมือได้ปกติ)
- ใช้ infra เดิมทั้งหมด: `generateGeminiContent()` (multi-key fallback) + semantic search embeddings ที่เปิดใช้แล้ว
- **ไม่มี env flag** — เปิดใช้งานตลอด (gate เฉพาะ `hasGeminiKeysConfigured()` เพื่อ degrade เท่านั้น)
- **รองรับหลายรูปต่อครั้ง** (ใบหลายหน้า/หลายรูป)
- **เฉพาะหน้าสร้างใหม่ (new form) เท่านั้น** — หน้าแก้ไข (edit) ไม่อ่าน OCR ให้ผู้ใช้แก้เอง

## 3. การตัดสินใจที่ยืนยันแล้ว

| หัวข้อ | การตัดสินใจ |
|---|---|
| โมเดล OCR | Gemini (`GOOGLE_AI_MODEL` = gemini-3.1-flash-lite) เหมือน OCR สลิป, `thinkingLevel:"NONE"`, json, temperature 0 |
| Env flag | ไม่มี — เปิดตลอด (gate ด้วย `hasGeminiKeysConfigured()` เท่านั้น) |
| จำนวนรูป | รองรับหลายรูปต่อครั้ง |
| การจับคู่สินค้า | **semantic search embeddings**: หา part no. จริงมา map ก่อน ถ้าไม่ได้จริง ๆ ค่อย semantic จากข้อความ (rawText) |
| ขอบเขตฟอร์ม | new form เท่านั้น — edit form ผู้ใช้แก้เอง ไม่อ่าน OCR |
| การบันทึก | ผ่าน `createPurchase` เดิม 100% (ไม่แตะ business logic) |

## 4. Data Flow

```
[แอดมินอัปโหลดรูปใบส่งของ (1..n รูป)]
   → Server Action: extractPurchaseInvoiceFromImages(formData)
        ├─ requirePermission("purchases.create")
        ├─ validate ไฟล์: image/* + ขนาด ≤ 8MB ต่อรูป (ตรวจ server-side)
        ├─ Gemini OCR (json, หลายรูปรวมเป็นชุดเดียว)
        │     → { supplierName?, referenceNo?, invoiceDate?, lines:[{rawText, partCode?, qty, unitCost}] }
        └─ จับคู่สินค้าแต่ละ line ด้วย semantic search embeddings:
              1) ถ้ามี partCode → ค้นด้วย partCode (เน้นรหัสจริง)
              2) ถ้าไม่เจอ/ไม่มี partCode → semantic search จาก rawText
              → คืน candidate top-3 ต่อ line (id, code, name) — ไม่ auto-pick
   → คืน PurchaseOcrResult ให้ client
[Review Panel ใน PurchaseInvoiceUploader]
   → แอดมินยืนยัน/เลือกสินค้าแต่ละบรรทัด (จาก candidate หรือค้นเอง)
   → กด "เติมลงฟอร์ม" → merge เข้า items state ของ PurchaseForm
   → กด "บันทึกใบซื้อ" → createPurchase เดิม
```

## 5. ไฟล์ที่เพิ่ม / แก้

| ไฟล์ | ประเภท | หน้าที่ |
|---|---|---|
| `lib/purchase-invoice-ocr.ts` | ใหม่ | prompt + `runPurchaseInvoiceOcr(images)` คืน parsed JSON (อิง `lib/line-payment-slip-ocr.ts`) |
| `lib/purchase-invoice-ocr-types.ts` | ใหม่ | Zod schema + types (`PurchaseOcrLine`, `PurchaseOcrResult`, `PurchaseOcrCandidate`) แชร์ client/server |
| `app/admin/(protected)/purchases/ocr-actions.ts` | ใหม่ | Server Action `extractPurchaseInvoiceFromImages(formData)` — auth + OCR + product matching |
| `app/admin/(protected)/purchases/new/PurchaseInvoiceUploader.tsx` | ใหม่ | Client: อัปโหลดหลายรูป + พรีวิว + Review Panel + จับคู่สินค้า |
| `app/admin/(protected)/purchases/new/PurchaseForm.tsx` | แก้ | เพิ่มปุ่ม "สแกนใบส่งของ (AI)" + callback `onApplyOcrItems(items)` merge เข้า `items` state |
| `app/admin/(protected)/purchases/__tests__/purchase-invoice-ocr.test.ts` | ใหม่ | unit test parse/Zod + mapping OCR line → `PurchaseFormLineItem` |
| `PLAN.md` | แก้ | บันทึก checklist เฟสนี้ (housekeeping ตามกฎ §5) |

> ไม่แตะ `schema.prisma`, ไม่เพิ่ม permission key (reuse `purchases.create`), ไม่แก้ sidebar/route rules, ไม่แตะ edit form

## 6. การออกแบบ OCR (Server)

Prompt (อิงรูปแบบ payment-slip ที่พิสูจน์แล้ว):

```
คุณเป็นผู้ช่วยอ่านใบส่งของ/ใบกำกับภาษีของซัพพลายเออร์อะไหล่รถยนต์ในไทย
อ่านเฉพาะที่เห็นจริงในรูป ห้ามเดาหรือแต่งข้อมูลที่อ่านไม่ออก ถ้าไม่พบให้ใส่ null
ตอบเป็น JSON ล้วนเท่านั้น ห้ามมี markdown:
{
  "supplierName": ชื่อผู้ขาย | null,
  "referenceNo": เลขที่ใบกำกับ/ใบส่งของ | null,
  "invoiceDate": "YYYY-MM-DD" | null,
  "lines": [
    { "rawText": ข้อความบรรทัดสินค้า, "partCode": รหัสอะไหล่ | null,
      "qty": ตัวเลขจำนวน | null, "unitCost": ราคาต่อหน่วยก่อน VAT | null }
  ]
}
```

- `maxOutputTokens` สูงพอสำหรับหลายบรรทัด (เริ่ม ~2000), `temperature: 0`, `thinkingLevel: "NONE"`, `json: true`
- ส่งรูปหลายไฟล์ใน `images[]` ของ `generateGeminiContent` รอบเดียว
- try/catch คืน empty เมื่อ key หมด/parse พัง (ไม่ throw) — ตาม pattern เดิม
- **Zod validate** output ก่อนใช้ (กฎ §7 — ไม่เชื่อ output ดิบ)

## 7. Product Matching (semantic search embeddings)

- ใช้ `searchProductIds()` จาก `@/lib/product-search` (ตัวเดียวกับ LINE bot, semantic เปิดแล้ว)
- ลำดับ:
  1. ถ้ามี `partCode` → ค้นด้วย `partCode` ก่อน (เน้น part no. จริง)
  2. ถ้าไม่เจอ หรือไม่มี `partCode` → semantic search จาก `rawText`
- คืน **candidate top-3 ต่อบรรทัด** ไม่ auto-pick — แอดมินเลือกเอง
- บรรทัดที่ match ไม่ได้ → เว้นช่องสินค้าว่าง ให้ค้นเองด้วย `ProductSearchSelect` เดิม

## 8. UI Review Panel

- อัปโหลดได้หลายรูป + แสดงพรีวิวรูปทั้งหมด (ลบรายรูปได้)
- ตาราง review: `rawText | qty | unitCost | [dropdown candidate top-3 / ค้นเอง]`
- badge ระดับความเชื่อมั่น: "ตรงรหัส" / "ใกล้เคียง" / "ไม่พบ"
- ปุ่ม "เติม X รายการลงฟอร์ม" → ส่ง `PurchaseFormLineItem[]` กลับ PurchaseForm
- ช่องที่มาจาก AI **ไฮไลต์สีต่าง** (พื้นเหลืองอ่อน) เตือนให้ตรวจ — เคลียร์เมื่อแอดมินแก้
- **lot fields (mfg/exp) ไม่ให้ AI เติม** ปล่อยว่างเสมอ (ห้ามเดาวันที่)
- รองรับ light + dark mode พร้อมกัน (กฎ §8)

## 9. จุดเชื่อมใน PurchaseForm

- เพิ่ม `<PurchaseInvoiceUploader onApply={mergeOcrItems} existingProducts={productOptions} />` เหนือส่วน "รายการสินค้า"
- `mergeOcrItems`: แทนแถวว่างแถวแรก แล้ว append ที่เหลือ (reuse logic `applySelectedProduct`) → autosave draft เดิมจับต่อทันที
- candidate ที่เลือก → เรียก `rememberProduct()` เดิม เพื่อให้ `ProductSearchSelect` รู้จัก

## 10. Security / Permission / Audit

- Server Action: `await requirePermission("purchases.create")` (reuse) — กฎ §7
- OCR action **อ่านอย่างเดียว ไม่ mutate** → ไม่ต้องเขียน Audit Log (audit เดินตอน `createPurchase` จริงเหมือนเดิม)
- Validate ไฟล์อัปโหลด server-side: MIME `image/*`, ขนาด ≤ 8MB ต่อรูป, จำกัดจำนวนรูป (เช่น ≤ 10)
- ห้าม log ภาพ/ข้อมูล PII ลง console (กฎ §7)

## 11. Edge cases

- รูปเบลอ/ไม่ใช่ใบส่งของ → lines ว่าง → แจ้ง "อ่านไม่ได้ กรุณากรอกเอง"
- `qty`/`unitCost` เป็น null → ใส่ 0 ให้แอดมินกรอก (ไม่บล็อก)
- All Gemini keys exhausted → toast เตือน + ฟอร์มกรอกมือได้ปกติ
- รูปจำนวนมาก/ใหญ่ → จำกัดจำนวน + ขนาด, แจ้ง error ที่อ่านง่าย (ภาษาไทย)

## 12. Testing

- Unit: parse Gemini JSON ที่ผิดรูป → คืน empty อย่างปลอดภัย
- Unit: Zod validate schema
- Unit: mapping OCR line → `PurchaseFormLineItem` (qty/cost ถูก, lot ว่าง)
- Manual: ใบจริง 5–10 ใบจากซัพพลายเออร์หลัก — วัด match rate ของ semantic search

---

## 13. Checklist งาน

### Phase 1 — Core OCR + Matching (server)
- [x] สร้าง `lib/purchase-invoice-ocr-types.ts` (Zod schema + types + `parsePurchaseInvoiceOcr`)
- [x] สร้าง `lib/purchase-invoice-ocr.ts` (prompt + `runPurchaseInvoiceOcr(images)`, รองรับหลายรูป)
- [x] สร้าง `app/admin/(protected)/purchases/ocr-actions.ts` — Server Action + `requirePermission("purchases.create")`
- [x] ต่อ product matching: partCode ก่อน → fallback semantic จาก rawText (ใช้ `searchProductIds`)
- [x] validate ไฟล์อัปโหลด server-side (MIME / ขนาด ≤ 8MB / จำนวน ≤ 10)
- [x] unit test parse + Zod (7 เคสผ่าน) → `tsc --noEmit` + `npm run build` ผ่าน

### Phase 2 — UI Uploader + เชื่อมฟอร์ม
- [x] สร้าง `PurchaseInvoiceUploader.tsx` (อัปโหลดหลายรูป + พรีวิว + Review Panel + จับคู่สินค้า)
- [x] badge ความเชื่อมั่น (ตรงรหัส / ใกล้เคียง / ไม่พบ) + แบนเนอร์เตือนตรวจสอบหลังเติม
- [x] เชื่อม `PurchaseForm.tsx` (ปุ่มสแกน + `mergeOcrItems` + `rememberProduct`)
- [x] lot fields ปล่อยว่างเสมอ (ไม่ให้ AI เติม lotNo/MFG/EXP)
- [x] รองรับ light + dark mode (Tailwind `dark:` ตามแบบฟอร์มเดิม + ProductSearchSelect theme-aware)
- [x] new form เท่านั้น (gate ด้วย `!isEdit` — edit page ไม่มี uploader)

### Phase 3 — ทดสอบกับข้อมูลจริง
- [ ] ทดสอบใบจริง 5–10 ใบ วัด match rate **(งาน manual ของผู้ใช้ — ต้องมีรูปใบจริง)**
- [ ] ปรับ prompt / ลำดับ matching ตามผล
- [x] อัปเดต `PLAN.md` ให้ตรงสถานะจริง

---

## หมายเหตุการตัดสินใจระหว่างทำ (deviation log)

- **ไฮไลต์ช่อง AI ในตารางฟอร์มหลัก:** เปลี่ยนเป็น **badge ความเชื่อมั่นใน Review Panel + แบนเนอร์เตือน
  "ตรวจสอบจำนวน/ราคา/หน่วยก่อนบันทึก" หลังกดเติม** แทนการไฮไลต์ช่องในตารางรายการสินค้าโดยตรง
  เหตุผล: การฝัง flag `source:"ocr"` ลง `LineItem` จะถูก serialize ไปกับ `items` ตอน submit และเสี่ยงกระทบ
  schema ฝั่ง `createPurchase` — เลี่ยงเพื่อไม่ให้กระทบ business logic เดิม (ตามคำสั่ง "ห้ามกระทบ logic อื่น")
- **ชนิด `PurchaseProductOption`:** ย้ายนิยามจาก inline ใน `PurchaseForm.tsx` ไปไว้ที่ `purchase-form-data.ts`
  (โมดูลกลาง ไม่ใช่ "use client") เพื่อให้ server action คืน candidate ในรูปเดียวกับที่ฟอร์มใช้ — รูปเดิมไม่เปลี่ยน

## ข้อเสนอแยก (ยังไม่ทำ — ไม่ขยาย scope เอง)

- ยังไม่พบ dependency ใหม่ — ใช้ของเดิมทั้งหมด (`generateGeminiContent`, `searchProductIds`, `zod`)
- ตัวเลือกอนาคต (เสนอเฉย ๆ): ปุ่มสแกนในหน้า edit, รองรับ PDF, เก็บรูปใบส่งของแนบกับเอกสารใบซื้อ

## งานที่เสร็จแล้ว (log)

- 2026-06-16 — วางแผนและยืนยันสเปกครบ
- 2026-06-16 — Phase 1 เสร็จ: types/Zod/parser + OCR runner + server action + product matching; unit test 7 เคสผ่าน
- 2026-06-16 — Phase 2 เสร็จ: `PurchaseInvoiceUploader` + เชื่อม `PurchaseForm` (new เท่านั้น); `tsc --noEmit`, eslint, `npm run build` ผ่านทั้งหมด
- 2026-06-16 — อัปเดต `PLAN.md` index; เหลือ Phase 3 ทดสอบใบจริง (manual)
- 2026-06-16 — แก้ 413 (Payload Too Large): server action body limit ตั้งไว้ 3mb โดยตั้งใจ
  จึงเพิ่มการบีบอัดรูปฝั่ง client ด้วย canvas (1280px / JPEG q0.7, ไม่เพิ่ม dependency)
  + guard ขนาดรวม ≤ 2.6MB ก่อนส่ง แทนการขยาย limit global — ไม่แตะ `next.config.ts`
