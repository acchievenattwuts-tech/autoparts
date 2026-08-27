import { MarketplaceFeeKind } from "@/lib/generated/prisma";

/** ผลต่างที่ยอมรับได้ก่อนถือว่ายอดไม่ตรง (ครึ่งสตางค์) */
export const SETTLEMENT_TOLERANCE = 0.005;

export type SettlementFeeLine = {
  kind: MarketplaceFeeKind;
  /** ยอดแบบมีเครื่องหมาย: ลบ = ถูกหักจากยอดโอน, บวก = แพลตฟอร์มจ่ายเพิ่ม */
  amount: number;
};

export type SettlementCalculation = {
  /** ยอดขายรวมของใบขายที่เลือก (บวก) */
  salesAmount: number;
  /** ยอดคืนรวมของใบลดหนี้ที่เลือก (บวก — เป็นยอดที่ถูกหักออก) */
  returnAmount: number;
  /** ยอดหักรวมทุกบรรทัดที่ติดลบ (บวก) */
  feeAmount: number;
  /** ยอดรับเพิ่มรวมทุกบรรทัดที่เป็นบวก (บวก) */
  incomeAmount: number;
  /** ยอดที่ควรได้รับตามการคำนวณ */
  expectedPayout: number;
  /** ยอดเงินเข้าจริง − ยอดที่ควรได้รับ */
  difference: number;
  isBalanced: boolean;
};

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

/**
 * ยอดที่ควรได้รับ = ยอดขาย − ยอดคืน − ค่าธรรมเนียม + รายรับพิเศษ
 *
 * ทุกบรรทัดค่าธรรมเนียม/ปรับปรุงเก็บเป็นยอดมีเครื่องหมาย บรรทัดติดลบรวมเป็น feeAmount
 * (ค่าใช้จ่าย) และบรรทัดบวกรวมเป็น incomeAmount (รายรับพิเศษ) เพื่อให้ฝั่งกำไร
 * แยกสองก้อนนี้ออกจากกันได้โดยไม่ต้องตีความเครื่องหมายซ้ำ
 */
export function calculateMarketplaceSettlement(input: {
  saleAmounts: number[];
  returnAmounts: number[];
  feeLines: SettlementFeeLine[];
  payoutAmount: number;
}): SettlementCalculation {
  const salesAmount = round2(sum(input.saleAmounts));
  const returnAmount = round2(sum(input.returnAmounts.map(Math.abs)));
  const signedLines = input.feeLines.map((line) => round2(line.amount));
  const feeAmount = round2(
    sum(signedLines.filter((amount) => amount < 0).map((amount) => -amount)),
  );
  const incomeAmount = round2(sum(signedLines.filter((amount) => amount > 0)));
  const expectedPayout = round2(salesAmount - returnAmount - feeAmount + incomeAmount);
  const difference = round2(round2(input.payoutAmount) - expectedPayout);

  return {
    salesAmount,
    returnAmount,
    feeAmount,
    incomeAmount,
    expectedPayout,
    difference,
    isBalanced: Math.abs(difference) < SETTLEMENT_TOLERANCE,
  };
}

/**
 * ปันค่าธรรมเนียมสุทธิกลับไปยังแต่ละใบขายตามสัดส่วนยอดขาย เพื่อให้ค่าธรรมเนียม
 * ตกเป็นกำไรของ "วันที่ขาย" ไม่ใช่วันที่เงินเข้า (matching principle) — ใบขายที่
 * ขายเดือนก่อนแต่เพิ่งได้เงินเดือนนี้ จึงยังหักค่าธรรมเนียมในเดือนที่ขายจริง
 *
 * เศษที่เหลือจากการปัดทศนิยมถูกยกไปบรรทัดสุดท้าย ผลรวมจึงเท่ากับยอดตั้งต้นเสมอ
 */
export function allocateByShare(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const roundedTotal = round2(total);
  const positiveWeights = weights.map((weight) => Math.max(weight, 0));
  const weightTotal = sum(positiveWeights);

  if (weightTotal <= 0) {
    const share = round2(roundedTotal / weights.length);
    return weights.map((_, index) =>
      index === weights.length - 1
        ? round2(roundedTotal - share * (weights.length - 1))
        : share,
    );
  }

  const allocations: number[] = [];
  let allocated = 0;
  for (let index = 0; index < weights.length; index += 1) {
    if (index === weights.length - 1) {
      allocations.push(round2(roundedTotal - allocated));
      break;
    }
    const share = round2((roundedTotal * positiveWeights[index]) / weightTotal);
    allocations.push(share);
    allocated = round2(allocated + share);
  }
  return allocations;
}
