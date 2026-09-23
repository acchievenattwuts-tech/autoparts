import assert from "node:assert/strict";
import test from "node:test";
import { ACTION_MESSAGE_BOX_CLASS, ACTION_MESSAGE_INLINE_CLASS, actionMessageRole, toActionMessage } from "../action-message";
import { parsePriceListEditInput } from "../price-lists/price-list-edit";
import {
  PROMOTION_STATUS_PRESENTATION,
  getPromotionCancelConfirmMessage,
  getPromotionDraftSelectionError,
} from "../promotions/promotion-presentation";

test("action results keep their tone instead of one neutral string", () => {
  assert.deepEqual(toActionMessage(undefined, "เพิ่มระดับราคาแล้ว"), { type: "success", text: "เพิ่มระดับราคาแล้ว" });
  assert.deepEqual(toActionMessage("ช่วงโปรโมชั่นซ้อน", "เผยแพร่แล้ว"), { type: "error", text: "ช่วงโปรโมชั่นซ้อน" });
  assert.equal(actionMessageRole({ type: "error", text: "x" }), "alert");
  assert.equal(actionMessageRole({ type: "success", text: "x" }), "status");
  for (const classes of [ACTION_MESSAGE_BOX_CLASS, ACTION_MESSAGE_INLINE_CLASS]) {
    assert.match(classes.error, /red/);
    assert.match(classes.success, /emerald/);
    assert.match(classes.error, /dark:/, "error style has a dark-mode variant");
    assert.match(classes.success, /dark:/, "success style has a dark-mode variant");
  }
});

test("inline price-list edit rejects bad input in Thai before calling the server", () => {
  assert.deepEqual(parsePriceListEditInput("  ราคาส่ง TikTok ", "20"), { value: { name: "ราคาส่ง TikTok", sortOrder: 20 } });
  assert.deepEqual(parsePriceListEditInput("A", "0"), { value: { name: "A", sortOrder: 0 } });
  assert.deepEqual(parsePriceListEditInput("   ", "10"), { error: "กรุณากรอกชื่อระดับราคา" });
  for (const badOrder of ["abc", "1.5", "-1", "10000", "", "  "]) {
    assert.deepEqual(parsePriceListEditInput("A", badOrder), { error: "ลำดับต้องเป็นจำนวนเต็ม 0–9999" }, `order "${badOrder}"`);
  }
  assert.ok("error" in parsePriceListEditInput("x".repeat(101), "1"));
});

test("promotion status renders as a Thai badge", () => {
  assert.deepEqual(PROMOTION_STATUS_PRESENTATION.DRAFT, { label: "ร่าง", tone: "pending" });
  assert.deepEqual(PROMOTION_STATUS_PRESENTATION.PUBLISHED, { label: "เผยแพร่แล้ว", tone: "success" });
  assert.deepEqual(PROMOTION_STATUS_PRESENTATION.CANCELLED, { label: "ยกเลิก", tone: "danger" });
});

test("cancel confirmation names the promotion and warns about live prices when published", () => {
  const published = getPromotionCancelConfirmMessage("ลดล้างสต็อก", "PUBLISHED");
  assert.match(published, /ลดล้างสต็อก/);
  assert.match(published, /บิลขายทันที/);
  const draft = getPromotionCancelConfirmMessage("ลดล้างสต็อก", "DRAFT");
  assert.match(draft, /Draft/);
  assert.match(draft, /ย้อนกลับไม่ได้/);
});

test("empty pickers are reported before submit", () => {
  assert.equal(getPromotionDraftSelectionError("", [{ productId: "p1" }]), "กรุณาเลือกระดับราคา");
  assert.equal(getPromotionDraftSelectionError("pl1", [{ productId: "p1" }, { productId: "" }]), "กรุณาเลือกสินค้าให้ครบทุกแถว");
  assert.equal(getPromotionDraftSelectionError("pl1", [{ productId: "p1" }]), null);
});
