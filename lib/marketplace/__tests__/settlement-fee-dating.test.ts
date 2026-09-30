import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { parseDateOnlyToDate } from "@/lib/th-date";
import {
  planMarketplaceSettlementFacts,
  rebuildMarketplaceSettlementProfitFacts,
} from "@/lib/profit-fact";
import {
  findDistributionLockingAtRecording,
  isDistributionInForceAt,
  toSettlementFactDatingAudit,
  toSettlementFeeDatingView,
} from "@/lib/marketplace/settlement-fee-dating";
import SettlementFeeDatingNotice from "@/app/admin/(protected)/sales/_marketplace/SettlementFeeDatingNotice";

// Owner decision P2 = B: a settlement's fee / platform income share keeps its sale date only
// while that sale's month was still open when the settlement was recorded. A month with a
// ProfitDistribution in force at the settlement's createdAt (declared at or before it and not
// cancelled by then — S1) gets the settlement date instead. Only stored timestamps are compared,
// so every rebuild writes the same dates, even after the declaration is cancelled or re-declared.

Object.assign(globalThis, { React });

const SETTLEMENT_DATE = parseDateOnlyToDate("2026-09-05");
const AUGUST_SALE_DATE = parseDateOnlyToDate("2026-08-20");
const SEPTEMBER_SALE_DATE = parseDateOnlyToDate("2026-09-01");
const RECORDED_AT = new Date("2026-09-05T03:00:00.000Z");
const DECLARED_BEFORE = new Date("2026-09-01T02:00:00.000Z");
const DECLARED_AFTER = new Date("2026-09-10T02:00:00.000Z");
const CANCELLED_BEFORE = new Date("2026-09-02T02:00:00.000Z");
const REDECLARED_BEFORE = new Date("2026-09-03T02:00:00.000Z");
const CANCELLED_AFTER = new Date("2026-09-08T02:00:00.000Z");

type DistributionRow = {
  periodYear: number;
  periodMonth: number;
  distributionNo: string;
  declaredAt: Date;
  status: string;
  cancelledAt: Date | null;
};

type DistributionWhere = {
  OR: Array<{ periodYear: number; periodMonth: number }>;
  status: { in: string[] };
};

type FactRow = {
  sourceType: string;
  sourceSubtype: string | null;
  sourceId: string;
  sourceLineId: string | null;
  referenceDocNo: string | null;
  businessDate: Date;
  expenseAmount: number;
  netProfitAmount: number;
  versionNo: number;
  isActive: boolean;
};

type SettlementState = {
  status: string;
  lines: Array<{ docNo: string; docDate: Date; amount: number }>;
};

const makeStore = (distributions: DistributionRow[]) => {
  const facts: FactRow[] = [];
  const settlement: SettlementState = {
    status: "ACTIVE",
    lines: [
      { docNo: "SP26080010", docDate: AUGUST_SALE_DATE, amount: 600 },
      { docNo: "SP26090001", docDate: SEPTEMBER_SALE_DATE, amount: 400 },
    ],
  };
  const matches = (fact: FactRow, where: { sourceType: string; sourceId: string }): boolean =>
    fact.sourceType === where.sourceType && fact.sourceId === where.sourceId;
  const tx = {
    marketplaceSettlement: {
      findUnique: async () => ({
        id: "set-1",
        settlementNo: "SST26090001",
        settlementDate: SETTLEMENT_DATE,
        createdAt: RECORDED_AT,
        status: settlement.status,
        channel: "SHOPEE",
        expenseId: "exp-1",
        feeAmount: 100,
        incomeAmount: 10,
        expense: { expenseNo: "OE26090001" },
        lines: settlement.lines,
      }),
    },
    profitDistribution: {
      findMany: async (args: { where: DistributionWhere }) =>
        distributions.filter(
          (row) =>
            args.where.status.in.includes(row.status) &&
            args.where.OR.some((period) => period.periodYear === row.periodYear && period.periodMonth === row.periodMonth),
        ),
    },
    factProfit: {
      updateMany: async (args: { where: { sourceType: string; sourceId: string; isActive: boolean } }) => {
        let count = 0;
        for (const fact of facts) {
          if (matches(fact, args.where) && fact.isActive) {
            fact.isActive = false;
            count += 1;
          }
        }
        return { count };
      },
      aggregate: async (args: { where: { sourceType: string; sourceId: string } }) => {
        const versions = facts.filter((fact) => matches(fact, args.where)).map((fact) => fact.versionNo);
        return { _max: { versionNo: versions.length > 0 ? Math.max(...versions) : null } };
      },
      create: async (args: { data: Record<string, unknown> }) => {
        const { data } = args;
        facts.push({
          sourceType: String(data.sourceType),
          sourceSubtype: (data.sourceSubtype as string | null) ?? null,
          sourceId: String(data.sourceId),
          sourceLineId: (data.sourceLineId as string | null) ?? null,
          referenceDocNo: (data.referenceDocNo as string | null) ?? null,
          businessDate: data.businessDate as Date,
          expenseAmount: Number(data.expenseAmount),
          netProfitAmount: Number(data.netProfitAmount),
          versionNo: Number(data.versionNo),
          isActive: Boolean(data.isActive),
        });
        return data;
      },
    },
  };
  const rebuild = () =>
    rebuildMarketplaceSettlementProfitFacts(
      tx as unknown as Parameters<typeof rebuildMarketplaceSettlementProfitFacts>[0],
      "set-1",
    );
  const active = (sourceType: string) => facts.filter((fact) => fact.isActive && fact.sourceType === sourceType);
  const datesByDoc = (sourceType: string) =>
    Object.fromEntries(active(sourceType).map((fact) => [fact.referenceDocNo, fact.businessDate.toISOString()]));
  const amounts = (sourceType: string, field: "expenseAmount" | "netProfitAmount") =>
    active(sourceType).map((fact) => fact[field]);
  return { facts, settlement, distributions, rebuild, active, datesByDoc, amounts };
};

