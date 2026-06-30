import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAuditActivityEvent,
  buildRelationActivityEvent,
  formatMoneyActivity,
  sortDocumentActivityEvents,
} from "./document-activity";
import { AuditAction } from "./generated/prisma";

describe("document activity timeline", () => {
  it("maps audit create/update/cancel rows to Thai timeline labels", () => {
    const created = buildAuditActivityEvent({
      id: "log-create",
      action: AuditAction.CREATE,
      createdAt: new Date("2026-06-30T02:00:00.000Z"),
      userName: "กานต์",
      entityType: "Sale",
      entityId: "sale-1",
      entityRef: "SL-001",
      meta: null,
    });
    const updated = buildAuditActivityEvent({
      id: "log-update",
      action: AuditAction.UPDATE,
      createdAt: new Date("2026-06-30T03:00:00.000Z"),
      userName: "ศิริพร",
      entityType: "Sale",
      entityId: "sale-1",
      entityRef: "SL-001",
      meta: null,
    });
    const cancelled = buildAuditActivityEvent({
      id: "log-cancel",
      action: AuditAction.CANCEL,
      createdAt: new Date("2026-06-30T04:00:00.000Z"),
      userName: "นวพล",
      entityType: "Sale",
      entityId: "sale-1",
      entityRef: "SL-001",
      meta: { cancelNote: "คีย์ผิด" },
    });

    assert.equal(created?.title, "สร้างเอกสาร");
    assert.equal(created?.description, "โดย กานต์");
    assert.equal(updated?.title, "แก้ไขเอกสาร");
    assert.equal(updated?.description, "โดย ศิริพร");
    assert.equal(cancelled?.title, "ยกเลิกเอกสาร");
    assert.equal(cancelled?.description, "โดย นวพล | เหตุผล: คีย์ผิด");
  });

  it("creates clickable downstream relation events", () => {
    const event = buildRelationActivityEvent({
      id: "sale-receipt-receipt-1",
      kind: "USED_BY",
      occurredAt: new Date("2026-06-30T09:00:00.000Z"),
      title: "ถูกนำไปใช้ที่ใบเสร็จ",
      description: "รับชำระ 2,450.00 บาท",
      href: "/admin/receipts/receipt-1",
      hrefLabel: "RC-001",
      tone: "used",
    });

    assert.equal(event.title, "ถูกนำไปใช้ที่ใบเสร็จ");
    assert.equal(event.href, "/admin/receipts/receipt-1");
    assert.equal(event.hrefLabel, "RC-001");
  });

  it("sorts newest first and keeps deterministic order for equal timestamps", () => {
    const events = sortDocumentActivityEvents([
      buildRelationActivityEvent({
        id: "b",
        kind: "USED_BY",
        occurredAt: new Date("2026-06-30T08:00:00.000Z"),
        title: "B",
        tone: "used",
      }),
      buildRelationActivityEvent({
        id: "a",
        kind: "CREATE",
        occurredAt: new Date("2026-06-30T08:00:00.000Z"),
        title: "A",
        tone: "create",
      }),
      buildRelationActivityEvent({
        id: "c",
        kind: "UPDATE",
        occurredAt: new Date("2026-06-30T09:00:00.000Z"),
        title: "C",
        tone: "update",
      }),
    ]);

    assert.deepEqual(events.map((event) => event.id), ["c", "a", "b"]);
  });

  it("formats Thai baht amounts for relation descriptions", () => {
    assert.equal(formatMoneyActivity(2450), "2,450.00 บาท");
    assert.equal(formatMoneyActivity("3400.5"), "3,400.50 บาท");
  });
});
