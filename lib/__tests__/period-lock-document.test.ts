import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import type { Prisma } from "@/lib/generated/prisma";
import { normalizeOverrideReason, PERIOD_LOCK_OVERRIDE_PERMISSION, PeriodLockedError } from "@/lib/period-lock";
import {
  isPeriodLockReasonLongEnough,
  isPeriodLockRejection,
  PERIOD_LOCK_REASON_FIELD,
  PERIOD_LOCK_REASON_MIN_LENGTH,
} from "@/lib/period-lock-view";
import { parseDateOnlyToDate } from "@/lib/th-date";

// Shared glue of the month lock (owner decisions T2 / ก1 / ก2): the decision an update takes,
// the override read from the session (never the form), the audit meta and the Telegram/bell alert.

const moduleMocksUnavailable = typeof mock.module !== "function";

type Declared = Record<string, string>;
let declared: Declared = {};
let dbDeclared: Declared = {};
const notifications: Array<Record<string, unknown>> = [];

const fakeTx = (calls: string[]): Prisma.TransactionClient => ({
  $executeRaw: async (query: Prisma.Sql) => {
    calls.push(`lock:${String(query.values[0])}`);
    return 0;
  },
  profitDistribution: {
    findMany: async (args: { where: { activePeriodKey: { in: string[] } } }) => {
      calls.push("profitDistribution.findMany");
      return args.where.activePeriodKey.in
        .filter((key) => declared[key])
        .map((key) => ({ activePeriodKey: key, distributionNo: declared[key] }));
    },
  },
} as unknown as Prisma.TransactionClient);

type Helpers = typeof import("@/lib/period-lock-document");
let helpers: Helpers;

before(async () => {
  if (moduleMocksUnavailable) return;
  await mock.module("@/lib/notifications", {
    namedExports: {
      safeNotifyPeriodLockOverride: async (input: Record<string, unknown>) => {
        notifications.push(input);
      },
    },
  });
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        $executeRaw: async () => 0,
        profitDistribution: {
          findMany: async (args: { where: { activePeriodKey: { in: string[] } } }) =>
            args.where.activePeriodKey.in
              .filter((key) => dbDeclared[key])
              .map((key) => ({ activePeriodKey: key, distributionNo: dbDeclared[key] })),
        },
      },
    },
  });
  helpers = await import("@/lib/period-lock-document");
});

beforeEach(() => {
  declared = {};
  dbDeclared = {};
  notifications.length = 0;
});

const AUG = parseDateOnlyToDate("2026-08-20");
const SEP = parseDateOnlyToDate("2026-09-02");
const REASON = "ลูกค้าแจ้งราคาผิด ต้องแก้ตามใบกำกับ";

test("open month: no non-financial check and nothing overridden", { skip: moduleMocksUnavailable }, async () => {
  const calls: string[] = [];
  let asked = false;
  const decision = await helpers.resolveDocumentPeriodLock(fakeTx(calls), [SEP], {
    isNonFinancialOnly: () => {
      asked = true;
      return true;
    },
  });
  assert.deepEqual(decision, { kind: "open", result: { locked: [], overridden: false } });
  assert.equal(asked, false, "the stored document is not re-read in an open month");
  assert.deepEqual(calls, ["lock:period-lock:2026-09", "profitDistribution.findMany"]);
});

test("locked month: a note-only edit takes the narrow path without any override", { skip: moduleMocksUnavailable }, async () => {
  declared = { "2026-08": "PD2026080001" };
  const decision = await helpers.resolveDocumentPeriodLock(fakeTx([]), [AUG, AUG], {
    override: { allowed: false, reason: null },
    isNonFinancialOnly: async () => true,
  });
  assert.equal(decision.kind, "non-financial");
  assert.equal(decision.kind === "non-financial" && decision.locked[0].distributionNo, "PD2026080001");
});

