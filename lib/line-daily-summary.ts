import { db } from "@/lib/db";
import { getSiteConfig } from "@/lib/site-config";
import { getBangkokDayKey } from "@/lib/storefront-visitor";

const DAY_MS = 24 * 60 * 60 * 1000;
const BANGKOK_TZ_OFFSET = "+07:00";
const BANGKOK_TIMEZONE = "Asia/Bangkok";

type MoneySection = {
  salesTotal: number;
  cashSales: number;
  creditSales: number;
  cashInFromSales: number;
  cashInFromReceipts: number;
  cashInTotal: number;
  cashChannelTotal: number;
  transferChannelTotal: number;
  arOutstanding: number;
  codOutstanding: number;
  apOutstanding: number;
  expensesToday: number;
  transfersToday: number;
};

type CountSection = {
  pendingDelivery: number;
  outForDelivery: number;
  deliveredToday: number;
  lowStockCount: number;
  outOfStockCount: number;
  expiringLotCount: number;
  expiredLotCount: number;
  openClaimCount: number;
  cancelledDocumentCount: number;
  stockAdjustmentCount: number;
};

export type LineTextMessage = {
  type: "text";
  text: string;
};

export type LineFlexMessage = {
  type: "flex";
  altText: string;
  contents: Record<string, unknown>;
};

export type LinePushMessage = LineTextMessage | LineFlexMessage;

export type LineDailySummary = {
  reportDayKey: string;
  reportDateLabel: string;
  shopName: string;
  range: {
    start: Date;
    end: Date;
  };
  money: MoneySection;
  counts: CountSection;
  message: string;
  messages: LinePushMessage[];
  flexMessage: LineFlexMessage;
};

function toNumber(value: unknown): number {
  return Number(value ?? 0);
}