const augustDistribution = (declaredAt: Date): DistributionRow => ({
  periodYear: 2026,
  periodMonth: 8,
  distributionNo: "PD2026080001",
  declaredAt,
  status: "ACTIVE",
  cancelledAt: null,
});

const cancel = (row: DistributionRow, cancelledAt: Date | null): void => {
  Object.assign(row, { status: "CANCELLED", cancelledAt });
};

const sum = (values: number[]): number => Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100;

test("a sale in a month declared before the settlement was recorded: its fee and income go to the settlement date", async () => {
  const store = makeStore([augustDistribution(DECLARED_BEFORE)]);
  const dating = await store.rebuild();

  assert.deepEqual(store.datesByDoc("EXPENSE"), {
    SP26080010: SETTLEMENT_DATE.toISOString(),
    SP26090001: SEPTEMBER_SALE_DATE.toISOString(),
  });
  assert.deepEqual(store.datesByDoc("OTHER_INCOME"), {
    SP26080010: SETTLEMENT_DATE.toISOString(),
    SP26090001: SEPTEMBER_SALE_DATE.toISOString(),
  });
  assert.deepEqual(dating, {
    settlementDate: SETTLEMENT_DATE,
    moved: [{
      docNo: "SP26080010",
      docDate: AUGUST_SALE_DATE,
      periodKey: "2026-08",
      distributionNo: "PD2026080001",
      feeAmount: 60,
      incomeAmount: 6,
    }],
  });
});

test("a sale in an open month keeps its sale date (no distribution, or one declared after recording)", async () => {
  for (const distributions of [[], [augustDistribution(DECLARED_AFTER)]]) {
    const store = makeStore(distributions);
    const dating = await store.rebuild();
    assert.deepEqual(store.datesByDoc("EXPENSE"), {
      SP26080010: AUGUST_SALE_DATE.toISOString(),
      SP26090001: SEPTEMBER_SALE_DATE.toISOString(),
    });
    assert.deepEqual(dating?.moved, []);
  }
});

test("totals and per-sale shares are unchanged; only the date moves", async () => {
  const open = makeStore([]);
  const locked = makeStore([augustDistribution(DECLARED_BEFORE)]);
  await open.rebuild();
  await locked.rebuild();

  for (const store of [open, locked]) {
    assert.equal(sum(store.amounts("EXPENSE", "expenseAmount")), 100);
    assert.equal(sum(store.amounts("EXPENSE", "netProfitAmount")), -100);
    assert.equal(sum(store.amounts("OTHER_INCOME", "netProfitAmount")), 10);
  }
  assert.deepEqual(locked.amounts("EXPENSE", "expenseAmount"), open.amounts("EXPENSE", "expenseAmount"));
  assert.deepEqual(locked.amounts("OTHER_INCOME", "netProfitAmount"), open.amounts("OTHER_INCOME", "netProfitAmount"));
  assert.deepEqual(locked.amounts("EXPENSE", "expenseAmount"), [60, 40]);
  // Same fact identities: one fee and one income fact per sale.
  assert.deepEqual(
    locked.active("EXPENSE").map((fact) => [fact.sourceId, fact.sourceLineId, fact.sourceSubtype]),
    [["exp-1", "set-1:fee:0", "MARKETPLACE_FEE"], ["exp-1", "set-1:fee:1", "MARKETPLACE_FEE"]],
  );
});

