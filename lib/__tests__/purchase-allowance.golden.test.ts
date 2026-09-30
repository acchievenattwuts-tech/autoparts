import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma, ProfitSourceType } from "@/lib/generated/prisma";
import { parseDateOnlyToDate } from "@/lib/th-date";
import { calcVat } from "@/lib/vat";
import { isInputVatRecoverable } from "@/lib/input-vat";
import {
  getLaterGroupSources, isStockValueResidualRow, replayStockCardMavg, sortRowsForReplay, writeStockCard,
} from "@/lib/stock-card";
import {
  allocatePurchaseAllowanceAmounts, postsPurchaseAllowance, preparePurchaseAllowanceCreate, PurchaseAllowanceError,
  resolvePurchaseAllowancePostingDate, type PurchaseAllowanceSourceLine,
} from "@/lib/purchase-allowance";
import { planSaleCostRestatement, restatementDates, summarizeSaleCostRestatement } from "@/lib/sale-cost-restatement";
import {
  assertStockWriteDateAllowed, buildMutationBlockMessage, buildMutationBlockReferenceLinks, buildRewrittenStockRowsWhere,
  buildStockBoundaryReason, checkRewrittenStockRows, createDocumentMutationGuard, DocumentMutationBlockedError,
  getStockDocumentDebitBlocks, STOCK_EDIT_BOUNDARY_REASON, type GuardDb, type MutationBlockReference,
} from "@/lib/document-mutation-guard";
import { getSupplierDebitProfitLabel, rebuildPurchaseAllowanceProfitFacts } from "@/lib/profit-fact";

/**
 * V8 "ลดราคาซื้อ" (owner approved 2026-09-30, W1–W7): a DISCOUNT/OTHER purchase return lowers stock cost through a
 * negative value-only PURCHASE_ALLOWANCE row, exactly like a negative supplier-DN adjustment. Hand-calculated goldens.
 */

const D = (value: number): Prisma.Decimal => new Prisma.Decimal(value);
const day = (key: string): Date => parseDateOnlyToDate(key);
type ReplayRow = Parameters<typeof replayStockCardMavg>[0][number];
const row = (id: string, key: string, sorder: number, source: string, qtyIn: number, qtyOut: number, priceIn: number,
  options: { valueAdjustment?: number; costVariance?: number; epoch?: number } = {}): ReplayRow => ({
  id, docDate: day(key), sorder, source, qtyIn: D(qtyIn), qtyOut: D(qtyOut), priceIn: D(priceIn), landedCost: D(0),
  usesReferenceCost: false, valueAdjustment: D(options.valueAdjustment ?? 0), costVariance: D(options.costVariance ?? 0),
  valuationEpoch: options.epoch ?? 0, qtyBalance: D(-999), priceBalance: D(-999), priceOut: D(-999),
});
const replay = (rows: ReplayRow[]) => {
  const seen = new Map<string, { priceOut: number; qtyBalance: number; priceBalance: number; costVariance: number }>();
  const result = replayStockCardMavg(sortRowsForReplay(rows), (item) => seen.set(item.id, item));
  return { ...result, seen };
};

