/**
 * Unit test (pure, ไม่แตะ DB) สำหรับกฎลำดับสต็อกการ์ดวันเดียวกัน:
 *   BF → ของเข้าทุกชนิด → ของออกทุกชนิด
 *
 * รัน: npx tsx scripts/test-stock-card-sequence.ts
 */
import assert from "node:assert/strict";

import { Prisma, StockCardSource } from "../lib/generated/prisma";
import {
  buildSorderUpdates,
  getLaterGroupSources,
  replayStockCardMavg,
  sortRowsForReplay,
  type StockReplayRow,
} from "../lib/stock-card";

const D = (iso: string): Date => new Date(`${iso}T00:00:00+07:00`);
const dec = (value: number): Prisma.Decimal => new Prisma.Decimal(value);

type RowSpec = {
  id: string;
  date: string;
  sorder: number;
  source: StockCardSource;
  qtyIn?: number;
  qtyOut?: number;
  priceIn?: number;
  landedCost?: number;
  usesReferenceCost?: boolean;
};

const row = (spec: RowSpec): StockReplayRow => ({
  id: spec.id,
  docDate: D(spec.date),
  sorder: spec.sorder,
  source: spec.source,
  qtyIn: dec(spec.qtyIn ?? 0),
  qtyOut: dec(spec.qtyOut ?? 0),
  priceIn: dec(spec.priceIn ?? 0),
  landedCost: dec(spec.landedCost ?? 0),
  usesReferenceCost: spec.usesReferenceCost ?? false,
  // ค่าที่เก็บอยู่เดิม — ตั้งเป็น 0 เพื่อให้ replay รายงาน update ทุกแถว
  qtyBalance: dec(0),
  priceBalance: dec(0),
  priceOut: dec(0),
});

const ids = (rows: { id: string }[]): string[] => rows.map((r) => r.id);

/* 1. วันเดียวกัน: ใบซื้อที่คีย์ทีหลังต้องถูกจัดมาก่อนใบขาย */
function testSameDatePurchaseBeforeSale(): void {
  const rows = [
    row({ id: "sale", date: "2026-05-27", sorder: 2, source: StockCardSource.SALE, qtyOut: 1 }),
    row({ id: "purchase", date: "2026-05-27", sorder: 3, source: StockCardSource.PURCHASE, qtyIn: 1, priceIn: 1750 }),
  ];
  assert.deepEqual(ids(sortRowsForReplay(rows)), ["purchase", "sale"]);
}

/* 2. BF ต้องมาก่อนทุกอย่างของวันเดียวกัน */
function testBalanceForwardFirst(): void {
  const rows = [
    row({ id: "sale", date: "2026-01-05", sorder: 1, source: StockCardSource.SALE, qtyOut: 1 }),
    row({ id: "purchase", date: "2026-01-05", sorder: 2, source: StockCardSource.PURCHASE, qtyIn: 5, priceIn: 100 }),
    row({ id: "bf", date: "2026-01-05", sorder: 3, source: StockCardSource.BF, qtyIn: 10, priceIn: 90 }),
  ];
  assert.deepEqual(ids(sortRowsForReplay(rows)), ["bf", "purchase", "sale"]);
}

/* 3. ของเข้าทุกชนิดมาก่อนของออกทุกชนิด และภายในกลุ่มคงลำดับที่คีย์ไว้ */
function testGroupOrderAndStableWithinGroup(): void {
  const rows = [
    row({ id: "claim-out", date: "2026-02-10", sorder: 1, source: StockCardSource.CLAIM_SEND_OUT, qtyOut: 1 }),
    row({ id: "adjust-out", date: "2026-02-10", sorder: 2, source: StockCardSource.ADJUST_OUT, qtyOut: 1 }),
    row({ id: "return-in", date: "2026-02-10", sorder: 3, source: StockCardSource.RETURN_IN, qtyIn: 1 }),
    row({ id: "adjust-in", date: "2026-02-10", sorder: 4, source: StockCardSource.ADJUST_IN, qtyIn: 1, priceIn: 50 }),
  ];
  assert.deepEqual(ids(sortRowsForReplay(rows)), ["return-in", "adjust-in", "claim-out", "adjust-out"]);
}

/* 4. ข้ามวัน: วันที่ยังสำคัญกว่ากลุ่ม source เสมอ */
function testDateBeatsGroup(): void {
  const rows = [
    row({ id: "purchase-later", date: "2026-03-02", sorder: 2, source: StockCardSource.PURCHASE, qtyIn: 1, priceIn: 10 }),
    row({ id: "sale-earlier", date: "2026-03-01", sorder: 1, source: StockCardSource.SALE, qtyOut: 1 }),
  ];
  assert.deepEqual(ids(sortRowsForReplay(rows)), ["sale-earlier", "purchase-later"]);
}

