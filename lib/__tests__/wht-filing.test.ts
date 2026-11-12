import assert from "node:assert/strict";
import test from "node:test";

import {
  Prisma,
  WhtFilingChannel,
  WhtFilingStatus,
  WhtFilingSubmissionType,
  WhtFormType,
} from "@/lib/generated/prisma";
import {
  buildFiledWhtFilingCancelMessage,
  cancelWhtFiling,
  createWhtFiling,
  generateFilingNo,
  isWhtFilingPeriodConflict,
  markWhtFilingFiled,
  unfiledCertificateWhere,
  WhtFilingFiledCancelError,
  type CreateFilingArgs,
} from "@/lib/wht-filing";

// Characterisation tests: they pin what lib/wht-filing.ts does (2026-11-12) against a
// recording fake transaction client, so a refactor cannot change filing numbers,
// totals or the certificate links silently. Owner decisions applied in review round 3:
// the filing number follows the filing's TAX month (through lib/doc-number.ts), and a
// FILED filing cannot be cancelled (M5).

type TxClient = Prisma.TransactionClient;
type Call = { op: string; args: unknown };
type FakeCertificate = { id: string; totalBaseAmount: Prisma.Decimal; totalTaxAmount: Prisma.Decimal };

type FakeOptions = {
  certificates?: FakeCertificate[];
  lastFilingNo?: string | null;
  filingStatus?: WhtFilingStatus | null;
};

const FAKE_FILING_ID = "filing-1";
const FAKE_FILING_NO = "WF26100001";

const createFakeTx = (options: FakeOptions = {}): { tx: TxClient; calls: Call[] } => {
  const calls: Call[] = [];
  const record = (op: string, args: unknown): void => {
    calls.push({ op, args });
  };
  const fake = {
    // generateWhtFilingNo takes the per-month advisory lock first; the pattern is the bound value.
    $executeRaw: async (query: { values?: unknown[] }) => {
      record("lock", query.values?.[0]);
      return 0;
    },
    whtCertificate: {
      findMany: async (args: unknown) => {
        record("whtCertificate.findMany", args);
        return options.certificates ?? [];
      },
      updateMany: async (args: unknown) => {
        record("whtCertificate.updateMany", args);
        return { count: options.certificates?.length ?? 0 };
      },
    },
    whtFiling: {
      findFirst: async (args: unknown) => {
        record("whtFiling.findFirst", args);
        return options.lastFilingNo ? { filingNo: options.lastFilingNo } : null;
      },
      create: async (args: { data: { filingNo: string } }) => {
        record("whtFiling.create", args);
        return { id: FAKE_FILING_ID, filingNo: args.data.filingNo };
      },
      findUnique: async (args: unknown) => {
        record("whtFiling.findUnique", args);
        return options.filingStatus ? { status: options.filingStatus, filingNo: FAKE_FILING_NO } : null;
      },
      update: async (args: unknown) => {
        record("whtFiling.update", args);
        return {};
      },
    },
  };
  return { tx: fake as unknown as TxClient, calls };
};

const ops = (calls: Call[]): string[] => calls.map((call) => call.op);
const callArgs = (calls: Call[], op: string): unknown => calls.find((call) => call.op === op)?.args;

const certificate = (id: string, base: string, tax: string): FakeCertificate => ({
  id,
  totalBaseAmount: new Prisma.Decimal(base),
  totalTaxAmount: new Prisma.Decimal(tax),
});

const filingArgs = (overrides: Partial<CreateFilingArgs> = {}): CreateFilingArgs => ({
  formType: WhtFormType.PND3,
  taxMonth: 10,
  taxYear: 2569,
  submissionType: WhtFilingSubmissionType.NORMAL,
  additionalSeq: 0,
  surchargeAmount: 12.5,
  note: "ยื่นรอบเดือนตุลาคม",
  userId: "user-1",
  ...overrides,
});

// ─── generateFilingNo ────────────────────────────────────────────────────────