describe("V8 replay: a PURCHASE_ALLOWANCE row is a negative value-only posting", () => {
  it("receive 10 @100, sell 6, allowance -80 on the 4 left: average 100 → 80, posted variance -120 kept", () => {
    const result = replay([
      row("rr", "2026-09-29", 1, "PURCHASE", 10, 0, 100),
      row("sa1", "2026-09-29", 2, "SALE", 0, 6, 0),
      row("pa", "2026-09-30", 3, "PURCHASE_ALLOWANCE", 0, 0, 0, { valueAdjustment: -80, costVariance: -120, epoch: 1 }),
      row("sa2", "2026-09-30", 4, "SALE", 0, 1, 0, { epoch: 1 }),
    ]);
    assert.equal(result.seen.get("sa1")?.priceOut, 100);
    assert.deepEqual(result.seen.get("pa"), { id: "pa", priceOut: 100, qtyBalance: 4, priceBalance: 80, costVariance: -120 });
    assert.equal(result.seen.get("sa2")?.priceOut, 80, "a later sale takes the lowered average");
    assert.equal(result.finalPrice, 80);
    assert.deepEqual(result.residuals, []);
    assert.equal(result.updates.find((update) => update.id === "pa")?.costVariance, null,
      "the replay never rewrites the posted variance of a value-only row");
  });

  it("a same-day sale keyed before the posting stays at the old cost (valuation epoch)", () => {
    const result = replay([
      row("rr", "2026-09-29", 1, "PURCHASE", 10, 0, 100),
      row("sa1", "2026-09-29", 2, "SALE", 0, 6, 0),
      row("pa", "2026-09-30", 3, "PURCHASE_ALLOWANCE", 0, 0, 0, { valueAdjustment: -60, costVariance: -140, epoch: 1 }),
      row("early", "2026-09-30", 4, "SALE", 0, 1, 0, { epoch: 0 }),
      row("late", "2026-09-30", 5, "SALE", 0, 1, 0, { epoch: 1 }),
    ]);
    assert.equal(result.seen.get("early")?.priceOut, 100);
    assert.equal(result.seen.get("pa")?.priceBalance, 80);
    assert.equal(result.seen.get("late")?.priceOut, 80);
  });

  it("zero coverage posts no inventory change; a reduction beyond the stock value is clamped (T3 write-off)", () => {
    const zero = replay([
      row("rr", "2026-09-29", 1, "PURCHASE", 10, 0, 100), row("sa", "2026-09-29", 2, "SALE", 0, 10, 0),
      row("pa", "2026-09-30", 3, "PURCHASE_ALLOWANCE", 0, 0, 0, { valueAdjustment: 0, costVariance: -200, epoch: 1 }),
    ]);
    assert.equal(zero.seen.get("pa")?.costVariance, -200);
    assert.deepEqual(zero.residuals, []);
    const clamped = replay([
      row("rr", "2026-09-29", 1, "PURCHASE", 4, 0, 25),
      row("pa", "2026-09-30", 2, "PURCHASE_ALLOWANCE", 0, 0, 0, { valueAdjustment: -150, costVariance: 0, epoch: 1 }),
    ]);
    assert.deepEqual(clamped.residuals.map((item) => [item.source, item.amount]), [["PURCHASE_ALLOWANCE", -50]]);
    assert.equal(clamped.finalPrice, 0);
  });

  it("sorts first within its epoch and owns its variance like a DN row", () => {
    assert.equal(isStockValueResidualRow({ source: "PURCHASE_ALLOWANCE", docDate: day("2026-10-01") }), false);
    assert.ok(getLaterGroupSources("PURCHASE_ALLOWANCE").includes("SALE"));
    assert.ok(!getLaterGroupSources("PURCHASE_ALLOWANCE").includes("SUPPLIER_DEBIT"));
    assert.throws(() => replay([row("pa", "2026-09-30", 1, "PURCHASE_ALLOWANCE", 1, 0, 0)]), /quantity/);
  });
});