/* 5. ข้อมูลที่ลำดับถูกอยู่แล้ว ต้องไม่เกิด write ใด ๆ (ผลลัพธ์เหมือนเดิม) */
function testNoWriteWhenAlreadyOrdered(): void {
  const rows = [
    row({ id: "a", date: "2026-04-01", sorder: 1, source: StockCardSource.PURCHASE, qtyIn: 10, priceIn: 100 }),
    row({ id: "b", date: "2026-04-02", sorder: 2, source: StockCardSource.SALE, qtyOut: 3 }),
    row({ id: "c", date: "2026-04-03", sorder: 3, source: StockCardSource.PURCHASE, qtyIn: 5, priceIn: 120 }),
  ];
  assert.deepEqual(buildSorderUpdates(sortRowsForReplay(rows)), []);
}

/* 6. เรียงใหม่แล้วต้องได้เลข sorder ต่อเนื่อง 1..n */
function testResequenceProducesContiguousNumbers(): void {
  const rows = [
    row({ id: "sale", date: "2026-05-27", sorder: 2, source: StockCardSource.SALE, qtyOut: 1 }),
    row({ id: "purchase", date: "2026-05-27", sorder: 3, source: StockCardSource.PURCHASE, qtyIn: 1, priceIn: 1750 }),
    row({ id: "later", date: "2026-06-20", sorder: 4, source: StockCardSource.PURCHASE, qtyIn: 1, priceIn: 1700 }),
  ];
  // diff-write: "sale" มี sorder = 2 อยู่แล้วซึ่งตรงกับตำแหน่งใหม่ จึงไม่ถูกเขียนซ้ำ
  assert.deepEqual(buildSorderUpdates(sortRowsForReplay(rows)), [
    { id: "purchase", sorder: 1 },
    { id: "later", sorder: 3 },
  ]);

  // ตำแหน่งสุดท้ายต้องต่อเนื่อง 1..n เสมอ
  const ordered = sortRowsForReplay(rows);
  const updates = new Map(buildSorderUpdates(ordered).map((u) => [u.id, u.sorder]));
  assert.deepEqual(
    ordered.map((r) => updates.get(r.id) ?? r.sorder),
    [1, 2, 3],
  );
}

/* 7. เคสจริง P0489: ก่อนแก้ต้นทุนขาย = 0 และมูลค่าซื้อ 1,750 หาย / หลังแก้ต้องถูก */
function testRealWorldP0489(): void {
  const rows = [
    row({ id: "sale", date: "2026-05-27", sorder: 2, source: StockCardSource.SALE, qtyOut: 1 }),
    row({ id: "purchase", date: "2026-05-27", sorder: 3, source: StockCardSource.PURCHASE, qtyIn: 1, priceIn: 1750, landedCost: 19.64 }),
    row({ id: "purchase2", date: "2026-06-20", sorder: 4, source: StockCardSource.PURCHASE, qtyIn: 1, priceIn: 1700, landedCost: 25.53 }),
  ];

  // ลำดับเดิม (ตามที่เก็บอยู่จริงตอนนี้)
  const before = replayStockCardMavg(rows);
  const beforeSale = before.updates.find((u) => u.id === "sale");
  assert.equal(beforeSale?.priceOut, 0, "ก่อนแก้: ต้นทุนขายต้องเป็น 0 (อาการที่พบใน DB)");
  assert.equal(before.finalQty, 1);
  assert.equal(Number(before.finalPrice.toFixed(2)), 1725.53, "ก่อนแก้: avgCost ตรงกับที่เก็บใน DB");

  // ลำดับใหม่ตามกฎ
  const after = replayStockCardMavg(sortRowsForReplay(rows));
  const afterSale = after.updates.find((u) => u.id === "sale");
  assert.equal(afterSale?.priceOut, 1769.64, "หลังแก้: ต้นทุนขาย = 1750 + landed 19.64");
  assert.equal(afterSale?.qtyBalance, 0, "หลังแก้: ยอดคงเหลือหลังขายต้องเป็น 0 ไม่ใช่ -1");
  assert.equal(after.finalQty, 1);
  assert.equal(Number(after.finalPrice.toFixed(2)), 1725.53, "สต็อกคงเหลือ 1 ชิ้นมาจากใบซื้อ 20/06");
}

