import { MarketplaceFeeKind, SaleChannel } from "@/lib/generated/prisma";

/**
 * ช่องทาง marketplace ที่บันทึกด้วยการคีย์เอง (ยังไม่เชื่อม API)
 * โครงเดียวกันทุกช่องทาง — เพิ่มช่องทางใหม่ทำได้โดยเติม enum + config ที่นี่
 */
export type ManualMarketplaceChannel = Extract<SaleChannel, "SHOPEE" | "LAZADA">;

export const MANUAL_MARKETPLACE_CHANNELS: readonly ManualMarketplaceChannel[] = [
  SaleChannel.SHOPEE,
  SaleChannel.LAZADA,
];

/** prefix ของเลขที่ใบขายต่อช่องทาง — ต้องตรงกับ union ใน generateSaleNo() */
export type MarketplaceSaleDocPrefix = "SP" | "LZ";

export type MarketplaceChannelConfig = {
  channel: ManualMarketplaceChannel;
  /** ส่วนของ URL เช่น /admin/sales/lazada */
  slug: string;
  label: string;
  /** ชื่อที่ใช้ในข้อความ เช่น "เลขคำสั่งซื้อ Lazada" */
  orderRefLabel: string;
  saleDocPrefix: MarketplaceSaleDocPrefix;
  /** prefix เลขที่รอบรับเงิน เช่น LZS26080001 */
  settlementDocPrefix: string;
  /** prefix รหัสค่าใช้จ่ายที่สร้างอัตโนมัติ เช่น LZ001 */
  feeExpenseCodePrefix: string;
  holdingAccountLabel: string;
};

const CHANNEL_CONFIG: Record<ManualMarketplaceChannel, MarketplaceChannelConfig> = {
  [SaleChannel.SHOPEE]: {
    channel: SaleChannel.SHOPEE,
    slug: "shopee",
    label: "Shopee",
    orderRefLabel: "เลขคำสั่งซื้อ Shopee",
    saleDocPrefix: "SP",
    settlementDocPrefix: "SST",
    feeExpenseCodePrefix: "SHP",
    holdingAccountLabel: "บัญชีพักเงิน Shopee",
  },
  [SaleChannel.LAZADA]: {
    channel: SaleChannel.LAZADA,
    slug: "lazada",
    label: "Lazada",
    orderRefLabel: "เลขคำสั่งซื้อ Lazada",
    saleDocPrefix: "LZ",
    settlementDocPrefix: "LZS",
    feeExpenseCodePrefix: "LZD",
    holdingAccountLabel: "บัญชีพักเงิน Lazada",
  },
};

export function isManualMarketplaceChannel(value: string): value is ManualMarketplaceChannel {
  return (MANUAL_MARKETPLACE_CHANNELS as readonly string[]).includes(value);
}

export function getMarketplaceChannelConfig(
  channel: ManualMarketplaceChannel,
): MarketplaceChannelConfig {
  return CHANNEL_CONFIG[channel];
}

/** แปลง slug จาก URL กลับเป็น channel — null เมื่อไม่ใช่ช่องทางที่รองรับ */
export function resolveChannelFromSlug(slug: string): ManualMarketplaceChannel | null {
  const match = MANUAL_MARKETPLACE_CHANNELS.find(
    (channel) => CHANNEL_CONFIG[channel].slug === slug,
  );
  return match ?? null;
}

/**
 * ข้อความตั้งต้นของช่องที่อยู่บนใบขาย marketplace
 *
 * ที่อยู่จริงของผู้ซื้ออยู่ในระบบของแพลตฟอร์ม แต่ `shippingAddress` เป็นฟิลด์บังคับ
 * ของการขายแบบจัดส่ง จึงเติมข้อความนี้ให้ก่อน แอดมินพิมพ์ทับด้วยที่อยู่จริงได้
 *
 * ใบเสร็จใช้ค่านี้เทียบเพื่อ "ซ่อนแถวที่อยู่" เมื่อยังไม่มีการคีย์ที่อยู่จริง —
 * ลูกค้าจะได้ไม่เห็นประโยคที่เขียนไว้คุยกันเองภายในร้าน
 */
