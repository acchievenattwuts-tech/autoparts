import assert from "node:assert/strict";
import test, { before, mock } from "node:test";

import {
  appendSaleClaimCancelNote,
  buildSaleClaimCancelHistoryLine,
  CLAIM_CANCEL_NOTE_REQUIRED_ERROR,
  CLAIM_CANCEL_NOTE_TOO_LONG_ERROR,
  getWarrantyClaimKind,
  normalizeClaimCancelNote,
  parseSaleClaimCancelNotes,
} from "@/lib/warranty-claim-policy";

test("claim kind follows the warranty: sale-created → SALE, on-site (manual) → ONSITE", () => {
  assert.equal(getWarrantyClaimKind({ createdVia: "AUTO_FROM_SALE", saleId: "sale-1" }), "SALE");
  assert.equal(getWarrantyClaimKind({ createdVia: "MANUAL", saleId: null }), "ONSITE");
  assert.equal(getWarrantyClaimKind({ createdVia: "MANUAL", saleId: "sale-1" }), "ONSITE");
});

test("the cancel note is required, trimmed and at most 500 characters", () => {
  assert.deepEqual(normalizeClaimCancelNote(undefined), { error: CLAIM_CANCEL_NOTE_REQUIRED_ERROR });
  assert.deepEqual(normalizeClaimCancelNote(null), { error: CLAIM_CANCEL_NOTE_REQUIRED_ERROR });
  assert.deepEqual(normalizeClaimCancelNote("   "), { error: CLAIM_CANCEL_NOTE_REQUIRED_ERROR });
  assert.deepEqual(normalizeClaimCancelNote("  คีย์ผิด  "), { note: "คีย์ผิด" });
  assert.deepEqual(normalizeClaimCancelNote("ก".repeat(500)), { note: "ก".repeat(500) });
  assert.deepEqual(normalizeClaimCancelNote("ก".repeat(501)), { error: CLAIM_CANCEL_NOTE_TOO_LONG_ERROR });
});

test("history line carries the details but never a claim number", () => {
  const line = buildSaleClaimCancelHistoryLine({
    cancelledAtText: "25/09/2026 10:15",
    actorName: "นวพล",
    productName: "คอมเพรสเซอร์แอร์",
    unitSeq: 2,
    lotNo: "L-01",
    claimType: "CUSTOMER_WAIT",
    symptom: "ไม่เย็น\nมีเสียงดัง",
    note: "ลูกค้าเปลี่ยนใจ",
  });
  assert.equal(
    line,
    "25/09/2026 10:15 • นวพล • คอมเพรสเซอร์แอร์ (ชิ้นที่ 2, Lot L-01) • ประเภท: ลูกค้ารอ • อาการ: ไม่เย็น มีเสียงดัง • หมายเหตุ: ลูกค้าเปลี่ยนใจ",
  );
  assert.doesNotMatch(line, /WC/);

  const noLot = buildSaleClaimCancelHistoryLine({
    cancelledAtText: "25/09/2026 10:16",
    actorName: null,
    productName: "ไส้กรอง",
    unitSeq: 1,
    lotNo: null,
    claimType: "REPLACE_NOW",
    symptom: null,
    note: "ซ้ำ",
  });
  assert.equal(noLot, "25/09/2026 10:16 • - • ไส้กรอง (ชิ้นที่ 1) • ประเภท: เปลี่ยนสินค้าทันที • อาการ: - • หมายเหตุ: ซ้ำ");
});

test("history is append-only: new lines go after the existing ones, never replacing them", () => {
  const first = appendSaleClaimCancelNote(null, "line 1");
  const second = appendSaleClaimCancelNote(first, "line 2");
  const third = appendSaleClaimCancelNote(`${second}\n`, "line 3");
  assert.equal(first, "line 1");
  assert.equal(second, "line 1\nline 2");
  assert.equal(third, "line 1\nline 2\nline 3");
  assert.deepEqual(parseSaleClaimCancelNotes(third), ["line 1", "line 2", "line 3"]);
  assert.deepEqual(parseSaleClaimCancelNotes(null), []);
  assert.deepEqual(parseSaleClaimCancelNotes("  \n "), []);
});

// ── generateClaimNo: two independent series ──────────────────────────────────

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

let storedClaimNos: string[] = [];
const lookups: string[] = [];

before(async () => {
  if (moduleMocksUnavailable) return;
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        warrantyClaim: {
          // Mirrors Postgres: startsWith + ORDER BY claimNo DESC LIMIT 1.
          findFirst: async (args: { where: { claimNo: { startsWith: string } } }) => {
            const prefix = args.where.claimNo.startsWith;
            lookups.push(prefix);
            const last = storedClaimNos.filter((no) => no.startsWith(prefix)).sort().reverse()[0];
            return last ? { claimNo: last } : null;
          },
        },
      },
    },
  });
});

const SEPT_2026 = new Date("2026-09-24T05:00:00Z");

test("WC and WCM are separate series: a WCM number is never seen by the WC lookup", { skip: moduleMocksUnavailable }, async () => {
  const { generateClaimNo } = await import("@/lib/doc-number");
  assert.equal("WCM26090007".startsWith("WC2609"), false);

  storedClaimNos = ["WC26090002", "WCM26090007"];
  lookups.length = 0;
  assert.equal(await generateClaimNo("SALE", SEPT_2026), "WC26090003");
  assert.equal(await generateClaimNo("ONSITE", SEPT_2026), "WCM26090008");
  assert.deepEqual(lookups, ["WC2609", "WCM2609"]);

  // Only on-site numbers so far: the sale series still starts at 0001.
  storedClaimNos = ["WCM26090007"];
  assert.equal(await generateClaimNo("SALE", SEPT_2026), "WC26090001");
  storedClaimNos = ["WC26090009"];
  assert.equal(await generateClaimNo("ONSITE", SEPT_2026), "WCM26090001");
});

test("a deleted (cancelled) sale claim's WC number may be reused; WCM keeps counting", { skip: moduleMocksUnavailable }, async () => {
  const { generateClaimNo } = await import("@/lib/doc-number");
  // WC26090003 was the latest and got deleted → the next sale claim reuses 0003.
  storedClaimNos = ["WC26090001", "WC26090002"];
  assert.equal(await generateClaimNo("SALE", SEPT_2026), "WC26090003");
  // On-site claims are only ever cancelled (kept), so the series never goes back.
  storedClaimNos = ["WCM26090001", "WCM26090002", "WCM26090003"];
  assert.equal(await generateClaimNo("ONSITE", SEPT_2026), "WCM26090004");
});