test("locked month (P3): an override holder's non-financial edit needs no reason; a financial one does", { skip: moduleMocksUnavailable }, async () => {
  declared = { "2026-08": "PD2026080001" };
  const noReason = { allowed: true, reason: null };
  const note = await helpers.resolveDocumentPeriodLock(fakeTx([]), [AUG, AUG], {
    override: noReason,
    isNonFinancialOnly: () => true,
  });
  assert.equal(note.kind, "non-financial");
  await assert.rejects(
    helpers.resolveDocumentPeriodLock(fakeTx([]), [AUG, AUG], { override: noReason, isNonFinancialOnly: () => false }),
    (error: unknown) => error instanceof PeriodLockedError && error.message.includes("เหตุผล"),
  );
});

test("locked month: a financial edit is rejected without permission, or with an empty reason", { skip: moduleMocksUnavailable }, async () => {
  declared = { "2026-08": "PD2026080001" };
  // Moving a document OUT of a locked month is locked too: the stored date counts.
  await assert.rejects(
    helpers.resolveDocumentPeriodLock(fakeTx([]), [AUG, SEP], {
      override: { allowed: false, reason: REASON },
      isNonFinancialOnly: () => false,
    }),
    PeriodLockedError,
  );
  await assert.rejects(
    helpers.resolveDocumentPeriodLock(fakeTx([]), [SEP, AUG], {
      override: { allowed: true, reason: "   " },
      isNonFinancialOnly: () => false,
    }),
    (error: unknown) => error instanceof PeriodLockedError && error.message.includes("เหตุผล"),
  );
});

test("locked month: permission + reason overrides; audit meta and alert carry the reason", { skip: moduleMocksUnavailable }, async () => {
  declared = { "2026-08": "PD2026080001" };
  const override = { allowed: true, reason: `  ${REASON}  ` };
  const decision = await helpers.resolveDocumentPeriodLock(fakeTx([]), [AUG, AUG], {
    override,
    isNonFinancialOnly: () => false,
  });
  assert.equal(decision.kind, "open");
  const result = decision.kind === "open" ? decision.result : null;
  assert.equal(result?.overridden, true);
  assert.deepEqual(helpers.periodLockAuditMeta(result, override), {
    periodLockOverride: { reason: REASON, periods: result?.locked },
  });
  await helpers.notifyPeriodLockOverrideUsed({
    result,
    override,
    entityType: "Sale",
    entityId: "sale-1",
    docNo: "SA26080001",
    action: "แก้ไขใบขาย",
    actorName: "เจ้าของร้าน",
    link: "/admin/sales/sale-1",
  });
  assert.equal(notifications.length, 1);
  assert.deepEqual(notifications[0], {
    entityType: "Sale",
    entityId: "sale-1",
    docNo: "SA26080001",
    action: "แก้ไขใบขาย",
    periodLabels: result?.locked.map((period) => period.label),
    reason: REASON,
    actorName: "เจ้าของร้าน",
    link: "/admin/sales/sale-1",
  });
});

test("no alert and no audit meta when the lock was not overridden", { skip: moduleMocksUnavailable }, async () => {
  const open = { locked: [], overridden: false };
  assert.deepEqual(helpers.periodLockAuditMeta(open, { allowed: true, reason: REASON }), {});
  await helpers.notifyPeriodLockOverrideUsed({
    result: open,
    override: { allowed: true, reason: REASON },
    entityType: "Expense",
    entityId: "exp-1",
    docNo: "EX26090001",
    action: "ยกเลิกใบค่าใช้จ่าย",
    actorName: null,
    link: "/admin/expenses/exp-1",
  });
  assert.equal(notifications.length, 0);
});

test("the override permission comes from the session, never from the form", { skip: moduleMocksUnavailable }, () => {
  const form = new FormData();
  form.set(PERIOD_LOCK_REASON_FIELD, REASON);
  form.set("allowed", "true");
  assert.deepEqual(helpers.readPeriodLockOverride(form, ["sales.update"]), { allowed: false, reason: REASON });
  assert.deepEqual(helpers.readPeriodLockOverride(form, [PERIOD_LOCK_OVERRIDE_PERMISSION]), { allowed: true, reason: REASON });
  assert.deepEqual(helpers.readPeriodLockOverride(new FormData(), undefined), { allowed: false, reason: null });
});