export function getDefaultMarketplaceShippingAddress(
  channel: ManualMarketplaceChannel,
): string {
  return `จัดส่งตามที่อยู่ในคำสั่งซื้อ ${CHANNEL_CONFIG[channel].label}`;
}

export type MarketplaceFeeOption = {
  code: string;
  label: string;
  kind: MarketplaceFeeKind;
};

/**
 * รายการหัก (FEE) — เก็บเป็นยอดติดลบเสมอในฐานข้อมูล
 * PENALTY ใช้กับเคสคืนเงินลูกค้าโดยไม่มีสินค้ากลับมา (refund only / ชดเชย / ค่าปรับ)
 * ซึ่งไม่ออกใบลดหนี้เพราะไม่มีการรับสินค้าคืนเข้าสต็อก
 */
export const MARKETPLACE_FEE_OPTIONS: readonly MarketplaceFeeOption[] = [
  { code: "COMMISSION", label: "ค่าคอมมิชชัน", kind: MarketplaceFeeKind.FEE },
  { code: "PAYMENT", label: "ค่าธรรมเนียมการชำระเงิน", kind: MarketplaceFeeKind.FEE },
  { code: "SERVICE", label: "ค่าบริการ", kind: MarketplaceFeeKind.FEE },
  { code: "SHIPPING", label: "ส่วนต่างค่าจัดส่ง", kind: MarketplaceFeeKind.FEE },
  { code: "PROGRAM", label: "ค่าธรรมเนียมโปรแกรม/แคมเปญ", kind: MarketplaceFeeKind.FEE },
  { code: "MARKETING", label: "ค่าโฆษณา/สปอนเซอร์", kind: MarketplaceFeeKind.FEE },
  { code: "PENALTY", label: "ค่าปรับ/ชดเชยลูกค้า (ไม่มีของคืน)", kind: MarketplaceFeeKind.FEE },
  { code: "FEE_OTHER", label: "รายการหักอื่น", kind: MarketplaceFeeKind.FEE },
];

/** รายการปรับปรุง (ADJUSTMENT) — เป็นบวกหรือลบก็ได้ ผู้ใช้กรอกเครื่องหมายเอง */
export const MARKETPLACE_ADJUSTMENT_OPTIONS: readonly MarketplaceFeeOption[] = [
  { code: "SUBSIDY", label: "เงินสนับสนุนค่าจัดส่ง", kind: MarketplaceFeeKind.ADJUSTMENT },
  { code: "BONUS", label: "โบนัส/ส่งเสริมการขายจากแพลตฟอร์ม", kind: MarketplaceFeeKind.ADJUSTMENT },
  { code: "COMPENSATION", label: "เงินชดเชยจากแพลตฟอร์ม", kind: MarketplaceFeeKind.ADJUSTMENT },
  { code: "CARRYOVER", label: "ยอดข้ามงวด", kind: MarketplaceFeeKind.ADJUSTMENT },
  { code: "ROUNDING", label: "ปัดเศษ", kind: MarketplaceFeeKind.ADJUSTMENT },
  { code: "ADJ_OTHER", label: "รายการปรับปรุงอื่น", kind: MarketplaceFeeKind.ADJUSTMENT },
];

export const MARKETPLACE_LINE_OPTIONS: readonly MarketplaceFeeOption[] = [
  ...MARKETPLACE_FEE_OPTIONS,
  ...MARKETPLACE_ADJUSTMENT_OPTIONS,
];

export function findMarketplaceLineOption(code: string): MarketplaceFeeOption | undefined {
  return MARKETPLACE_LINE_OPTIONS.find((option) => option.code === code);
}
