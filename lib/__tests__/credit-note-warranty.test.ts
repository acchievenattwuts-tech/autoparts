import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { MarketplaceReturnStockDisposition } from "@/lib/generated/prisma";
import {
  GOODS_RECEIVED_RETURN_DISPOSITIONS,
  IN_PROGRESS_CLAIM_STATUSES,
  buildInProgressClaimBlockMessage,
  getSaleLineUnitScale,
  getTargetCancelledWarrantyCount,
  planReturnWarrantyCancellation,
  toCreditNoteWarrantyAuditMeta,
  type ReturnWarrantyUnit,
} from "@/lib/credit-note-warranty";

const unit = (overrides: Partial<ReturnWarrantyUnit> & { id: string; unitSeq: number }): ReturnWarrantyUnit => ({
  lotNo: null,
  status: "ACTIVE",
  cancelledByCreditNoteId: null,
  inProgressClaimNos: [],
  hasAnyClaim: false,
  ...overrides,
});

const noLots = new Set<string>();

describe("credit-note return warranty rules", () => {
  it("cuts warranties only for lines whose goods came back", () => {
    assert.deepEqual([...GOODS_RECEIVED_RETURN_DISPOSITIONS].sort(), [
      MarketplaceReturnStockDisposition.DAMAGED_NO_RESTOCK,
      MarketplaceReturnStockDisposition.RESTOCK,
    ]);
    assert.equal(GOODS_RECEIVED_RETURN_DISPOSITIONS.includes(MarketplaceReturnStockDisposition.REFUND_ONLY), false);
  });

  it("blocks only on in-progress claims (DRAFT / SENT_TO_SUPPLIER)", () => {
    assert.deepEqual([...IN_PROGRESS_CLAIM_STATUSES].sort(), ["DRAFT", "SENT_TO_SUPPLIER"]);
  });

  it("targets one warranty per returned unit, all of them on a full return", () => {
    assert.equal(getTargetCancelledWarrantyCount(3, 1, 3), 1);
    assert.equal(getTargetCancelledWarrantyCount(3, 2, 3), 2);
    assert.equal(getTargetCancelledWarrantyCount(3, 3, 3), 3);
    assert.equal(getTargetCancelledWarrantyCount(3, 0, 3), 0);
    assert.equal(getTargetCancelledWarrantyCount(3, 1, 0), 0);
  });

  it("cuts a single whole-line warranty only when the whole line comes back", () => {
    assert.equal(getTargetCancelledWarrantyCount(3, 2, 1), 0);
    assert.equal(getTargetCancelledWarrantyCount(3, 3, 1), 1);
  });

  it("prefers the returned lot, then units without claims, then the highest unitSeq", () => {
    const plan = planReturnWarrantyCancellation({
      soldUnits: 4,
      returnedUnits: 2,
      returnedLotNos: new Set(["LOT-B"]),
      units: [
        unit({ id: "w1", unitSeq: 1, lotNo: "LOT-A" }),
        unit({ id: "w2", unitSeq: 2, lotNo: "LOT-A", hasAnyClaim: true }),
        unit({ id: "w3", unitSeq: 3, lotNo: "LOT-A" }),
        unit({ id: "w4", unitSeq: 4, lotNo: "LOT-B" }),
      ],
    });
    assert.deepEqual(plan, { cancelIds: ["w4", "w3"], blockedClaimNos: [] });
  });

  it("skips a unit with an in-progress claim when another unit can be cut", () => {
    const plan = planReturnWarrantyCancellation({
      soldUnits: 2,
      returnedUnits: 1,
      returnedLotNos: noLots,
      units: [
        unit({ id: "w1", unitSeq: 1 }),
        unit({ id: "w2", unitSeq: 2, inProgressClaimNos: ["CL001"], hasAnyClaim: true }),
      ],
    });
    assert.deepEqual(plan, { cancelIds: ["w1"], blockedClaimNos: [] });
  });

  it("blocks with the claim numbers when the return cannot avoid an in-progress claim", () => {
    const plan = planReturnWarrantyCancellation({
      soldUnits: 2,
      returnedUnits: 2,
      returnedLotNos: noLots,
      units: [
        unit({ id: "w1", unitSeq: 1 }),
        unit({ id: "w2", unitSeq: 2, inProgressClaimNos: ["CL002"], hasAnyClaim: true }),
      ],
    });
    assert.deepEqual(plan, { cancelIds: [], blockedClaimNos: ["CL002"] });
    assert.match(buildInProgressClaimBlockMessage(plan.blockedClaimNos), /CL002/);
  });

  it("allows cutting a unit whose claims are all closed", () => {
    const plan = planReturnWarrantyCancellation({
      soldUnits: 1,
      returnedUnits: 1,
      returnedLotNos: noLots,
      units: [unit({ id: "w1", unitSeq: 1, hasAnyClaim: true })],
    });
    assert.deepEqual(plan, { cancelIds: ["w1"], blockedClaimNos: [] });
  });

  it("counts units another credit note already cut toward the cumulative return", () => {
    const plan = planReturnWarrantyCancellation({
      soldUnits: 3,
      returnedUnits: 2,
      returnedLotNos: noLots,
      units: [
        unit({ id: "w1", unitSeq: 1 }),
        unit({ id: "w2", unitSeq: 2 }),
        unit({ id: "w3", unitSeq: 3, status: "CANCELLED", cancelledByCreditNoteId: "cn-earlier" }),
      ],
    });
    assert.deepEqual(plan, { cancelIds: ["w2"], blockedClaimNos: [] });
  });

  it("converts base quantities to the line's sale unit", () => {
    assert.equal(getSaleLineUnitScale({ quantity: 24, showQty: 2, unitScale: 12 }), 12);
    assert.equal(getSaleLineUnitScale({ quantity: 24, showQty: 2, unitScale: null }), 12);
    assert.equal(getSaleLineUnitScale({ quantity: 3, showQty: null, unitScale: null }), 1);
  });

  it("adds warranty audit meta only when something changed", () => {
    assert.deepEqual(toCreditNoteWarrantyAuditMeta(null), {});
    assert.deepEqual(toCreditNoteWarrantyAuditMeta({ restoredWarrantyIds: [], cancelledWarrantyIds: [] }), {});
    assert.deepEqual(toCreditNoteWarrantyAuditMeta({ restoredWarrantyIds: [], cancelledWarrantyIds: ["w1"] }), {
      warranties: { restoredWarrantyIds: [], cancelledWarrantyIds: ["w1"] },
    });
  });
});