describe("W2/W3: which returns post and the cost each line removes", () => {
  const registered = day("2026-01-01");
  const decide = (vatType: string, taxInvoiceDate: string, registeredFrom: Date | null): boolean =>
    isInputVatRecoverable({ vatType, vatRate: 7, taxDocumentDate: day(taxInvoiceDate), registeredFrom });
  const amounts = (lineAmounts: number[], vatType: "NO_VAT" | "EXCLUDING_VAT" | "INCLUDING_VAT", vatRecoverable: boolean) => {
    const total = lineAmounts.reduce((sum, amount) => sum + amount, 0);
    const { subtotalAmount, netAmount } = calcVat(total, vatType, vatType === "NO_VAT" ? 0 : 7);
    return allocatePurchaseAllowanceAmounts({ lineAmounts, subtotalAmount, netAmount, vatRecoverable });
  };

  it("DISCOUNT and OTHER post; RETURN and a warranty-claim settlement do not", () => {
    assert.equal(postsPurchaseAllowance({ type: "DISCOUNT" }), true);
    assert.equal(postsPurchaseAllowance({ type: "OTHER", claimId: null }), true);
    assert.equal(postsPurchaseAllowance({ type: "RETURN" }), false);
    assert.equal(postsPurchaseAllowance({ type: "OTHER", claimId: "claim-1" }), false);
  });

  it("NO_VAT 20 x 10 removes 200", () => {
    assert.deepEqual(amounts([200], "NO_VAT", false), [200]);
  });

  it("INCLUDING_VAT 214: recoverable (registered before the purchase's tax date) removes 200, otherwise 214", () => {
    assert.equal(decide("INCLUDING_VAT", "2026-09-01", registered), true);
    assert.deepEqual(amounts([214], "INCLUDING_VAT", decide("INCLUDING_VAT", "2026-09-01", registered)), [200]);
    assert.deepEqual(amounts([214], "INCLUDING_VAT", decide("INCLUDING_VAT", "2026-09-01", null)), [214]);
  });

  it("EXCLUDING_VAT 200: recoverable removes 200, otherwise the VAT-inclusive 214", () => {
    assert.deepEqual(amounts([200], "EXCLUDING_VAT", true), [200]);
    assert.deepEqual(amounts([200], "EXCLUDING_VAT", false), [214]);
  });

  it("several lines split the header to the satang and always sum to it", () => {
    assert.deepEqual(amounts([107, 53.5], "INCLUDING_VAT", true), [100, 50]);
    // 300 incl. 7 % → VAT 19.63, subtotal 280.37 → 93.46 + 93.46 + 93.45.
    assert.deepEqual(amounts([100, 100, 100], "INCLUDING_VAT", true), [93.46, 93.46, 93.45]);
  });
});

type FindFirstArgs = { where: { docDate?: unknown; OR?: unknown } };
const coverageTx = (onHand: number | null, future: { docNo: string } | null = null) => ({
  stockCard: {
    findFirst: async (args: FindFirstArgs) => {
      const { where } = args;
      if (where.docDate && typeof where.docDate === "object" && "gt" in where.docDate) return future;
      if (where.OR) return onHand === null ? null : { qtyBalance: D(onHand) };
      return { valuationEpoch: 0 };
    },
  },
}) as unknown as Parameters<typeof preparePurchaseAllowanceCreate>[0];
const POSTING = day("2026-09-30");
const line = (overrides: Partial<PurchaseAllowanceSourceLine> = {}): PurchaseAllowanceSourceLine => ({
  lineNo: 1, productId: "sku-1", qtyInBase: 10, costAmount: 200, isTracked: true, ...overrides,
});