test("generateFilingNo: WF + Gregorian YY of the Buddhist-era tax year + tax month + 4-digit sequence", async () => {
  const { tx, calls } = createFakeTx();
  // Tax year 2569 (พ.ศ.) = 2026 -> "26"; tax month 12 -> "12".
  assert.equal(await generateFilingNo(tx, 2569, 12), "WF26120001");
  // Lock the tax month's sequence first, then read its highest number through the transaction.
  assert.deepEqual(ops(calls), ["lock", "whtFiling.findFirst"]);
  assert.equal(callArgs(calls, "lock"), "WF2612");
  assert.deepEqual(callArgs(calls, "whtFiling.findFirst"), {
    where: { filingNo: { startsWith: "WF2612" } },
    orderBy: { filingNo: "desc" },
    select: { filingNo: true },
  });

  assert.equal(await generateFilingNo(createFakeTx().tx, 2569, 1), "WF26010001");
  assert.equal(await generateFilingNo(createFakeTx().tx, 2570, 3), "WF27030001");
});

test("generateFilingNo follows the tax month, never the day the filing is created", async (t) => {
  // Created on 1 Dec 2026 (Bangkok) for tax month 11/2569, and on 15 Jan 2027 for 12/2569.
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-30T17:30:00Z") });
  assert.equal(await generateFilingNo(createFakeTx().tx, 2569, 11), "WF26110001");
  t.mock.timers.setTime(new Date("2027-01-15T03:00:00Z").getTime());
  assert.equal(await generateFilingNo(createFakeTx().tx, 2569, 12), "WF26120001");
});

test("generateFilingNo continues from the highest number of the tax month", async () => {
  assert.equal(await generateFilingNo(createFakeTx({ lastFilingNo: "WF26120009" }).tx, 2569, 12), "WF26120010");
  assert.equal(await generateFilingNo(createFakeTx({ lastFilingNo: "WF26129998" }).tx, 2569, 12), "WF26129999");
});

test("generateFilingNo rejects a tax period that is not a month 1-12", async () => {
  for (const [year, month] of [[2569, 0], [2569, 13], [2569.5, 1]] as const) {
    const { tx, calls } = createFakeTx();
    await assert.rejects(generateFilingNo(tx, year, month));
    assert.deepEqual(calls, [], `${year}/${month}: nothing read or locked`);
  }
});

// ─── unfiledCertificateWhere ─────────────────────────────────────────────────

test("unfiledCertificateWhere selects active, unlinked certificates of one form and tax month", () => {
  assert.deepEqual(unfiledCertificateWhere(WhtFormType.PND53, 9, 2569), {
    status: "ACTIVE",
    filingId: null,
    formType: WhtFormType.PND53,
    taxMonth: 9,
    taxYear: 2569,
  });
});

// ─── createWhtFiling ─────────────────────────────────────────────────────────

test("createWhtFiling totals the pulled certificates, numbers the filing and links every certificate", async (t) => {
  // 2026-11-12 10:00 Bangkok. The filing number follows the TAX month (Oct 2569), not today's month (Nov).
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-12T03:00:00Z") });

  const { tx, calls } = createFakeTx({
    lastFilingNo: "WF26100003",
    certificates: [
      certificate("cert-a", "1000.10", "30.10"),
      certificate("cert-b", "2000.20", "60.20"),
      certificate("cert-c", "0.10", "0.10"),
    ],
  });

  const result = await createWhtFiling(tx, filingArgs());

  assert.deepEqual(result, { id: FAKE_FILING_ID, filingNo: "WF26100004", certificateCount: 3 });
  assert.deepEqual(ops(calls), [
    "whtCertificate.findMany",
    "lock",
    "whtFiling.findFirst",
    "whtFiling.create",
    "whtCertificate.updateMany",
  ]);
  assert.equal(callArgs(calls, "lock"), "WF2610");
  assert.deepEqual(callArgs(calls, "whtCertificate.findMany"), {
    where: unfiledCertificateWhere(WhtFormType.PND3, 10, 2569),
    select: { id: true, totalBaseAmount: true, totalTaxAmount: true },
  });
  assert.deepEqual(callArgs(calls, "whtFiling.create"), {
    data: {
      filingNo: "WF26100004",
      formType: WhtFormType.PND3,
      taxMonth: 10,
      taxYear: 2569,
      submissionType: WhtFilingSubmissionType.NORMAL,
      additionalSeq: 0,
      totalRecords: 3,
      totalBaseAmount: 3000.4,
      totalTaxAmount: 90.4,
      surchargeAmount: 12.5,
      // grand total = tax + surcharge; the base amount is not part of it.
      grandTotalAmount: 102.9,
      note: "ยื่นรอบเดือนตุลาคม",
      userId: "user-1",
    },
    select: { id: true, filingNo: true },
  });
  assert.deepEqual(callArgs(calls, "whtCertificate.updateMany"), {
    where: { id: { in: ["cert-a", "cert-b", "cert-c"] } },
    data: { filingId: FAKE_FILING_ID },
  });
});