test("page resolver: one query, the message of each document's own months", { skip: moduleMocksUnavailable }, async () => {
  dbDeclared = { "2026-08": "PD2026080001" };
  const resolve = await helpers.getPeriodLockViewResolver([AUG, SEP], ["sales.view"]);
  assert.equal(resolve(SEP), null);
  const view = resolve(AUG);
  assert.ok(view);
  assert.equal(view.canOverride, false);
  assert.ok(view.message.includes("PD2026080001"));
  assert.ok(!view.message.includes("ปลดล็อก"));
  const adminView = await helpers.getDocumentPeriodLockView([AUG], [PERIOD_LOCK_OVERRIDE_PERMISSION]);
  assert.equal(adminView?.canOverride, true);
  assert.ok(adminView?.message.includes("ปลดล็อก"));
});

test("line remarks (P4): only changed text per stored line, blank and null alike", { skip: moduleMocksUnavailable }, () => {
  const stored = [
    { id: "l-1", moreDetail: null, stockDispositionNote: "กล่องแตก" },
    { id: "l-2", moreDetail: "สีดำ", stockDispositionNote: null },
    { id: "l-3", moreDetail: "เดิม", stockDispositionNote: null },
  ];
  const submitted = [
    { moreDetail: "", stockDispositionNote: "กล่องแตก ฝาหาย" },
    { moreDetail: "สีดำ", stockDispositionNote: "" },
    { moreDetail: undefined, stockDispositionNote: null },
  ];
  assert.deepEqual(helpers.collectLineRemarkUpdates(stored, submitted, ["moreDetail", "stockDispositionNote"]), [
    { id: "l-1", data: { stockDispositionNote: "กล่องแตก ฝาหาย" } },
    { id: "l-3", data: { moreDetail: null } },
  ]);
  assert.deepEqual(helpers.collectLineRemarkUpdates(stored, [], ["moreDetail"]), [], "no submitted line, no update");
});

test("the form recognises the server's lock rejection by the page's own message", { skip: moduleMocksUnavailable }, async () => {
  declared = { "2026-08": "PD2026080001" };
  dbDeclared = { "2026-08": "PD2026080001" };
  const view = await helpers.getDocumentPeriodLockView([AUG], [PERIOD_LOCK_OVERRIDE_PERMISSION]);
  const rejection = await helpers
    .resolveDocumentPeriodLock(fakeTx([]), [AUG, AUG], {
      override: { allowed: true, reason: null },
      isNonFinancialOnly: () => false,
    })
    .then(
      () => "",
      (error: unknown) => (error instanceof Error ? error.message : ""),
    );
  assert.ok(rejection.includes("เหตุผล"), rejection);
  assert.equal(isPeriodLockRejection(rejection, view), true);
  assert.equal(isPeriodLockRejection("จำนวนต้องมากกว่า 0", view), false);
  assert.equal(isPeriodLockRejection("", view), false);
  assert.equal(isPeriodLockRejection(rejection, null), false);
});

test("the client-side reason check uses the server's minimum length", () => {
  const enough = "ก".repeat(PERIOD_LOCK_REASON_MIN_LENGTH);
  const short = "ก".repeat(PERIOD_LOCK_REASON_MIN_LENGTH - 1);
  assert.equal(isPeriodLockReasonLongEnough(enough), true);
  assert.notEqual(normalizeOverrideReason(enough), null);
  assert.equal(isPeriodLockReasonLongEnough(`  ${short}  `), false);
  assert.equal(normalizeOverrideReason(`  ${short}  `), null);
});

test("value comparisons follow the stored scale", { skip: moduleMocksUnavailable }, () => {
  assert.equal(helpers.sameMoney("100.00", 100), true);
  assert.equal(helpers.sameMoney(100.004, 100), true);
  assert.equal(helpers.sameMoney(100.01, 100), false);
  assert.equal(helpers.sameQuantity("1.5000", 1.5), true);
  assert.equal(helpers.sameOptional("", null), true);
  assert.equal(helpers.sameOptional("a", "b"), false);
  assert.equal(
    helpers.samePaymentRows([{ cashBankAccountId: "a", amount: "50.00" }], [{ cashBankAccountId: "a", amount: 50 }]),
    true,
  );
  assert.equal(
    helpers.samePaymentRows([{ cashBankAccountId: "a", amount: 50 }], [{ cashBankAccountId: "b", amount: 50 }]),
    false,
  );
});