describe("W1: coverage = the SKU's on-hand at the new posting position", () => {
  it("4 of 10 units on hand: inventory -80, variance -120, posted today after the day's rows (epoch 1)", async () => {
    const prepared = await preparePurchaseAllowanceCreate(coverageTx(4), { postingDate: POSTING, lines: [line()] });
    assert.deepEqual(prepared.lines, [{ lineNo: 1, productId: "sku-1", affectedBaseQuantity: 10, costAmount: 200,
      eligibleBaseQuantity: 4, inventoryAmount: -80, varianceAmount: -120 }]);
    assert.deepEqual(prepared.positions.get("sku-1"), { docDate: POSTING, valuationEpoch: 1 });
  });

  it("stock already 0 (or negative, or never received): the whole amount is variance", async () => {
    for (const onHand of [0, -3, null]) {
      const prepared = await preparePurchaseAllowanceCreate(coverageTx(onHand), { postingDate: POSTING, lines: [line()] });
      assert.equal(prepared.lines[0].inventoryAmount, 0);
      assert.ok(Object.is(prepared.lines[0].inventoryAmount, 0), "never -0");
      assert.equal(prepared.lines[0].varianceAmount, -200);
    }
  });

  it("more on hand than the affected quantity lowers inventory by the whole amount", async () => {
    const prepared = await preparePurchaseAllowanceCreate(coverageTx(25), { postingDate: POSTING, lines: [line()] });
    assert.equal(prepared.lines[0].inventoryAmount, -200);
    assert.ok(Object.is(prepared.lines[0].varianceAmount, 0));
  });

  it("duplicate lines of one SKU share its coverage once; untracked and zero-cost lines post nothing", async () => {
    const prepared = await preparePurchaseAllowanceCreate(coverageTx(4), { postingDate: POSTING, lines: [
      line({ lineNo: 1, qtyInBase: 5, costAmount: 100 }), line({ lineNo: 2, qtyInBase: 5, costAmount: 100 }),
      line({ lineNo: 3, productId: "service", isTracked: false }), line({ lineNo: 4, productId: "free", costAmount: 0 }),
    ] });
    assert.deepEqual(prepared.lines.map((item) => [item.lineNo, item.eligibleBaseQuantity, item.inventoryAmount, item.varianceAmount]),
      [[1, 2, -40, -60], [2, 2, -40, -60]]);
  });

  it("a stock row dated after today is refused (like a DN) before anything is written", async () => {
    await assert.rejects(preparePurchaseAllowanceCreate(coverageTx(4, { docNo: "SA26100001" }), { postingDate: POSTING, lines: [line()] }),
      (error: unknown) => error instanceof PurchaseAllowanceError && error.message.includes("SA26100001"));
  });

  it("W5: the posting date is the stored rows' date, else the return's creation date (Thai business day)", () => {
    const createdAt = new Date("2026-09-30T18:30:00.000Z"); // 01:30 on 1 Oct in Thailand
    assert.deepEqual(resolvePurchaseAllowancePostingDate([], createdAt), day("2026-10-01"));
    const stored = { id: "sc", productId: "sku-1", docDate: day("2026-09-29"), valuationEpoch: 1, referenceId: "pri-1",
      valueAdjustment: -80, costVariance: -120 };
    assert.deepEqual(resolvePurchaseAllowancePostingDate([stored], createdAt), day("2026-09-29"));
  });
});

describe("W5: editing or cancelling restates later sales (lib/sale-cost-restatement.ts, source PURCHASE_ALLOWANCE)", () => {
  const card = (id: string, key: string, sorder: number, source: string, qtyIn: number, qtyOut: number, priceIn: number,
    docNo: string, referenceId: string | null, options: { valueAdjustment?: number; costVariance?: number; epoch?: number } = {}) => ({
    ...row(id, key, sorder, source, qtyIn, qtyOut, priceIn, options), productId: "sku-1", docNo, referenceId,
  });
  const stored = [
    card("rr", "2026-09-20", 1, "PURCHASE", 10, 0, 100, "RR1", "pi-1"),
    card("sa1", "2026-09-21", 2, "SALE", 0, 6, 0, "SA1", "si-1"),
    card("pa", "2026-09-29", 3, "PURCHASE_ALLOWANCE", 0, 0, 0, "PR1", "pri-1", { valueAdjustment: -80, costVariance: -120, epoch: 1 }),
    card("sa2", "2026-09-30", 4, "SALE", 0, 2, 0, "SA2", "si-2"),
  ];
  const saleItems = [
    { id: "si-1", saleId: "sale-1", productId: "sku-1", quantity: D(6), costPrice: D(100),
      sale: { saleNo: "SA1", saleDate: day("2026-09-21"), status: "ACTIVE" } },
    { id: "si-2", saleId: "sale-2", productId: "sku-1", quantity: D(2), costPrice: D(80),
      sale: { saleNo: "SA2", saleDate: day("2026-09-30"), status: "ACTIVE" } },
  ];
  const client = {
    stockCard: { findMany: async () => stored },
    saleItem: { findMany: async (args: { where: { id?: { in: string[] } } }) =>
      saleItems.filter((item) => args.where.id?.in.includes(item.id) ?? false) },
    creditNoteItem: { findMany: async () => [] },
  } as unknown as Parameters<typeof planSaleCostRestatement>[0];

  it("cancel: the later sale goes back from 80 to 100; the earlier sale never moves", async () => {
    const plan = await planSaleCostRestatement(client, { productIds: ["sku-1"], debitNo: "PR1", source: "PURCHASE_ALLOWANCE", replacements: [] });
    assert.deepEqual(plan.saleItems.map((item) => [item.id, item.before, item.after]), [["si-2", 80, 100]]);
    assert.deepEqual(restatementDates(plan), [day("2026-09-30")]);
    assert.equal(summarizeSaleCostRestatement(plan).delta, 40);
  });

  it("edit 20 → 10 per unit reposted at the original position (-40): the later sale becomes 90", async () => {
    const plan = await planSaleCostRestatement(client, { productIds: ["sku-1"], debitNo: "PR1", source: "PURCHASE_ALLOWANCE",
      replacements: [{ productId: "sku-1", docDate: day("2026-09-29"), valuationEpoch: 1, valueAdjustment: -40 }] });
    assert.deepEqual(plan.saleItems.map((item) => [item.id, item.before, item.after]), [["si-2", 80, 90]]);
    assert.equal(summarizeSaleCostRestatement(plan).delta, 20);
  });

  it("the source keys the rows: a DN plan with the same number leaves the allowance untouched", async () => {
    const plan = await planSaleCostRestatement(client, { productIds: ["sku-1"], debitNo: "PR1", replacements: [] });
    assert.deepEqual(plan.saleItems, []);
  });
});