test("createWhtFiling rounds the surcharge and the grand total to 2 decimals", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-12T03:00:00Z") });
  const { tx, calls } = createFakeTx({ certificates: [certificate("cert-a", "100.00", "3.00")] });

  await createWhtFiling(
    tx,
    filingArgs({ submissionType: WhtFilingSubmissionType.ADDITIONAL, additionalSeq: 2, surchargeAmount: 10.005, note: null }),
  );

  const created = callArgs(calls, "whtFiling.create") as { data: Record<string, unknown> };
  assert.equal(created.data.filingNo, "WF26100001");
  assert.equal(created.data.submissionType, WhtFilingSubmissionType.ADDITIONAL);
  assert.equal(created.data.additionalSeq, 2);
  assert.equal(created.data.totalBaseAmount, 100);
  assert.equal(created.data.totalTaxAmount, 3);
  assert.equal(created.data.surchargeAmount, 10.01);
  assert.equal(created.data.grandTotalAmount, 13.01);
  assert.equal(created.data.note, null);
});

test("createWhtFiling with no unfiled certificates throws before numbering or writing anything", async () => {
  const { tx, calls } = createFakeTx({ certificates: [] });
  await assert.rejects(createWhtFiling(tx, filingArgs()), {
    message: "ไม่มีหนังสือรับรองที่ยังไม่ได้ยื่นสำหรับแบบและเดือนภาษีที่เลือก",
  });
  assert.deepEqual(ops(calls), ["whtCertificate.findMany"]);
});

// ─── cancelWhtFiling ─────────────────────────────────────────────────────────

test("cancelWhtFiling releases the certificates, then marks the filing cancelled with the note", async () => {
  const { tx, calls } = createFakeTx({ filingStatus: WhtFilingStatus.DRAFT });
  await cancelWhtFiling(tx, FAKE_FILING_ID, "ยื่นผิดเดือน");

  assert.deepEqual(ops(calls), ["whtFiling.findUnique", "whtCertificate.updateMany", "whtFiling.update"]);
  assert.deepEqual(callArgs(calls, "whtFiling.findUnique"), {
    where: { id: FAKE_FILING_ID },
    select: { status: true, filingNo: true },
  });
  assert.deepEqual(callArgs(calls, "whtCertificate.updateMany"), {
    where: { filingId: FAKE_FILING_ID },
    data: { filingId: null },
  });
  assert.deepEqual(callArgs(calls, "whtFiling.update"), {
    where: { id: FAKE_FILING_ID },
    data: { status: WhtFilingStatus.CANCELLED, note: "ยื่นผิดเดือน" },
  });
});

test("M5: a FILED filing cannot be cancelled — refused with its number before anything is written", async () => {
  const { tx, calls } = createFakeTx({ filingStatus: WhtFilingStatus.FILED });
  await assert.rejects(cancelWhtFiling(tx, FAKE_FILING_ID, "ยื่นผิด"), (error: unknown) => {
    assert.ok(error instanceof WhtFilingFiledCancelError);
    assert.equal(error.message, "รอบยื่น WF26100001 บันทึกว่ายื่นแบบแล้ว ยกเลิกไม่ได้");
    return true;
  });
  // The certificates stay linked and the status stays FILED.
  assert.deepEqual(ops(calls), ["whtFiling.findUnique"]);
  assert.equal(buildFiledWhtFilingCancelMessage("WF26100001"), "รอบยื่น WF26100001 บันทึกว่ายื่นแบบแล้ว ยกเลิกไม่ได้");
});