function isValidDayKey(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00${BANGKOK_TZ_OFFSET}`);
  return !Number.isNaN(parsed.getTime());
}

export function resolveBangkokDayKey(value?: string): string {
  return isValidDayKey(value) ? value : getBangkokDayKey();
}

function getBangkokDayRange(dayKey: string) {
  const start = new Date(`${dayKey}T00:00:00${BANGKOK_TZ_OFFSET}`);
  const end = new Date(start.getTime() + DAY_MS - 1);
  return { start, end };
}

function formatThaiDate(dayKey: string) {
  return new Date(`${dayKey}T00:00:00${BANGKOK_TZ_OFFSET}`).toLocaleDateString(
    "th-TH-u-ca-gregory",
    {
      timeZone: BANGKOK_TIMEZONE,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }
  );
}

function formatMoney(value: number) {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatCount(value: number) {
  return value.toLocaleString("th-TH");
}

function renderEmojiLineDailySummaryMessage(summary: {
  reportDateLabel: string;
  money: MoneySection;
  counts: CountSection;
}) {
  const { reportDateLabel, money, counts } = summary;

  return [
    `🌈 สรุปงานประจำวันที่ ${reportDateLabel}`,
    "",
    "💰 ยอดขายวันนี้",
    `- ขายรวม ${formatMoney(money.salesTotal)} บาท`,
    `- ขายสด ${formatMoney(money.cashSales)} บาท`,
    `- ขายเชื่อ ${formatMoney(money.creditSales)} บาท`,
    "",
    "🏦 เงินรับเข้าวันนี้",
    `- จากการขายสด ${formatMoney(money.cashInFromSales)} บาท`,
    `- จากการรับชำระหนี้ ${formatMoney(money.cashInFromReceipts)} บาท`,
    `- รวมเงินเข้า ${formatMoney(money.cashInTotal)} บาท`,
    "",
    "💸 แยกตามช่องทางรับเงิน",
    `- เงินสด ${formatMoney(money.cashChannelTotal)} บาท`,
    `- เงินโอน ${formatMoney(money.transferChannelTotal)} บาท`,
    "",
    "📌 ยอดค้าง",
    `- ลูกหนี้ค้างรับ ${formatMoney(money.arOutstanding)} บาท`,
    `- COD ค้างรับเงิน ${formatMoney(money.codOutstanding)} บาท`,
    `- เจ้าหนี้ค้างจ่าย ${formatMoney(money.apOutstanding)} บาท`,
    "",
    "🚚 งานจัดส่ง",
    `- รอจัดส่ง ${formatCount(counts.pendingDelivery)} รายการ`,
    `- กำลังจัดส่ง ${formatCount(counts.outForDelivery)} รายการ`,
    `- ส่งสำเร็จวันนี้ ${formatCount(counts.deliveredToday)} รายการ`,
    "",
    "📦 สต๊อก",
    `- ต่ำกว่าขั้นต่ำ ${formatCount(counts.lowStockCount)} รายการ`,
    `- ของหมด ${formatCount(counts.outOfStockCount)} รายการ`,
    `- lot ใกล้หมดอายุ ${formatCount(counts.expiringLotCount)} lot`,
    `- lot หมดอายุค้างสต๊อก ${formatCount(counts.expiredLotCount)} lot`,
    "",
    "🛠️ เคลม/เอกสารผิดปกติ",
    `- เคลมค้างดำเนินการ ${formatCount(counts.openClaimCount)} รายการ`,
    `- เอกสารถูกยกเลิกวันนี้ ${formatCount(counts.cancelledDocumentCount)} รายการ`,
    `- ปรับสต๊อกวันนี้ ${formatCount(counts.stockAdjustmentCount)} เอกสาร`,
    "",
    "✨ สรุปเพิ่มเติม",
    `- ค่าใช้จ่ายวันนี้ ${formatMoney(money.expensesToday)} บาท`,
    `- เงินโอนระหว่างบัญชีวันนี้ ${formatMoney(money.transfersToday)} บาท`,
  ].join("\n");
}

function buildSummaryFactRows(items: Array<{ label: string; value: string }>) {
  return items.flatMap((item, index) => [
    {
      type: "box",
      layout: "baseline",
      spacing: "md",
      contents: [
        {
          type: "text",
          text: item.label,
          size: "sm",
          color: "#64748B",
          flex: 4,
          wrap: true,
        },
        {
          type: "text",
          text: item.value,
          size: "sm",
          color: "#0F172A",
          weight: "bold",
          flex: 5,
          wrap: true,
          align: "end",
        },
      ],
    },
    ...(index === items.length - 1
      ? []
      : [
          {
            type: "separator",
            margin: "md",
            color: "#E2E8F0",
          },
        ]),
  ]);
}

function buildLineDailySummaryFlexMessage(summary: {
  reportDateLabel: string;
  money: MoneySection;
  counts: CountSection;
}): LineFlexMessage {
  const { reportDateLabel, money, counts } = summary;
  const followUpCount =
    counts.pendingDelivery +
    counts.lowStockCount +
    counts.outOfStockCount +
    counts.openClaimCount +
    counts.cancelledDocumentCount;

  return {
    type: "flex",
    altText: `สรุปงานประจำวันที่ ${reportDateLabel}`,
    contents: {
      type: "bubble",
      size: "giga",
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "20px",
        spacing: "lg",
        backgroundColor: "#F8FAFC",
        contents: [
          {
            type: "box",
            layout: "vertical",
            paddingAll: "16px",
            cornerRadius: "20px",
            background: {
              type: "linearGradient",
              angle: "0deg",
              startColor: "#16A34A",
              endColor: "#0F766E",
            },
            contents: [
              {
                type: "text",
                text: "SME Daily Closing",
                size: "xs",
                color: "#DCFCE7",
                weight: "bold",
              },
              {
                type: "text",
                text: `🌈 สรุปงานประจำวันที่ ${reportDateLabel}`,
                margin: "md",
                size: "xl",
                color: "#FFFFFF",
                weight: "bold",
                wrap: true,
              },
              {
                type: "box",
                layout: "vertical",
                margin: "lg",
                spacing: "md",
                contents: [
                  {
                    type: "box",
                    layout: "horizontal",
                    spacing: "md",
                    contents: [
                      {
                        type: "box",
                        layout: "vertical",
                        cornerRadius: "14px",
                        paddingAll: "12px",
                        backgroundColor: "#FFFFFF1A",
                        flex: 1,
                        contents: [
                          {
                            type: "text",
                            text: "ยอดขายรวม",
                            size: "xs",
                            color: "#DCFCE7",
                          },
                          {
                            type: "text",
                            text: `฿${formatMoney(money.salesTotal)}`,
                            margin: "sm",
                            size: "lg",
                            color: "#FFFFFF",
                            weight: "bold",
                            wrap: true,
                          },
                        ],
                      },
                      {
                        type: "box",
                        layout: "vertical",
                        cornerRadius: "14px",
                        paddingAll: "12px",
                        backgroundColor: "#FFFFFF1A",
                        flex: 1,
                        contents: [
                          {
                            type: "text",
                            text: "ขายเงินสด",
                            size: "xs",
                            color: "#DCFCE7",
                          },
                          {
                            type: "text",
                            text: `฿${formatMoney(money.cashSales)}`,
                            margin: "sm",
                            size: "lg",
                            color: "#FFFFFF",
                            weight: "bold",
                            wrap: true,
                          },
                        ],
                      },
                    ],
                  },
                  {
                    type: "box",
                    layout: "horizontal",
                    spacing: "md",
                    contents: [
                      {
                        type: "box",
                        layout: "vertical",
                        cornerRadius: "14px",
                        paddingAll: "12px",
                        backgroundColor: "#FFFFFF1A",
                        flex: 1,
                        contents: [
                          {
                            type: "text",
                            text: "ขายเงินเชื่อ",
                            size: "xs",
                            color: "#DCFCE7",
                          },
                          {
                            type: "text",
                            text: `฿${formatMoney(money.creditSales)}`,
                            margin: "sm",
                            size: "lg",
                            color: "#FFFFFF",
                            weight: "bold",
                            wrap: true,
                          },
                        ],
                      },
                      {
                        type: "box",
                        layout: "vertical",
                        cornerRadius: "14px",
                        paddingAll: "12px",
                        backgroundColor: "#FFFFFF1A",
                        flex: 1,
                        contents: [
                          {
                            type: "text",
                            text: "รายการต้องติดตาม",
                            size: "xs",
                            color: "#DCFCE7",
                          },
                          {
                            type: "text",
                            text: formatCount(followUpCount),
                            margin: "sm",
                            size: "lg",
                            color: "#FFFFFF",
                            weight: "bold",
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: "box",
            layout: "vertical",
            cornerRadius: "18px",
            paddingAll: "16px",
            backgroundColor: "#FFFFFF",
            contents: [
              {
                type: "text",
                text: "💸 เงินเข้าและยอดค้าง",
                size: "md",
                weight: "bold",
                color: "#0F172A",
              },
              {
                type: "box",
                layout: "vertical",
                margin: "lg",
                spacing: "md",
                contents: buildSummaryFactRows([
                  { label: "เงินเข้ารวม", value: `฿${formatMoney(money.cashInTotal)}` },
                  { label: "เงินสด", value: `฿${formatMoney(money.cashChannelTotal)}` },
                  { label: "เงินโอน", value: `฿${formatMoney(money.transferChannelTotal)}` },
                  { label: "ลูกหนี้ค้างรับ", value: `฿${formatMoney(money.arOutstanding)}` },
                  { label: "COD ค้างรับเงิน", value: `฿${formatMoney(money.codOutstanding)}` },
                  { label: "เจ้าหนี้ค้างจ่าย", value: `฿${formatMoney(money.apOutstanding)}` },
                ]),
              },
            ],
          },
          {
            type: "box",
            layout: "vertical",
            cornerRadius: "18px",
            paddingAll: "16px",
            backgroundColor: "#FFFFFF",
            contents: [
              {
                type: "text",
                text: "🚚 งานค้างและความเสี่ยง",
                size: "md",
                weight: "bold",
                color: "#0F172A",
              },
              {
                type: "box",
                layout: "vertical",
                margin: "lg",
                spacing: "md",
                contents: buildSummaryFactRows([
                  { label: "รอจัดส่ง", value: `${formatCount(counts.pendingDelivery)} รายการ` },
                  { label: "กำลังจัดส่ง", value: `${formatCount(counts.outForDelivery)} รายการ` },
                  { label: "สต๊อกต่ำขั้นต่ำ", value: `${formatCount(counts.lowStockCount)} รายการ` },
                  { label: "ของหมด", value: `${formatCount(counts.outOfStockCount)} รายการ` },
                  { label: "lot ใกล้หมดอายุ", value: `${formatCount(counts.expiringLotCount)} lot` },
                  { label: "เคลมค้าง", value: `${formatCount(counts.openClaimCount)} รายการ` },
                  { label: "เอกสารถูกยกเลิก", value: `${formatCount(counts.cancelledDocumentCount)} รายการ` },
                ]),
              },
            ],
          },
          {
            type: "box",
            layout: "vertical",
            paddingAll: "14px",
            cornerRadius: "16px",
            backgroundColor: "#E0F2FE",
            contents: [
              {
                type: "text",
                text: "✨ ปิดท้ายวันนี้",
                size: "sm",
                color: "#0369A1",
                weight: "bold",
              },
              {
                type: "text",
                text: `ค่าใช้จ่ายวันนี้ ฿${formatMoney(money.expensesToday)} • เงินโอนระหว่างบัญชี ฿${formatMoney(money.transfersToday)}`,
                margin: "sm",
                size: "sm",
                color: "#0F172A",
                wrap: true,
              },
            ],
          },
        ],
      },
    },
  };
}

function renderFriendlyLineDailySummaryMessage(summary: {
  reportDateLabel: string;
  money: MoneySection;
  counts: CountSection;
}) {
  const { reportDateLabel, money, counts } = summary;

  return [
    `สรุปงานประจำวันที่ ${reportDateLabel}`,
    "",
    "ยอดขายวันนี้",
    `- ขายรวม ${formatMoney(money.salesTotal)} บาท`,
    `- ขายสด ${formatMoney(money.cashSales)} บาท`,
    `- ขายเชื่อ ${formatMoney(money.creditSales)} บาท`,
    "",
    "เงินรับเข้าวันนี้",
    `- จากการขายสด ${formatMoney(money.cashInFromSales)} บาท`,
    `- จากการรับชำระหนี้ ${formatMoney(money.cashInFromReceipts)} บาท`,
    `- รวมเงินเข้า ${formatMoney(money.cashInTotal)} บาท`,
    "",
    "แยกตามช่องทางรับเงิน",
    `- เงินสด ${formatMoney(money.cashChannelTotal)} บาท`,
    `- เงินโอน ${formatMoney(money.transferChannelTotal)} บาท`,
    "",
    "ยอดค้าง",
    `- ลูกหนี้ค้างรับ ${formatMoney(money.arOutstanding)} บาท`,
    `- COD ค้างรับเงิน ${formatMoney(money.codOutstanding)} บาท`,
    `- เจ้าหนี้ค้างจ่าย ${formatMoney(money.apOutstanding)} บาท`,
    "",
    "งานจัดส่ง",
    `- รอจัดส่ง ${formatCount(counts.pendingDelivery)} รายการ`,
    `- กำลังจัดส่ง ${formatCount(counts.outForDelivery)} รายการ`,
    `- ส่งสำเร็จวันนี้ ${formatCount(counts.deliveredToday)} รายการ`,
    "",
    "สต๊อก",
    `- ต่ำกว่าขั้นต่ำ ${formatCount(counts.lowStockCount)} รายการ`,
    `- ของหมด ${formatCount(counts.outOfStockCount)} รายการ`,
    `- lot ใกล้หมดอายุ ${formatCount(counts.expiringLotCount)} lot`,
    `- lot หมดอายุค้างสต๊อก ${formatCount(counts.expiredLotCount)} lot`,
    "",
    "เคลม/เอกสารผิดปกติ",
    `- เคลมค้างดำเนินการ ${formatCount(counts.openClaimCount)} รายการ`,
    `- เอกสารถูกยกเลิกวันนี้ ${formatCount(counts.cancelledDocumentCount)} รายการ`,
    `- ปรับสต๊อกวันนี้ ${formatCount(counts.stockAdjustmentCount)} เอกสาร`,
    "",
    "สรุปเพิ่มเติม",
    `- ค่าใช้จ่ายวันนี้ ${formatMoney(money.expensesToday)} บาท`,
    `- เงินโอนระหว่างบัญชีวันนี้ ${formatMoney(money.transfersToday)} บาท`,
  ].join("\n");
}

async function getLotExpiryCounts(reportStart: Date, reportEnd: Date) {
  const threshold = new Date(reportEnd.getTime() + 30 * DAY_MS);

  const productLots = await db.productLot.findMany({
    where: {
      expDate: {
        not: null,
        lte: threshold,
      },
    },
    select: {
      productId: true,
      lotNo: true,
      expDate: true,
    },
  });

  if (productLots.length === 0) {
    return { expiringLotCount: 0, expiredLotCount: 0 };
  }

  const lotBalances = await db.lotBalance.findMany({
    where: {
      qtyOnHand: { gt: 0 },
      OR: productLots.map((lot) => ({
        productId: lot.productId,
        lotNo: lot.lotNo,
      })),
    },
    select: {
      productId: true,
      lotNo: true,
    },
  });

  const activeLotKeys = new Set(lotBalances.map((lot) => `${lot.productId}:${lot.lotNo}`));

  let expiringLotCount = 0;
  let expiredLotCount = 0;

  for (const lot of productLots) {
    if (!activeLotKeys.has(`${lot.productId}:${lot.lotNo}`)) {
      continue;
    }

    const expDate = lot.expDate!;
    if (expDate < reportStart) {
      expiredLotCount += 1;
    } else {
      expiringLotCount += 1;
    }
  }

  return { expiringLotCount, expiredLotCount };
}

function renderLineDailySummaryMessage(summary: {
  reportDateLabel: string;
  money: MoneySection;
  counts: CountSection;
}) {
  const { reportDateLabel, money, counts } = summary;

  return [
    `สรุปงานประจำวัน ${reportDateLabel}`,
    "",
    "ยอดขายวันนี้",
    `- ขายรวม ${formatMoney(money.salesTotal)} บาท`,
    `- ขายสด ${formatMoney(money.cashSales)} บาท`,
    `- ขายเชื่อ ${formatMoney(money.creditSales)} บาท`,
    "",
    "เงินรับเข้าวันนี้",
    `- จากการขายสด ${formatMoney(money.cashInFromSales)} บาท`,
    `- จากการรับชำระหนี้ ${formatMoney(money.cashInFromReceipts)} บาท`,
    `- รวมเงินเข้า ${formatMoney(money.cashInTotal)} บาท`,
    "",
    "แยกตามช่องทางรับเงิน",
    `- เงินสด ${formatMoney(money.cashChannelTotal)} บาท`,
    `- เงินโอน ${formatMoney(money.transferChannelTotal)} บาท`,
    "",
    "ยอดค้าง",
    `- ลูกหนี้ค้างรับ ${formatMoney(money.arOutstanding)} บาท`,
    `- COD ค้างรับเงิน ${formatMoney(money.codOutstanding)} บาท`,
    `- เจ้าหนี้ค้างจ่าย ${formatMoney(money.apOutstanding)} บาท`,
    "",
    "งานจัดส่ง",
    `- รอจัดส่ง ${formatCount(counts.pendingDelivery)} รายการ`,
    `- กำลังจัดส่ง ${formatCount(counts.outForDelivery)} รายการ`,
    `- ส่งสำเร็จวันนี้ ${formatCount(counts.deliveredToday)} รายการ`,
    "",
    "สต๊อก",
    `- ต่ำกว่าขั้นต่ำ ${formatCount(counts.lowStockCount)} รายการ`,
    `- ของหมด ${formatCount(counts.outOfStockCount)} รายการ`,
    `- lot ใกล้หมดอายุ ${formatCount(counts.expiringLotCount)} lot`,
    `- lot หมดอายุค้างสต๊อก ${formatCount(counts.expiredLotCount)} lot`,
    "",
    "เคลม/เอกสารผิดปกติ",
    `- เคลมค้างดำเนินการ ${formatCount(counts.openClaimCount)} รายการ`,
    `- เอกสารถูกยกเลิกวันนี้ ${formatCount(counts.cancelledDocumentCount)} รายการ`,
    `- ปรับสต๊อกวันนี้ ${formatCount(counts.stockAdjustmentCount)} เอกสาร`,
    "",
    "สรุปเพิ่มเติม",
    `- ค่าใช้จ่ายวันนี้ ${formatMoney(money.expensesToday)} บาท`,
    `- เงินโอนระหว่างบัญชีวันนี้ ${formatMoney(money.transfersToday)} บาท`,
  ].join("\n");
}

function buildLineDailySummaryFlexMessageV2(summary: {
  reportDateLabel: string;
  money: MoneySection;
  counts: CountSection;
}): LineFlexMessage {
  const { reportDateLabel, money, counts } = summary;
  const followUpCount =
    counts.pendingDelivery +
    counts.lowStockCount +
    counts.outOfStockCount +
    counts.openClaimCount +
    counts.cancelledDocumentCount;

  return {
    type: "flex",
    altText: `สรุปงานประจำวันที่ ${reportDateLabel}`,
    contents: {
      type: "bubble",
      size: "giga",
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "20px",
        spacing: "lg",
        backgroundColor: "#F8FAFC",
        contents: [
          {
            type: "box",
            layout: "vertical",
            paddingAll: "16px",
            cornerRadius: "20px",
            background: {
              type: "linearGradient",
              angle: "0deg",
              startColor: "#16A34A",
              endColor: "#0F766E",
            },
            contents: [
              {
                type: "text",
                text: "SME Daily Closing",
                size: "xs",
                color: "#DCFCE7",
                weight: "bold",
              },
              {
                type: "text",
                text: `🌈 สรุปงานประจำวันที่ ${reportDateLabel}`,
                margin: "md",
                size: "xl",
                color: "#FFFFFF",
                weight: "bold",
                wrap: true,
              },
              {
                type: "box",
                layout: "horizontal",
                margin: "lg",
                spacing: "md",
                contents: [
                  {
                    type: "box",
                    layout: "vertical",
                    cornerRadius: "14px",
                    paddingAll: "12px",
                    backgroundColor: "#FFFFFF1A",
                    flex: 1,
                    contents: [
                      {
                        type: "text",
                        text: "ยอดขายรวม",
                        size: "xs",
                        color: "#DCFCE7",
                      },
                      {
                        type: "text",
                        text: `฿${formatMoney(money.salesTotal)}`,
                        margin: "sm",
                        size: "lg",
                        color: "#FFFFFF",
                        weight: "bold",
                        wrap: true,
                      },
                    ],
                  },
                  {
                    type: "box",
                    layout: "vertical",
                    cornerRadius: "14px",
                    paddingAll: "12px",
                    backgroundColor: "#FFFFFF1A",
                    flex: 1,
                    contents: [
                      {
                        type: "text",
                        text: "รายการต้องติดตาม",
                        size: "xs",
                        color: "#DCFCE7",
                      },
                      {
                        type: "text",
                        text: formatCount(followUpCount),
                        margin: "sm",
                        size: "lg",
                        color: "#FFFFFF",
                        weight: "bold",
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: "box",
            layout: "vertical",
            cornerRadius: "18px",
            paddingAll: "16px",
            backgroundColor: "#FFFFFF",
            contents: [
              {
                type: "text",
                text: "🧾 รายละเอียดการขาย",
                size: "md",
                weight: "bold",
                color: "#0F172A",
              },
              {
                type: "box",
                layout: "vertical",
                margin: "lg",
                spacing: "md",
                contents: buildSummaryFactRows([
                  { label: "ยอดขายรวม", value: `฿${formatMoney(money.salesTotal)}` },
                  { label: "ขายสด", value: `฿${formatMoney(money.cashSales)}` },
                  { label: "ขายเชื่อ", value: `฿${formatMoney(money.creditSales)}` },
                ]),
              },
            ],
          },
          {
            type: "box",
            layout: "vertical",
            cornerRadius: "18px",
            paddingAll: "16px",
            backgroundColor: "#FFFFFF",
            contents: [
              {
                type: "text",
                text: "💸 เงินเข้าและยอดค้าง",
                size: "md",
                weight: "bold",
                color: "#0F172A",
              },
              {
                type: "box",
                layout: "vertical",
                margin: "lg",
                spacing: "md",
                contents: buildSummaryFactRows([
                  { label: "เงินเข้ารวม", value: `฿${formatMoney(money.cashInTotal)}` },
                  { label: "เงินสด", value: `฿${formatMoney(money.cashChannelTotal)}` },
                  { label: "เงินโอน", value: `฿${formatMoney(money.transferChannelTotal)}` },
                  { label: "ลูกหนี้ค้างรับ", value: `฿${formatMoney(money.arOutstanding)}` },
                  { label: "COD ค้างรับเงิน", value: `฿${formatMoney(money.codOutstanding)}` },
                  { label: "เจ้าหนี้ค้างจ่าย", value: `฿${formatMoney(money.apOutstanding)}` },
                ]),
              },
            ],
          },
          {
            type: "box",
            layout: "vertical",
            cornerRadius: "18px",
            paddingAll: "16px",
            backgroundColor: "#FFFFFF",
            contents: [
              {
                type: "text",
                text: "🚚 งานค้างและความเสี่ยง",
                size: "md",
                weight: "bold",
                color: "#0F172A",
              },
              {
                type: "box",
                layout: "vertical",
                margin: "lg",
                spacing: "md",
                contents: buildSummaryFactRows([
                  { label: "รอจัดส่ง", value: `${formatCount(counts.pendingDelivery)} รายการ` },
                  { label: "กำลังจัดส่ง", value: `${formatCount(counts.outForDelivery)} รายการ` },
                  { label: "สต๊อกต่ำขั้นต่ำ", value: `${formatCount(counts.lowStockCount)} รายการ` },
                  { label: "ของหมด", value: `${formatCount(counts.outOfStockCount)} รายการ` },
                  { label: "lot ใกล้หมดอายุ", value: `${formatCount(counts.expiringLotCount)} lot` },
                  { label: "เคลมค้าง", value: `${formatCount(counts.openClaimCount)} รายการ` },
                  { label: "เอกสารถูกยกเลิก", value: `${formatCount(counts.cancelledDocumentCount)} รายการ` },
                ]),
              },
            ],
          },
          {
            type: "box",
            layout: "vertical",
            paddingAll: "14px",
            cornerRadius: "16px",
            backgroundColor: "#E0F2FE",
            contents: [
              {
                type: "text",
                text: "✨ ปิดท้ายวันนี้",
                size: "sm",
                color: "#0369A1",
                weight: "bold",
              },
              {
                type: "text",
                text: `ค่าใช้จ่ายวันนี้ ฿${formatMoney(money.expensesToday)} • เงินโอนระหว่างบัญชี ฿${formatMoney(money.transfersToday)}`,
                margin: "sm",
                size: "sm",
                color: "#0F172A",
                wrap: true,
              },
            ],
          },
        ],
      },
    },
  };
}

function buildLineDailySummaryFlexMessageV3(summary: {
  reportDateLabel: string;
  money: MoneySection;
  counts: CountSection;
}): LineFlexMessage {
  const { reportDateLabel, money, counts } = summary;
  const followUpCount =
    counts.pendingDelivery +
    counts.lowStockCount +
    counts.outOfStockCount +
    counts.openClaimCount +
    counts.cancelledDocumentCount;

  return {
    type: "flex",
    altText: `สรุปงานประจำวันที่ ${reportDateLabel}`,
    contents: {
      type: "bubble",
      size: "giga",
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "20px",
        spacing: "lg",
        backgroundColor: "#F8FAFC",
        contents: [
          {
            type: "box",
            layout: "vertical",
            paddingAll: "16px",
            cornerRadius: "20px",
            background: {
              type: "linearGradient",
              angle: "0deg",
              startColor: "#16A34A",
              endColor: "#0F766E",
            },
            contents: [
              {
                type: "text",
                text: "SME Daily Closing",
                size: "xs",
                color: "#DCFCE7",
                weight: "bold",
              },
              {
                type: "text",
                text: `🌈 สรุปงานประจำวันที่ ${reportDateLabel}`,
                margin: "md",
                size: "xl",
                color: "#FFFFFF",
                weight: "bold",
                wrap: true,
              },
              {
                type: "box",
                layout: "horizontal",
                margin: "lg",
                spacing: "md",
                contents: [
                  {
                    type: "box",
                    layout: "vertical",
                    cornerRadius: "14px",
                    paddingAll: "12px",
                    backgroundColor: "#FFFFFF1A",
                    flex: 1,
                    contents: [
                      {
                        type: "text",
                        text: "ยอดขายรวม",
                        size: "xs",
                        color: "#DCFCE7",
                      },
                      {
                        type: "text",
                        text: `฿${formatMoney(money.salesTotal)}`,
                        margin: "sm",
                        size: "lg",
                        color: "#FFFFFF",
                        weight: "bold",
                        wrap: true,
                      },
                    ],
                  },
                  {
                    type: "box",
                    layout: "vertical",
                    cornerRadius: "14px",
                    paddingAll: "12px",
                    backgroundColor: "#FFFFFF1A",
                    flex: 1,
                    contents: [
                      {
                        type: "text",
                        text: "รายการต้องติดตาม",
                        size: "xs",
                        color: "#DCFCE7",
                      },
                      {
                        type: "text",
                        text: formatCount(followUpCount),
                        margin: "sm",
                        size: "lg",
                        color: "#FFFFFF",
                        weight: "bold",
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: "box",
            layout: "vertical",
            cornerRadius: "18px",
            paddingAll: "16px",
            backgroundColor: "#FFFFFF",
            contents: [
              {
                type: "text",
                text: "🧾 รายละเอียดการขาย",
                size: "md",
                weight: "bold",
                color: "#0F172A",
              },
              {
                type: "box",
                layout: "vertical",
                margin: "lg",
                spacing: "md",
                contents: buildSummaryFactRows([
                  { label: "ขายสด", value: `฿${formatMoney(money.cashSales)}` },
                  { label: "ขายเชื่อ", value: `฿${formatMoney(money.creditSales)}` },
                ]),
              },
            ],
          },
          {
            type: "box",
            layout: "vertical",
            cornerRadius: "18px",
            paddingAll: "16px",
            backgroundColor: "#FFFFFF",
            contents: [
              {
                type: "text",
                text: "💸 เงินเข้าและยอดค้าง",
                size: "md",
                weight: "bold",
                color: "#0F172A",
              },
              {
                type: "box",
                layout: "vertical",
                margin: "lg",
                spacing: "md",
                contents: buildSummaryFactRows([
                  { label: "เงินเข้ารวม", value: `฿${formatMoney(money.cashInTotal)}` },
                  { label: "เงินสด", value: `฿${formatMoney(money.cashChannelTotal)}` },
                  { label: "เงินโอน", value: `฿${formatMoney(money.transferChannelTotal)}` },
                  { label: "ลูกหนี้ค้างรับ", value: `฿${formatMoney(money.arOutstanding)}` },
                  { label: "COD ค้างรับเงิน", value: `฿${formatMoney(money.codOutstanding)}` },
                  { label: "เจ้าหนี้ค้างจ่าย", value: `฿${formatMoney(money.apOutstanding)}` },
                ]),
              },
            ],
          },
          {
            type: "box",
            layout: "vertical",
            cornerRadius: "18px",
            paddingAll: "16px",
            backgroundColor: "#FFFFFF",
            contents: [
              {
                type: "text",
                text: "🚚 งานค้างและความเสี่ยง",
                size: "md",
                weight: "bold",
                color: "#0F172A",
              },
              {
                type: "box",
                layout: "vertical",
                margin: "lg",
                spacing: "md",
                contents: buildSummaryFactRows([
                  { label: "รอจัดส่ง", value: `${formatCount(counts.pendingDelivery)} รายการ` },
                  { label: "กำลังจัดส่ง", value: `${formatCount(counts.outForDelivery)} รายการ` },
                  { label: "สต๊อกต่ำขั้นต่ำ", value: `${formatCount(counts.lowStockCount)} รายการ` },
                  { label: "ของหมด", value: `${formatCount(counts.outOfStockCount)} รายการ` },
                  { label: "lot ใกล้หมดอายุ", value: `${formatCount(counts.expiringLotCount)} lot` },
                  { label: "เคลมค้าง", value: `${formatCount(counts.openClaimCount)} รายการ` },
                  { label: "เอกสารถูกยกเลิก", value: `${formatCount(counts.cancelledDocumentCount)} รายการ` },
                ]),
              },
            ],
          },
          {
            type: "box",
            layout: "vertical",
            paddingAll: "14px",
            cornerRadius: "16px",
            backgroundColor: "#E0F2FE",
            contents: [
              {
                type: "text",
                text: "✨ ปิดท้ายวันนี้",
                size: "sm",
                color: "#0369A1",
                weight: "bold",
              },
              {
                type: "text",
                text: `ค่าใช้จ่ายวันนี้ ฿${formatMoney(money.expensesToday)} • เงินโอนระหว่างบัญชี ฿${formatMoney(money.transfersToday)}`,
                margin: "sm",
                size: "sm",
                color: "#0F172A",
                wrap: true,
              },
            ],
          },
        ],
      },
    },
  };
}

export async function buildLineDailySummary(dayKeyInput?: string): Promise<LineDailySummary> {
  const reportDayKey = resolveBangkokDayKey(dayKeyInput);
  const { start, end } = getBangkokDayRange(reportDayKey);
  const reportDateLabel = formatThaiDate(reportDayKey);

  const [
    siteConfig,
    salesTotalAgg,
    cashSalesAgg,
    creditSalesAgg,
    receiptTotalAgg,
    cashSaleCashAgg,
    cashSaleTransferAgg,
    receiptCashAgg,
    receiptTransferAgg,
    arOutstandingAgg,
    codOutstandingAgg,
    apOutstandingAgg,
    pendingDelivery,
    outForDelivery,
    deliveredToday,
    lowStockCount,
    outOfStockCount,
    openClaimCount,
    adjustmentCount,
    expensesTodayAgg,
    transfersTodayAgg,
    cancelledCounts,
    lotCounts,
  ] = await Promise.all([
    getSiteConfig(),
    db.sale.aggregate({
      _sum: { netAmount: true },
      where: {
        status: "ACTIVE",
        saleDate: { gte: start, lte: end },
      },
    }),
    db.sale.aggregate({
      _sum: { netAmount: true },
      where: {
        status: "ACTIVE",
        paymentType: "CASH_SALE",
        saleDate: { gte: start, lte: end },
      },
    }),
    db.sale.aggregate({
      _sum: { netAmount: true },
      where: {
        status: "ACTIVE",
        paymentType: "CREDIT_SALE",
        saleDate: { gte: start, lte: end },
      },
    }),
    db.receipt.aggregate({
      _sum: { totalAmount: true },
      where: {
        status: "ACTIVE",
        receiptDate: { gte: start, lte: end },
      },
    }),
    db.sale.aggregate({
      _sum: { netAmount: true },
      where: {
        status: "ACTIVE",
        paymentType: "CASH_SALE",
        paymentMethod: "CASH",
        saleDate: { gte: start, lte: end },
      },
    }),
    db.sale.aggregate({
      _sum: { netAmount: true },
      where: {
        status: "ACTIVE",
        paymentType: "CASH_SALE",
        paymentMethod: "TRANSFER",
        saleDate: { gte: start, lte: end },
      },
    }),
    db.receipt.aggregate({
      _sum: { totalAmount: true },
      where: {
        status: "ACTIVE",
        paymentMethod: "CASH",
        receiptDate: { gte: start, lte: end },
      },
    }),
    db.receipt.aggregate({
      _sum: { totalAmount: true },
      where: {
        status: "ACTIVE",
        paymentMethod: "TRANSFER",
        receiptDate: { gte: start, lte: end },
      },
    }),
    db.sale.aggregate({
      _sum: { amountRemain: true },
      where: {
        status: "ACTIVE",
        paymentType: "CREDIT_SALE",
        fulfillmentType: "PICKUP",
      },
    }),
    db.sale.aggregate({
      _sum: { amountRemain: true },
      where: {
        status: "ACTIVE",
        paymentType: "CREDIT_SALE",
        fulfillmentType: "DELIVERY",
        shippingStatus: { not: "DELIVERED" },
      },
    }),
    db.purchase.aggregate({
      _sum: { amountRemain: true },
      where: {
        status: "ACTIVE",
        purchaseType: "CREDIT_PURCHASE",
        amountRemain: { gt: 0 },
      },
    }),
    db.sale.count({
      where: {
        status: "ACTIVE",
        fulfillmentType: "DELIVERY",
        shippingStatus: "PENDING",
      },
    }),
    db.sale.count({
      where: {
        status: "ACTIVE",
        fulfillmentType: "DELIVERY",
        shippingStatus: "OUT_FOR_DELIVERY",
      },
    }),
    db.sale.count({
      where: {
        status: "ACTIVE",
        fulfillmentType: "DELIVERY",
        shippingStatus: "DELIVERED",
        updatedAt: { gte: start, lte: end },
      },
    }),
    db.product.count({
      where: {
        isActive: true,
        stock: { gt: 0, lte: db.product.fields.minStock },
      },
    }).catch(() => 0),
    db.product.count({
      where: {
        isActive: true,
        stock: { lte: 0 },
      },
    }),
    db.warrantyClaim.count({
      where: {
        status: { in: ["DRAFT", "SENT_TO_SUPPLIER"] },
      },
    }),
    db.adjustment.count({
      where: {
        status: "ACTIVE",
        adjustDate: { gte: start, lte: end },
      },
    }),
    db.expense.aggregate({
      _sum: { netAmount: true },
      where: {
        status: "ACTIVE",
        expenseDate: { gte: start, lte: end },
      },
    }),
    db.cashBankTransfer.aggregate({
      _sum: { amount: true },
      where: {
        status: "ACTIVE",
        transferDate: { gte: start, lte: end },
      },
    }),
    Promise.all([
      db.sale.count({ where: { status: "CANCELLED", cancelledAt: { gte: start, lte: end } } }),
      db.purchase.count({ where: { status: "CANCELLED", cancelledAt: { gte: start, lte: end } } }),
      db.receipt.count({ where: { status: "CANCELLED", cancelledAt: { gte: start, lte: end } } }),
      db.creditNote.count({ where: { status: "CANCELLED", cancelledAt: { gte: start, lte: end } } }),
      db.purchaseReturn.count({ where: { status: "CANCELLED", cancelledAt: { gte: start, lte: end } } }),
      db.expense.count({ where: { status: "CANCELLED", cancelledAt: { gte: start, lte: end } } }),
      db.adjustment.count({ where: { status: "CANCELLED", cancelledAt: { gte: start, lte: end } } }),
      db.cashBankTransfer.count({
        where: { status: "CANCELLED", cancelledAt: { gte: start, lte: end } },
      }),
      db.cashBankAdjustment.count({
        where: { status: "CANCELLED", cancelledAt: { gte: start, lte: end } },
      }),
    ]),
    getLotExpiryCounts(start, end),
  ]);

  const money: MoneySection = {
    salesTotal: toNumber(salesTotalAgg._sum.netAmount),
    cashSales: toNumber(cashSalesAgg._sum.netAmount),
    creditSales: toNumber(creditSalesAgg._sum.netAmount),
    cashInFromSales: toNumber(cashSalesAgg._sum.netAmount),
    cashInFromReceipts: toNumber(receiptTotalAgg._sum.totalAmount),
    cashInTotal:
      toNumber(cashSalesAgg._sum.netAmount) + toNumber(receiptTotalAgg._sum.totalAmount),
    cashChannelTotal:
      toNumber(cashSaleCashAgg._sum.netAmount) + toNumber(receiptCashAgg._sum.totalAmount),
    transferChannelTotal:
      toNumber(cashSaleTransferAgg._sum.netAmount) +
      toNumber(receiptTransferAgg._sum.totalAmount),
    arOutstanding: toNumber(arOutstandingAgg._sum.amountRemain),
    codOutstanding: toNumber(codOutstandingAgg._sum.amountRemain),
    apOutstanding: toNumber(apOutstandingAgg._sum.amountRemain),
    expensesToday: toNumber(expensesTodayAgg._sum.netAmount),
    transfersToday: toNumber(transfersTodayAgg._sum.amount),
  };

  const counts: CountSection = {
    pendingDelivery,
    outForDelivery,
    deliveredToday,
    lowStockCount,
    outOfStockCount,
    expiringLotCount: lotCounts.expiringLotCount,
    expiredLotCount: lotCounts.expiredLotCount,
    openClaimCount,
    cancelledDocumentCount: cancelledCounts.reduce((sum, value) => sum + value, 0),
    stockAdjustmentCount: adjustmentCount,
  };

  const message = renderEmojiLineDailySummaryMessage({
    reportDateLabel,
    money,
    counts,
  });
  const flexMessage = buildLineDailySummaryFlexMessageV3({
    reportDateLabel,
    money,
    counts,
  });

  return {
    reportDayKey,
    reportDateLabel,
    shopName: siteConfig.shopName,
    range: { start, end },
    money,
    counts,
    message,
    messages: [flexMessage],
    flexMessage,
  };
}