describe("credit-note actions wire the warranty sync", () => {
  const source = readFileSync(join(process.cwd(), "app/admin/(protected)/credit-notes/actions.ts"), "utf8");

  it("create cuts warranties for RETURN credit notes", () => {
    assert.match(
      source,
      /if \(type === CreditNoteType\.RETURN\) \{\s*warrantySync = await syncCreditNoteReturnWarranties\(tx, cn\.id\);/,
    );
  });

  it("cancel restores warranties after the CN is marked CANCELLED", () => {
    const cancelBody = source.slice(source.indexOf("export async function cancelCreditNote"));
    const statusUpdate = cancelBody.indexOf('data: { status: "CANCELLED"');
    const sync = cancelBody.indexOf("syncCreditNoteReturnWarranties(tx, cnId)");
    assert.ok(statusUpdate > 0 && sync > statusUpdate);
  });

  it("update re-applies the cut after the lines are saved", () => {
    assert.match(
      source,
      /if \(oldHadStock \|\| type === CreditNoteType\.RETURN\) \{\s*warrantySync = await syncCreditNoteReturnWarranties\(tx, id\);/,
    );
  });

  it("create and update return the claim block as a user message", () => {
    assert.equal(
      source.match(/if \(err instanceof CreditNoteWarrantyClaimBlockedError\) return \{ error: err\.message \};/g)?.length,
      2,
    );
  });
});