/* 8. เคสจริง P0488: จำนวนคงเหลือต้องไม่เปลี่ยน แต่ยอดต้องไม่ติดลบระหว่างทาง */
function testRealWorldP0488(): void {
  const rows = [
    row({ id: "sale", date: "2026-05-27", sorder: 2, source: StockCardSource.SALE, qtyOut: 1 }),
    row({ id: "purchase", date: "2026-05-27", sorder: 3, source: StockCardSource.PURCHASE, qtyIn: 5, priceIn: 350, landedCost: 19.64 }),
  ];
  const after = replayStockCardMavg(sortRowsForReplay(rows));
  assert.equal(after.finalQty, 4, "จำนวนคงเหลือต้องเท่าเดิม");
  assert.equal(Number(after.finalPrice.toFixed(4)), 353.928, "avgCost คงเดิม");
  const saleRow = after.updates.find((u) => u.id === "sale");
  assert.equal(saleRow?.qtyBalance, 4, "ขายหลังของเข้า → เหลือ 4 ไม่ติดลบ");
  assert.equal(saleRow?.priceOut, 353.928, "ต้นทุนขายต้องใช้ค่าเฉลี่ยหลังรับของ");
}

/* 9. getLaterGroupSources: ใช้ตัดสินว่าต้องเรียงใหม่ไหมตอนเขียนแถวใหม่ */
function testLaterGroupSources(): void {
  const forPurchase = getLaterGroupSources(StockCardSource.PURCHASE);
  assert.deepEqual(
    [...forPurchase].sort(),
    ["ADJUST_OUT", "CLAIM_REPLACE_OUT", "CLAIM_SEND_OUT", "RETURN_OUT", "SALE"],
    "ใบซื้อต้องเรียงใหม่เมื่อมีของออกวันเดียวกันอยู่แล้ว",
  );

  assert.deepEqual(getLaterGroupSources(StockCardSource.SALE), [], "ของออกไม่มีกลุ่มที่ต้องมาทีหลัง → เข้า fast path เสมอ");
  assert.deepEqual(getLaterGroupSources(StockCardSource.ADJUST_OUT), []);
  assert.equal(getLaterGroupSources(StockCardSource.BF).length, 10, "BF ต้องมาก่อนทุก source ที่เหลือ");
}

/* 10. ผลลัพธ์ MAVG ของข้อมูลที่ลำดับถูกอยู่แล้ว ต้องไม่เปลี่ยนจากเดิมเลย */
function testMavgUnchangedForOrderedData(): void {
  const rows = [
    row({ id: "bf", date: "2026-01-01", sorder: 1, source: StockCardSource.BF, qtyIn: 10, priceIn: 100 }),
    row({ id: "p1", date: "2026-01-05", sorder: 2, source: StockCardSource.PURCHASE, qtyIn: 10, priceIn: 120 }),
    row({ id: "s1", date: "2026-01-06", sorder: 3, source: StockCardSource.SALE, qtyOut: 5 }),
    row({ id: "r1", date: "2026-01-07", sorder: 4, source: StockCardSource.RETURN_IN, qtyIn: 2 }),
  ];
  const direct = replayStockCardMavg(rows);
  const sorted = replayStockCardMavg(sortRowsForReplay(rows));
  assert.deepEqual(sorted, direct, "ข้อมูลที่ลำดับถูกอยู่แล้ว ผลต้องเท่าเดิมทุกตัวเลข");
  assert.equal(direct.finalQty, 17);
  assert.equal(Number(direct.finalPrice.toFixed(4)), 110);
}

const tests: [string, () => void][] = [
  ["วันเดียวกัน: ซื้อมาก่อนขาย", testSameDatePurchaseBeforeSale],
  ["BF มาก่อนทุกอย่าง", testBalanceForwardFirst],
  ["ของเข้าทุกชนิดก่อนของออก + คงลำดับในกลุ่ม", testGroupOrderAndStableWithinGroup],
  ["วันที่สำคัญกว่ากลุ่ม source", testDateBeatsGroup],
  ["ลำดับถูกอยู่แล้ว → ไม่เขียนซ้ำ", testNoWriteWhenAlreadyOrdered],
  ["เรียงใหม่ได้เลข 1..n ต่อเนื่อง", testResequenceProducesContiguousNumbers],
  ["เคสจริง P0489", testRealWorldP0489],
  ["เคสจริง P0488", testRealWorldP0488],
  ["getLaterGroupSources", testLaterGroupSources],
  ["MAVG ของข้อมูลปกติไม่เปลี่ยน", testMavgUnchangedForOrderedData],
];

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(error instanceof Error ? error.message : error);
  }
}

console.log(failed === 0 ? `\nผ่านทั้งหมด ${tests.length} เคส` : `\nไม่ผ่าน ${failed}/${tests.length} เคส`);
process.exitCode = failed === 0 ? 0 : 1;