test("a rebuild after a later declaration keeps the original dates", async () => {
  // Recorded while August was open: the fee stays in August even after August is declared.
  const open = makeStore([]);
  await open.rebuild();
  const firstDates = open.datesByDoc("EXPENSE");
  open.distributions.push(augustDistribution(DECLARED_AFTER));
  await open.rebuild();
  assert.deepEqual(open.datesByDoc("EXPENSE"), firstDates);
  assert.equal(open.active("EXPENSE").length, 2);
  assert.ok(open.active("EXPENSE").every((fact) => fact.versionNo === 2));

  // Recorded after August was declared: a September declaration made later moves nothing either.
  const locked = makeStore([augustDistribution(DECLARED_BEFORE)]);
  await locked.rebuild();
  const lockedDates = locked.datesByDoc("EXPENSE");
  locked.distributions.push({ ...augustDistribution(DECLARED_AFTER), periodMonth: 9, distributionNo: "PD2026090001" });
  await locked.rebuild();
  assert.deepEqual(locked.datesByDoc("EXPENSE"), lockedDates);
  assert.deepEqual(locked.datesByDoc("OTHER_INCOME"), lockedDates);
});

// Owner decision S1: "locked when recorded" means a declaration IN FORCE at the settlement's createdAt.
test("a declaration in force when recorded keeps the settlement date after it is cancelled and the month re-declared", async () => {
  const store = makeStore([augustDistribution(DECLARED_BEFORE)]);
  const first = await store.rebuild();
  const expenseDates = store.datesByDoc("EXPENSE");
  const incomeDates = store.datesByDoc("OTHER_INCOME");
  assert.equal(expenseDates.SP26080010, SETTLEMENT_DATE.toISOString());

  cancel(store.distributions[0], CANCELLED_AFTER);
  assert.deepEqual(await store.rebuild(), first, "cancelled after recording");
  store.distributions.push({ ...augustDistribution(DECLARED_AFTER), distributionNo: "PD2026080002" });
  const afterRedeclare = await store.rebuild();
  assert.deepEqual(afterRedeclare, first, "re-declared after recording: still the declaration in force then");
  assert.equal(afterRedeclare?.moved[0]?.distributionNo, "PD2026080001");
  assert.deepEqual(store.datesByDoc("EXPENSE"), expenseDates);
  assert.deepEqual(store.datesByDoc("OTHER_INCOME"), incomeDates);
});

test("a declaration cancelled before the settlement was recorded never locked it", async () => {
  const cancelledFirst = augustDistribution(DECLARED_BEFORE);
  cancel(cancelledFirst, CANCELLED_BEFORE);
  const store = makeStore([cancelledFirst]);
  assert.deepEqual((await store.rebuild())?.moved, []);
  assert.equal(store.datesByDoc("EXPENSE").SP26080010, AUGUST_SALE_DATE.toISOString());

  // Re-declared only after recording: the month was open at createdAt, so the sale date stays.
  store.distributions.push({ ...augustDistribution(DECLARED_AFTER), distributionNo: "PD2026080002" });
  assert.deepEqual((await store.rebuild())?.moved, []);
  assert.equal(store.datesByDoc("EXPENSE").SP26080010, AUGUST_SALE_DATE.toISOString());
  assert.equal(store.datesByDoc("OTHER_INCOME").SP26080010, AUGUST_SALE_DATE.toISOString());
});

test("cancelled and re-declared before recording: the re-declaration is the one in force", async () => {
  const cancelledFirst = augustDistribution(DECLARED_BEFORE);
  cancel(cancelledFirst, CANCELLED_BEFORE);
  const store = makeStore([cancelledFirst, { ...augustDistribution(REDECLARED_BEFORE), distributionNo: "PD2026080002" }]);
  const dating = await store.rebuild();
  assert.deepEqual(dating?.moved.map((row) => [row.docNo, row.distributionNo]), [["SP26080010", "PD2026080002"]]);
  assert.equal(store.datesByDoc("EXPENSE").SP26080010, SETTLEMENT_DATE.toISOString());
});

