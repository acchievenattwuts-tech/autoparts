import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

import {
  buildAuditActivityEvent,
  buildRelationActivityEvent,
  formatMoneyActivity,
  getDocumentActivityTimeline,
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

// Sale ↔ DeliveryCommissionRun and Expense ↔ DeliveryCommissionRun relations.
// getDb() imports @/lib/db lazily, so the mock below is picked up at call time.
type FindArgs = { where?: Record<string, unknown> };

let commissionItemArgs: FindArgs[] = [];
let commissionItems: unknown[] = [];
let commissionRunArgs: FindArgs[] = [];
let commissionRun: unknown = null;

describe("document activity timeline — delivery commission runs", () => {
  before(async () => {
    const none = async () => [];
    await mock.module("@/lib/db", {
      namedExports: {
        db: {
          auditLog: { findMany: none },
          receiptItem: { findMany: none },
          creditNote: { findMany: none },
          warrantyClaim: { findMany: none },
          marketplaceSettlementLine: { findMany: none },
          sale: { findUnique: async () => ({ createdAt: new Date("2026-09-01T02:00:00.000Z"), quotation: null }) },
          deliveryCommissionItem: {
            findMany: async (args: FindArgs) => {
              commissionItemArgs.push(args);
              return commissionItems;
            },
          },
          deliveryCommissionRun: {
            findUnique: async (args: FindArgs) => {
              commissionRunArgs.push(args);
              return commissionRun;
            },
          },
        },
      },
    });
  });

  beforeEach(() => {
    commissionItemArgs = [];
    commissionItems = [];
    commissionRunArgs = [];
    commissionRun = null;
  });

  it("links a sale to the ACTIVE delivery commission run that paid it", async () => {
    commissionItems = [{
      commissionAmount: "12.5",
      run: {
        id: "run-1",
        runNo: "DCP26090001",
        payDate: new Date("2026-09-10T00:00:00.000Z"),
        createdAt: new Date("2026-09-10T03:00:00.000Z"),
      },
    }];

    const events = await getDocumentActivityTimeline("Sale", "sale-1");

    // Same filter as the Sale mutation guard: cancelled runs release the bill and are not listed.
    assert.deepEqual(commissionItemArgs[0]?.where, {
      saleId: "sale-1",
      activeSaleId: { not: null },
      run: { status: "ACTIVE" },
    });
    assert.deepEqual(events, [{
      id: "sale-sale-1-delivery-commission-run-run-1",
      kind: "USED_BY",
      occurredAt: new Date("2026-09-10T03:00:00.000Z"),
      title: "ถูกนำไปใช้ที่เอกสารทำจ่ายค่าส่ง",
      description: "ยอดทำจ่าย 12.50 บาท",
      href: "/admin/delivery-commissions/run-1",
      hrefLabel: "DCP26090001",
      tone: "used",
    }]);
  });

  it("links a generated expense back to its delivery commission run", async () => {
    commissionRun = {
      id: "run-2",
      runNo: "DCP26090002",
      payDate: new Date("2026-09-11T00:00:00.000Z"),
      createdAt: new Date("2026-09-11T04:00:00.000Z"),
      commissionTotal: "2450",
    };

    const events = await getDocumentActivityTimeline("Expense", "exp-1");

    // No status filter — like a receipt's source sale, the source run is always shown.
    assert.deepEqual(commissionRunArgs[0]?.where, { expenseId: "exp-1" });
    assert.deepEqual(events, [{
      id: "expense-exp-1-delivery-commission-run-run-2",
      kind: "USES_SOURCE",
      occurredAt: new Date("2026-09-11T04:00:00.000Z"),
      title: "ถูกสร้างจากเอกสารทำจ่ายค่าส่ง",
      description: "ยอดทำจ่าย 2,450.00 บาท",
      href: "/admin/delivery-commissions/run-2",
      hrefLabel: "DCP26090002",
      tone: "used",
    }]);
  });

  it("adds no relation event for an expense that no run generated", async () => {
    const events = await getDocumentActivityTimeline("Expense", "exp-plain");
    assert.deepEqual(events, []);
  });
});