describe("W6: earlier stock documents follow the phase-1 rules after a ลดราคาซื้อ", () => {
  const posting = day("2026-09-29");
  const allowanceRow = { productId: "sku-1", docNo: "PR26090001", docDate: posting, sorder: 9, valuationEpoch: 1, source: "PURCHASE_ALLOWANCE" };
  const debitRow = { productId: "sku-1", docNo: "SDN26090001", docDate: posting, sorder: 10, valuationEpoch: 2, source: "SUPPLIER_DEBIT" };
  type Query = { where?: Record<string, unknown> };
  const isValueQuery = (where: Record<string, unknown>): boolean => JSON.stringify(where.source ?? null).includes("PURCHASE_ALLOWANCE");
  const database = (options: { active?: boolean; later?: Array<Record<string, unknown>>; own?: Array<Record<string, unknown>>;
    stockQueries?: Query[] } = {}): GuardDb => ({
    stockCard: { findMany: async (args) => {
      options.stockQueries?.push(args as Query);
      const where = (args as Query).where ?? {};
      return isValueQuery(where) ? options.later ?? [allowanceRow]
        : options.own ?? [{ productId: "sku-1", docNo: "SA26090001", docDate: day("2026-09-20"), sorder: 2, valuationEpoch: 0, source: "SALE" }];
    } },
    sale: { findMany: async () => [{ id: "sale-1", saleNo: "SA26090001" }] },
    purchaseReturn: { findMany: async (args) => {
      const where = (args as Query).where ?? {};
      if ("returnNo" in where) return options.active === false ? [] : [{ id: "pr-1", returnNo: "PR26090001" }];
      return [{ id: "pr-1", returnNo: "PR26090001" }];
    } },
    supplierDebitNote: { findMany: async () => [{ id: "dn-1", debitNo: "SDN26090001" }] },
    supplierPaymentItem: { findMany: async () => [] },
  });

  it("cancelling an earlier sale is blocked with the purchase return link and the ลดราคาซื้อ wording", async () => {
    const result = await createDocumentMutationGuard(database()).check("Sale", "sale-1", "cancel");
    assert.equal(result.blocked, true);
    assert.deepEqual(buildMutationBlockReferenceLinks(result), [{ href: "/admin/purchase-returns/pr-1", label: "PR26090001" }]);
    assert.equal(buildMutationBlockMessage(result),
      "ไม่สามารถดำเนินการได้ เนื่องจากรายการสต็อกถูกใช้คำนวณใบลดหนี้ซื้อ (ลดราคาซื้อ)แล้ว กรุณายกเลิกเอกสารปลายทางก่อน: PR26090001");
  });

  it("a header-only edit passes; an edit that rewrites a stock row before it is blocked with the edit reason", async () => {
    assert.equal((await createDocumentMutationGuard(database()).check("Sale", "sale-1", "update")).blocked, false);
    const rewritten = await checkRewrittenStockRows(database(), buildRewrittenStockRowsWhere("SA26090001", ["si-1"]));
    assert.equal(rewritten.blocked, true);
    assert.ok(rewritten.reason?.includes("ใบลดหนี้ซื้อ (ลดราคาซื้อ)"), rewritten.reason ?? "");
    assert.equal(await checkRewrittenStockRows(database(), null).then((result) => result.blocked), false);
  });

  it("a cancelled purchase return no longer blocks", async () => {
    assert.equal((await createDocumentMutationGuard(database({ active: false })).check("Sale", "sale-1", "cancel")).blocked, false);
  });

  it("a DN and a ลดราคาซื้อ together name both; a DN alone keeps its original wording", async () => {
    const result = await createDocumentMutationGuard(database({ later: [allowanceRow, debitRow] })).check("Sale", "sale-1", "cancel");
    assert.deepEqual(result.references.map((ref) => ref.entityType).sort(), ["PurchaseReturn", "SupplierDebitNote"]);
    assert.ok(result.reason?.includes("ใบเพิ่มหนี้และใบลดหนี้ซื้อ (ลดราคาซื้อ)"));
    const debitOnly: MutationBlockReference[] = [{ entityType: "SupplierDebitNote", id: "dn-1", refNo: "SDN26090001" }];
    assert.equal(buildStockBoundaryReason(debitOnly), "รายการสต็อกถูกใช้คำนวณใบเพิ่มหนี้แล้ว กรุณายกเลิกเอกสารปลายทางก่อน");
    assert.equal(STOCK_EDIT_BOUNDARY_REASON,
      "รายการสินค้าที่ลบหรือแก้ไขมีสต็อกที่ถูกใช้คำนวณใบเพิ่มหนี้แล้ว แก้ไขได้เฉพาะข้อมูลที่ไม่กระทบสต็อก หรือยกเลิกใบเพิ่มหนี้ก่อน");
  });

  it("the allowance return's own value-only rows are never a boundary (its cancel restates instead)", async () => {
    const stockQueries: Query[] = [];
    const result = await createDocumentMutationGuard(database({ own: [allowanceRow], later: [debitRow], stockQueries }))
      .check("PurchaseReturn", "pr-1", "cancel");
    assert.equal(result.blocked, false);
    assert.equal(stockQueries.length, 1, "only its own rows are read; no later-row query");
  });

  it("list pages and bulk purchase writes share the same boundary", async () => {
    const blocks = await getStockDocumentDebitBlocks(database(), ["SA26090001"]);
    assert.deepEqual(buildMutationBlockReferenceLinks(blocks.get("SA26090001")!), [{ href: "/admin/purchase-returns/pr-1", label: "PR26090001" }]);
    const tx = {
      stockCard: { findMany: async () => [{ docNo: "PR26090001", source: "PURCHASE_ALLOWANCE" }] },
      purchaseReturn: { findMany: async () => [{ id: "pr-1", returnNo: "PR26090001" }] },
      supplierDebitNote: { findMany: async () => [] },
    } as unknown as Prisma.TransactionClient;
    await assert.rejects(assertStockWriteDateAllowed(tx, ["sku-1"], day("2026-09-20")),
      (error: unknown) => error instanceof DocumentMutationBlockedError && error.message.includes("PR26090001"));
  });

  it("writeStockCard refuses a backdated row across a ลดราคาซื้อ row before inserting anything", async () => {
    let created = 0;
    const tx = {
      $queryRaw: async () => [],
      stockCard: {
        findFirst: async (args: { where: Record<string, unknown> }) =>
          (isValueQuery(args.where) ? { docNo: "PR26090001", docDate: posting, source: "PURCHASE_ALLOWANCE" } : null),
        create: async () => { created += 1; return { id: "x" }; },
      },
    } as unknown as Parameters<typeof writeStockCard>[0];
    await assert.rejects(writeStockCard(tx, { productId: "sku-1", docNo: "SA26090002", docDate: day("2026-09-25"),
      source: "SALE", qtyIn: 0, qtyOut: 1, priceIn: 0, valuationEpoch: 0 }), (error: unknown) =>
      error instanceof DocumentMutationBlockedError && error.message.startsWith("ไม่สามารถลงสต็อกย้อนหลังข้ามใบลดหนี้ซื้อ (ลดราคาซื้อ) PR26090001"));
    assert.equal(created, 0);
  });
});