test("in force at recording: declaredAt <= createdAt < cancelledAt; a cancellation without its time is ignored", async () => {
  const at = RECORDED_AT;
  const row = (declaredAt: Date, cancelledAt: Date | null = null) => ({
    periodKey: "2026-08",
    distributionNo: "PD2026080001",
    declaredAt,
    cancelledAt,
  });
  assert.equal(isDistributionInForceAt(row(at), at), true, "declared at the same instant");
  assert.equal(isDistributionInForceAt(row(new Date(at.getTime() + 1)), at), false, "declared a moment later");
  assert.equal(isDistributionInForceAt(row(DECLARED_BEFORE, at), at), false, "cancelled at the same instant");
  assert.equal(isDistributionInForceAt(row(DECLARED_BEFORE, new Date(at.getTime() + 1)), at), true, "cancelled a moment later");
  const distributions = new Map([
    ["PD2026080001", row(DECLARED_BEFORE, CANCELLED_BEFORE)],
    ["PD2026080002", { ...row(REDECLARED_BEFORE), distributionNo: "PD2026080002" }],
  ]);
  assert.equal(findDistributionLockingAtRecording(distributions, AUGUST_SALE_DATE, at)?.distributionNo, "PD2026080002");
  assert.equal(findDistributionLockingAtRecording(distributions, SEPTEMBER_SALE_DATE, at), null, "other month");

  // A CANCELLED row without cancelledAt cannot be placed in time: loaded as nothing.
  const undated = augustDistribution(DECLARED_BEFORE);
  cancel(undated, null);
  const store = makeStore([undated]);
  assert.deepEqual((await store.rebuild())?.moved, []);
});

test("cancel reverses exactly the facts that were written, wherever they were dated", async () => {
  const store = makeStore([augustDistribution(DECLARED_BEFORE)]);
  await store.rebuild();
  const written = store.facts.filter((fact) => fact.isActive);
  assert.equal(written.length, 4);

  store.settlement.status = "CANCELLED";
  const result = await store.rebuild();
  assert.equal(result, null);
  assert.equal(store.facts.length, 4, "no new facts on cancel");
  assert.ok(written.every((fact) => !fact.isActive));
  assert.ok(written.some((fact) => fact.businessDate === SETTLEMENT_DATE), "the moved facts are reversed too");
});

test("a settlement without sales books everything on the settlement date and moves nothing", () => {
  const plan = planMarketplaceSettlementFacts({
    settlementDate: SETTLEMENT_DATE,
    recordedAt: RECORDED_AT,
    feeAmount: 25,
    incomeAmount: 0,
    saleLines: [],
    distributions: new Map(),
  });
  assert.deepEqual(plan.targets, [
    { businessDate: SETTLEMENT_DATE, referenceDocNo: null, feeAmount: 25, incomeAmount: 0 },
  ]);
  assert.deepEqual(plan.dating.moved, []);
});

test("audit metadata and the history view describe the moved shares in Thai", async () => {
  const store = makeStore([augustDistribution(DECLARED_BEFORE)]);
  const dating = await store.rebuild();

  assert.deepEqual(toSettlementFactDatingAudit(dating)?.movedToSettlementDate, [{
    saleNo: "SP26080010",
    saleDate: "2026-08-20",
    periodKey: "2026-08",
    distributionNo: "PD2026080001",
    feeAmount: 60,
    incomeAmount: 6,
  }]);
  assert.equal(toSettlementFactDatingAudit(dating)?.settlementDate, "2026-09-05");
  assert.equal(toSettlementFactDatingAudit(undefined), null);

  const view = toSettlementFeeDatingView(dating);
  assert.ok(view);
  assert.equal(view.feeAmount, 60);
  assert.equal(view.incomeAmount, 6);
  assert.deepEqual(view.months.map((month) => [month.periodKey, month.periodLabel, month.docNos]), [
    ["2026-08", "สิงหาคม 2026", ["SP26080010"]],
  ]);
  assert.equal(toSettlementFeeDatingView({ settlementDate: SETTLEMENT_DATE, moved: [] }), null);

  const html = renderToStaticMarkup(React.createElement(SettlementFeeDatingNotice, { dating: view }));
  assert.match(html, /ลงวันที่รับเงิน 05\/09\/2026 แทนวันที่ขาย/);
  assert.match(html, /ขายเดือนสิงหาคม 2026 \(ประกาศปันผลแล้ว PD2026080001\)/);
  assert.match(html, /ค่าธรรมเนียม ฿60\.00 · รายรับพิเศษ ฿6\.00/);
  assert.match(html, /dark:bg-amber-400\/10/);
  assert.equal(renderToStaticMarkup(React.createElement(SettlementFeeDatingNotice, { dating: null })), "");
});