test("M5: unique violations map to the existing period message; other errors do not", () => {
  const adapterP2002 = Object.assign(new Error("Unique constraint failed on the constraint: `WhtFiling_active_period_key`"), {
    code: "P2002",
    meta: { driverAdapterError: { cause: { constraint: { index: "WhtFiling_active_period_key" } } } },
  });
  assert.equal(isWhtFilingPeriodConflict(adapterP2002), true);
  // The message-only form the action matched before stays matched.
  assert.equal(isWhtFilingPeriodConflict(new Error("Unique constraint failed on the fields: (`formType`)")), true);
  assert.equal(isWhtFilingPeriodConflict(Object.assign(new Error("x"), { code: "P2003" })), false);
  assert.equal(isWhtFilingPeriodConflict(new Error("ไม่มีหนังสือรับรองที่ยังไม่ได้ยื่นสำหรับแบบและเดือนภาษีที่เลือก")), false);
  assert.equal(isWhtFilingPeriodConflict("Unique constraint"), false);
});

test("cancelWhtFiling on an already-cancelled filing is a no-op (the note is not updated)", async () => {
  const { tx, calls } = createFakeTx({ filingStatus: WhtFilingStatus.CANCELLED });
  await cancelWhtFiling(tx, FAKE_FILING_ID, "อีกครั้ง");
  assert.deepEqual(ops(calls), ["whtFiling.findUnique"]);
});

test("cancelWhtFiling on a missing filing throws without writing", async () => {
  const { tx, calls } = createFakeTx({ filingStatus: null });
  await assert.rejects(cancelWhtFiling(tx, FAKE_FILING_ID, null), { message: "ไม่พบรอบยื่นแบบ" });
  assert.deepEqual(ops(calls), ["whtFiling.findUnique"]);
});

// ─── markWhtFilingFiled ──────────────────────────────────────────────────────

const FILED_AT = new Date("2026-11-07T00:00:00+07:00");

test("markWhtFilingFiled stores status FILED with the filing date, channel and RD reference", async () => {
  const { tx, calls } = createFakeTx({ filingStatus: WhtFilingStatus.DRAFT });
  await markWhtFilingFiled(tx, FAKE_FILING_ID, {
    filedAt: FILED_AT,
    filedChannel: WhtFilingChannel.EFILING,
    rdRefNo: "RD-123",
  });

  assert.deepEqual(ops(calls), ["whtFiling.findUnique", "whtFiling.update"]);
  assert.deepEqual(callArgs(calls, "whtFiling.update"), {
    where: { id: FAKE_FILING_ID },
    data: { status: WhtFilingStatus.FILED, filedAt: FILED_AT, filedChannel: WhtFilingChannel.EFILING, rdRefNo: "RD-123" },
  });
});

test("markWhtFilingFiled on an already-FILED filing overwrites the filing details", async () => {
  const { tx, calls } = createFakeTx({ filingStatus: WhtFilingStatus.FILED });
  await markWhtFilingFiled(tx, FAKE_FILING_ID, { filedAt: FILED_AT, filedChannel: WhtFilingChannel.PAPER, rdRefNo: null });
  assert.deepEqual(ops(calls), ["whtFiling.findUnique", "whtFiling.update"]);
  assert.deepEqual(callArgs(calls, "whtFiling.update"), {
    where: { id: FAKE_FILING_ID },
    data: { status: WhtFilingStatus.FILED, filedAt: FILED_AT, filedChannel: WhtFilingChannel.PAPER, rdRefNo: null },
  });
});

test("markWhtFilingFiled refuses a cancelled or missing filing without writing", async () => {
  const cancelled = createFakeTx({ filingStatus: WhtFilingStatus.CANCELLED });
  await assert.rejects(
    markWhtFilingFiled(cancelled.tx, FAKE_FILING_ID, { filedAt: FILED_AT, filedChannel: null, rdRefNo: null }),
    { message: "รอบยื่นนี้ถูกยกเลิกแล้ว" },
  );
  assert.deepEqual(ops(cancelled.calls), ["whtFiling.findUnique"]);

  const missing = createFakeTx({ filingStatus: null });
  await assert.rejects(
    markWhtFilingFiled(missing.tx, FAKE_FILING_ID, { filedAt: FILED_AT, filedChannel: null, rdRefNo: null }),
    { message: "ไม่พบรอบยื่นแบบ" },
  );
  assert.deepEqual(ops(missing.calls), ["whtFiling.findUnique"]);
});