describe("W4: profit facts, labels and links of a ลดราคาซื้อ", () => {
  const posting = day("2026-09-30");
  const factTx = (status: string) => {
    const created: Array<Record<string, unknown>> = [];
    const deactivated: unknown[] = [];
    const tx = {
      purchaseReturn: { findUnique: async () => ({ id: "pr-1", returnNo: "PR26093000001", status, supplierId: "sup-1",
        supplier: { name: "Supplier A" }, purchase: { purchaseNo: "RR26090001" } }) },
      stockCard: { findMany: async () => [{ id: "sc-1", docDate: posting, referenceId: "pri-1", costVariance: D(-120),
        productId: "sku-1", product: { code: "P1", name: "ไส้กรอง" } }] },
      factProfit: {
        updateMany: async (args: unknown) => { deactivated.push(args); return { count: 1 }; },
        aggregate: async () => ({ _max: { versionNo: 2 } }),
        create: async (args: { data: Record<string, unknown> }) => { created.push(args.data); return args.data; },
      },
    } as unknown as Parameters<typeof rebuildPurchaseAllowanceProfitFacts>[0];
    return { tx, created, deactivated };
  };

  it("one PURCHASE_COST_VARIANCE fact per row: -120 cost (+120 profit) dated at the posting date", async () => {
    const { tx, created, deactivated } = factTx("ACTIVE");
    await rebuildPurchaseAllowanceProfitFacts(tx, "pr-1");
    assert.deepEqual(deactivated, [{ where: { sourceType: ProfitSourceType.PURCHASE_COST_VARIANCE, sourceId: "pr-1", isActive: true },
      data: { isActive: false, supersededAt: (deactivated[0] as { data: { supersededAt: Date } }).data.supersededAt } }]);
    assert.equal(created.length, 1);
    const fact = created[0];
    assert.deepEqual([fact.businessDate, fact.sourceType, fact.sourceSubtype, fact.sourceId, fact.sourceLineId, fact.sourceDocNo,
      fact.referenceDocNo, fact.supplierName, fact.versionNo, fact.isActive],
    [posting, "PURCHASE_COST_VARIANCE", "PURCHASE_ALLOWANCE", "pr-1", "pri-1", "PR26093000001", "RR26090001", "Supplier A", 3, true]);
    assert.equal(String(fact.costAmount), "-120");
    assert.equal(String(fact.grossProfit), "120");
    assert.equal(String(fact.netProfitAmount), "120");
  });

  it("a cancelled return keeps no active fact", async () => {
    const { tx, created, deactivated } = factTx("CANCELLED");
    await rebuildPurchaseAllowanceProfitFacts(tx, "pr-1");
    assert.equal(deactivated.length, 1);
    assert.deepEqual(created, []);
  });

  it("dashboard label and links name the purchase return", async () => {
    assert.equal(getSupplierDebitProfitLabel("PURCHASE_ALLOWANCE"), "ลดราคาซื้อ");
    assert.equal(getSupplierDebitProfitLabel("SUPPLIER_DN"), "Supplier DN");
    assert.equal(getSupplierDebitProfitLabel("SUPPLIER_DN_ADJUSTMENT"), "ปรับยอด DN");
    const { buildInvoiceHref } = await import("@/app/admin/(protected)/ProfitSectionShared");
    assert.equal(buildInvoiceHref(ProfitSourceType.PURCHASE_COST_VARIANCE, "pr-1", "PURCHASE_ALLOWANCE"), "/admin/purchase-returns/pr-1");
    assert.equal(buildInvoiceHref(ProfitSourceType.PURCHASE_COST_VARIANCE, "dn-1", "SUPPLIER_DN"), "/admin/supplier-debit-notes/dn-1");
  });
});
