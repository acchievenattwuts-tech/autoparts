import { db } from "@/lib/db";
import { getSiteConfig } from "@/lib/site-config";
import { buildOutOfStockProductsWhere } from "@/lib/out-of-stock-products";
import { aggregateProfitSummary } from "@/lib/profit-dashboard";
import { queryDailyPaymentRows } from "@/lib/report-queries";
import { getShopeeReportingSummary } from "@/lib/shopee/services/reporting";
import { getWorkboardData } from "@/app/admin/(protected)/workboard/workboard-data";
import {
  addThailandDays,
  formatDateThai,
  getThailandDateKey,
  isDateOnlyString,
  parseDateOnlyToDate,
  parseDateOnlyToEndOfDay,
} from "@/lib/th-date";

type MoneySection = {
  salesTotal: number;
  storeSales: number;
  storeGrossProfit: number;
  storeOrderCount: number;
  shopeeSales: number;
  shopeeGrossProfit: number;
  shopeeOrderCount: number;
  cashSales: number;
  creditSales: number;
  costOfGoodsSoldToday: number;
  grossProfitToday: number;
  grossMarginPctToday: number;
  cashInFromSales: number;
  cashInFromReceipts: number;
  cashInFromCustomerAdvances: number;
  cashInTotal: number;
  cashChannelTotal: number;
  transferChannelTotal: number;
  arOutstanding: number;
  codOutstanding: number;
  apOutstanding: number;
  expensesToday: number;
  transfersToday: number;
};

type AccountBalanceItem = {
  label: string;
  balance: number;
};

type BalanceSection = {
  accounts: AccountBalanceItem[];
  totalBalance: number;
};

// Risk radar — money-at-risk and operational backlog surfaced from the same
// tested queries the admin Workboard uses (getWorkboardData), so both stay in
// sync. Rows are ordered by urgency and each carries its own count so compact
// mode can hide the zero rows.
type RiskRadarSection = {
  overdueArCount: number;
  overdueArAmount: number;
  outOfStockCount: number;
  dueApCount: number;
  dueApAmount: number;
  codWaitingCount: number;
  codWaitingAmount: number;
  expiringLotWithin30: number;
  cashBankBelowCount: number;
  pendingAndClaimCount: number;
};

export type RiskRadarItem = {
  label: string;
  value: string;
  count: number;
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

export type LineImageMessage = {
  type: "image";
  originalContentUrl: string;
  previewImageUrl: string;
};

export type LinePushMessage = LineTextMessage | LineFlexMessage | LineImageMessage;

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
  balances: BalanceSection;
  risks: RiskRadarSection;
  message: string;
  messages: LinePushMessage[];
  flexMessage: LineFlexMessage;
};

type SummaryFactItem = {
  label: string;
  value: string;
  compactValue?: number;
  keepWhenZero?: boolean;
};

type SummaryRenderOptions = {
  compactMode?: boolean;
};

function toNumber(value: unknown): number {
  return Number(value ?? 0);
}

function isValidDayKey(value: string | undefined): value is string {
  return Boolean(value && isDateOnlyString(value));
}

export function resolveBangkokDayKey(value?: string): string {
  return isValidDayKey(value) ? value : getThailandDateKey();
}

async function runSummaryStep<T>(stepName: string, runner: () => Promise<T>): Promise<T> {
  try {
    return await runner();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown summary query error";
    throw new Error(`SUMMARY_QUERY_FAILED:${stepName}:${message}`);
  }
}

function getBangkokDayRange(dayKey: string) {
  const start = parseDateOnlyToDate(dayKey);
  const end = parseDateOnlyToEndOfDay(dayKey);
  return { start, end };
}

function formatThaiDate(dayKey: string) {
  return formatDateThai(parseDateOnlyToDate(dayKey));
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

function formatPercent(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0;

  return `${safeValue.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

// Severity dots (emoji) render identically on the LINE Flex card and the admin
// preview, so both surfaces show the exact same radar. 🔴 = urgent cash/stock,
// 🟠 = watch, ⚪ = routine backlog. Rows are already ordered by urgency here.
export function buildRiskRadarItems(risks: RiskRadarSection): RiskRadarItem[] {
  return [
    {
      label: `🔴 ลูกหนี้เกินกำหนด (${formatCount(risks.overdueArCount)} ราย)`,
      value: `฿${formatMoney(risks.overdueArAmount)}`,
      count: risks.overdueArCount,
    },
    {
      label: "🔴 ของหมด (ขาดขาย)",
      value: `${formatCount(risks.outOfStockCount)} รายการ`,
      count: risks.outOfStockCount,
    },
    {
      label: `🟠 หนี้ถึงกำหนดจ่ายซัพ (${formatCount(risks.dueApCount)} ราย)`,
      value: `฿${formatMoney(risks.dueApAmount)}`,
      count: risks.dueApCount,
    },
    {
      label: `🟠 COD ค้างเก็บเงิน (${formatCount(risks.codWaitingCount)} ราย)`,
      value: `฿${formatMoney(risks.codWaitingAmount)}`,
      count: risks.codWaitingCount,
    },
    {
      label: "🟠 lot ใกล้หมดอายุ ≤30 วัน",
      value: `${formatCount(risks.expiringLotWithin30)} lot`,
      count: risks.expiringLotWithin30,
    },
    {
      label: "🟠 บัญชีเงินต่ำกว่าเกณฑ์",
      value: `${formatCount(risks.cashBankBelowCount)} บัญชี`,
      count: risks.cashBankBelowCount,
    },
    {
      label: "⚪ รอจัดส่ง + เคลมรอผล",
      value: `${formatCount(risks.pendingAndClaimCount)} รายการ`,
      count: risks.pendingAndClaimCount,
    },
  ];
}

function shouldKeepSummaryFactItem(item: SummaryFactItem, compactMode: boolean) {
  if (!compactMode) return true;
  if (item.keepWhenZero) return true;
  return item.compactValue !== 0;
}

function filterSummaryFactItems(items: SummaryFactItem[], compactMode: boolean) {
  return items.filter((item) => shouldKeepSummaryFactItem(item, compactMode));
}

function renderEmojiLineDailySummaryMessage(summary: {
  reportDateLabel: string;
  money: MoneySection;
  counts: CountSection;
  balances: BalanceSection;
  risks: RiskRadarSection;
}) {
  const { reportDateLabel, money, balances, risks } = summary;

  return [
    `🌈 สรุปงานประจำวันที่ ${reportDateLabel}`,
    "",
    "💰 ยอดขายวันนี้",
    `- ขายรวม ${formatMoney(money.salesTotal)} บาท`,
    `- หน้าร้าน ${formatMoney(money.storeSales)} บาท (${formatCount(money.storeOrderCount)} ออเดอร์)`,
    `- Shopee ${formatMoney(money.shopeeSales)} บาท (${formatCount(money.shopeeOrderCount)} ออเดอร์)`,
    `- ขายสด ${formatMoney(money.cashSales)} บาท`,
    `- ขายเชื่อ ${formatMoney(money.creditSales)} บาท`,
    `- ต้นทุนขาย ${formatMoney(money.costOfGoodsSoldToday)} บาท`,
    `- กำไรขั้นต้นวันนี้ ${formatMoney(money.grossProfitToday)} บาท(${formatPercent(money.grossMarginPctToday)})`,
    "",
    "🏦 เงินรับเข้าวันนี้",
    `- จากการขายสด ${formatMoney(money.cashInFromSales)} บาท`,
    `- จากการรับชำระหนี้ ${formatMoney(money.cashInFromReceipts)} บาท`,
    `- รับเงินมัดจำลูกค้า ${formatMoney(money.cashInFromCustomerAdvances)} บาท`,
    `- รวมเงินเข้า ${formatMoney(money.cashInTotal)} บาท`,
    "",
    "💸 แยกตามช่องทางรับเงิน",
    `- เงินสด ${formatMoney(money.cashChannelTotal)} บาท`,
    `- เงินโอน ${formatMoney(money.transferChannelTotal)} บาท`,
    "",
    "💵 ยอดเงินคงเหลือแต่ละบัญชี",
    ...balances.accounts.map(
      (account) => `- ${account.label} ${formatMoney(account.balance)} บาท`
    ),
    `- รวมทุกบัญชี ${formatMoney(balances.totalBalance)} บาท`,
    "",
    "📌 ยอดค้าง",
    `- ลูกหนี้ค้างรับ ${formatMoney(money.arOutstanding)} บาท`,
    `- COD ค้างรับเงิน ${formatMoney(money.codOutstanding)} บาท`,
    `- เจ้าหนี้ค้างจ่าย ${formatMoney(money.apOutstanding)} บาท`,
    "",
    "📡 เรดาร์ความเสี่ยงวันนี้",
    ...buildRiskRadarItems(risks).map((item) => `- ${item.label} ${item.value}`),
    "",
    "✨ สรุปเพิ่มเติม",
    `- จ่ายเงินวันนี้ ${formatMoney(money.expensesToday)} บาท`,
    `- เงินโอนระหว่างบัญชีวันนี้ ${formatMoney(money.transfersToday)} บาท`,
  ].join("\n");
}

function buildSummaryFactRows(items: SummaryFactItem[]) {
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
                  { label: "รับเงินมัดจำลูกค้า", value: `฿${formatMoney(money.cashInFromCustomerAdvances)}` },
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
                text: `จ่ายเงินวันนี้ ฿${formatMoney(money.expensesToday)} • เงินโอนระหว่างบัญชี ฿${formatMoney(money.transfersToday)}`,
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
    `- ต้นทุนขาย ${formatMoney(money.costOfGoodsSoldToday)} บาท`,
    `- กำไรขั้นต้นวันนี้ ${formatMoney(money.grossProfitToday)} บาท(${formatPercent(money.grossMarginPctToday)})`,
    "",
    "เงินรับเข้าวันนี้",
    `- จากการขายสด ${formatMoney(money.cashInFromSales)} บาท`,
    `- จากการรับชำระหนี้ ${formatMoney(money.cashInFromReceipts)} บาท`,
    `- รับเงินมัดจำลูกค้า ${formatMoney(money.cashInFromCustomerAdvances)} บาท`,
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
    `- จ่ายเงินวันนี้ ${formatMoney(money.expensesToday)} บาท`,
    `- เงินโอนระหว่างบัญชีวันนี้ ${formatMoney(money.transfersToday)} บาท`,
  ].join("\n");
}

async function getLotExpiryCounts(reportStart: Date, reportEnd: Date) {
  const threshold = addThailandDays(reportEnd, 30);

  const productLots = await runSummaryStep("lotCounts.productLots", () =>
    db.productLot.findMany({
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
    })
  );

  if (productLots.length === 0) {
    return { expiringLotCount: 0, expiredLotCount: 0 };
  }

  const lotBalances = await runSummaryStep("lotCounts.lotBalances", () =>
    db.lotBalance.findMany({
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
    })
  );

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
    `- ต้นทุนขาย ${formatMoney(money.costOfGoodsSoldToday)} บาท`,
    `- กำไรขั้นต้นวันนี้ ${formatMoney(money.grossProfitToday)} บาท(${formatPercent(money.grossMarginPctToday)})`,
    "",
    "เงินรับเข้าวันนี้",
    `- จากการขายสด ${formatMoney(money.cashInFromSales)} บาท`,
    `- จากการรับชำระหนี้ ${formatMoney(money.cashInFromReceipts)} บาท`,
    `- รับเงินมัดจำลูกค้า ${formatMoney(money.cashInFromCustomerAdvances)} บาท`,
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
    `- จ่ายเงินวันนี้ ${formatMoney(money.expensesToday)} บาท`,
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
                        text: "กำไรขั้นต้นวันนี้",
                        size: "xs",
                        color: "#DCFCE7",
                      },
                      {
                        type: "text",
                        text: `฿${formatMoney(money.grossProfitToday)}(${formatPercent(money.grossMarginPctToday)})`,
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
                  { label: "ต้นทุนขาย", value: `฿${formatMoney(money.costOfGoodsSoldToday)}` },
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
                  { label: "รับเงินมัดจำลูกค้า", value: `฿${formatMoney(money.cashInFromCustomerAdvances)}` },
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
                text: `จ่ายเงินวันนี้ ฿${formatMoney(money.expensesToday)} • เงินโอนระหว่างบัญชี ฿${formatMoney(money.transfersToday)}`,
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
  balances: BalanceSection;
  risks: RiskRadarSection;
}, options: SummaryRenderOptions = {}): LineFlexMessage {
  const { reportDateLabel, money, balances, risks } = summary;
  const compactMode = options.compactMode ?? false;
  const balanceFactItems: SummaryFactItem[] = [
    ...balances.accounts.map((account) => ({
      label: account.label,
      value: `฿${formatMoney(account.balance)}`,
      compactValue: account.balance,
    })),
    {
      label: "รวมทุกบัญชี",
      value: `฿${formatMoney(balances.totalBalance)}`,
      keepWhenZero: true,
    },
  ];
  const radarFactItems: SummaryFactItem[] = buildRiskRadarItems(risks).map((item) => ({
    label: item.label,
    value: item.value,
    compactValue: item.count,
  }));

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
                        text: "กำไรขั้นต้นวันนี้",
                        size: "xs",
                        color: "#DCFCE7",
                      },
                      {
                        type: "text",
                        text: `฿${formatMoney(money.grossProfitToday)}(${formatPercent(money.grossMarginPctToday)})`,
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
                        text: "เงินเข้าวันนี้",
                        size: "xs",
                        color: "#DCFCE7",
                      },
                      {
                        type: "text",
                        text: `฿${formatMoney(money.cashInTotal)}`,
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
                contents: buildSummaryFactRows(
                  filterSummaryFactItems(
                    [
                      { label: "ยอดขายรวม", value: `฿${formatMoney(money.salesTotal)}`, compactValue: money.salesTotal, keepWhenZero: true },
                      { label: "หน้าร้าน", value: `฿${formatMoney(money.storeSales)} / ${formatCount(money.storeOrderCount)} ออเดอร์`, compactValue: money.storeSales },
                      { label: "Shopee", value: `฿${formatMoney(money.shopeeSales)} / ${formatCount(money.shopeeOrderCount)} ออเดอร์`, compactValue: money.shopeeSales },
                      { label: "GP หน้าร้าน", value: `฿${formatMoney(money.storeGrossProfit)}`, compactValue: money.storeGrossProfit },
                      { label: "GP Shopee", value: `฿${formatMoney(money.shopeeGrossProfit)}`, compactValue: money.shopeeGrossProfit },
                      { label: "ขายสด", value: `฿${formatMoney(money.cashSales)}`, compactValue: money.cashSales },
                      { label: "ขายเชื่อ", value: `฿${formatMoney(money.creditSales)}`, compactValue: money.creditSales },
                      { label: "ต้นทุนขาย", value: `฿${formatMoney(money.costOfGoodsSoldToday)}`, compactValue: money.costOfGoodsSoldToday },
                    ],
                    compactMode
                  )
                ),
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
                contents: buildSummaryFactRows(
                  filterSummaryFactItems(
                    [
                      { label: "เงินเข้ารวม", value: `฿${formatMoney(money.cashInTotal)}`, keepWhenZero: true },
                      { label: "รับเงินมัดจำลูกค้า", value: `฿${formatMoney(money.cashInFromCustomerAdvances)}`, compactValue: money.cashInFromCustomerAdvances },
                      { label: "เงินสด", value: `฿${formatMoney(money.cashChannelTotal)}`, compactValue: money.cashChannelTotal },
                      { label: "เงินโอน", value: `฿${formatMoney(money.transferChannelTotal)}`, compactValue: money.transferChannelTotal },
                      { label: "ลูกหนี้ค้างรับ", value: `฿${formatMoney(money.arOutstanding)}`, compactValue: money.arOutstanding },
                      { label: "COD ค้างรับเงิน", value: `฿${formatMoney(money.codOutstanding)}`, compactValue: money.codOutstanding },
                      { label: "เจ้าหนี้ค้างจ่าย", value: `฿${formatMoney(money.apOutstanding)}`, compactValue: money.apOutstanding },
                    ],
                    compactMode
                  )
                ),
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
                text: "💵 ยอดเงินคงเหลือแต่ละบัญชี",
                size: "md",
                weight: "bold",
                color: "#0F172A",
              },
              {
                type: "box",
                layout: "vertical",
                margin: "lg",
                spacing: "md",
                contents: buildSummaryFactRows(
                  filterSummaryFactItems(balanceFactItems, compactMode)
                ),
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
                text: "📡 เรดาร์ความเสี่ยงวันนี้",
                size: "md",
                weight: "bold",
                color: "#0F172A",
              },
              {
                type: "box",
                layout: "vertical",
                margin: "lg",
                spacing: "md",
                contents: buildSummaryFactRows(
                  filterSummaryFactItems(radarFactItems, compactMode)
                ),
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
                text: `จ่ายเงินวันนี้ ฿${formatMoney(money.expensesToday)} • เงินโอนระหว่างบัญชี ฿${formatMoney(money.transfersToday)}`,
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

export async function buildLineDailySummary(
  dayKeyInput?: string,
  options: SummaryRenderOptions = {}
): Promise<LineDailySummary> {
  const reportDayKey = resolveBangkokDayKey(dayKeyInput);
  const { start, end } = getBangkokDayRange(reportDayKey);
  const reportDateLabel = formatThaiDate(reportDayKey);

  const [
    siteConfig,
    profitToday,
    channelSummary,
    salesTotalAgg,
    cashSalesAgg,
    creditSalesAgg,
    receiptTotalAgg,
    cashSaleCashAgg,
    cashSaleTransferAgg,
    receiptCashAgg,
    receiptTransferAgg,
    customerAdvanceTotalAgg,
    customerAdvanceCashAgg,
    customerAdvanceTransferAgg,
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
    paymentsTodayTotal,
    transfersTodayAgg,
    cancelledCounts,
    lotCounts,
    balanceAccounts,
    workboardData,
  ] = await Promise.all([
    runSummaryStep("siteConfig", () => getSiteConfig()),
    runSummaryStep("money.profitToday", () => aggregateProfitSummary(start, end)),
    runSummaryStep("money.channelSummary", () => getShopeeReportingSummary({ from: start, to: end })),
    runSummaryStep("money.salesTotal", () => db.sale.aggregate({
      _sum: { netAmount: true },
      where: {
        status: "ACTIVE",
        saleDate: { gte: start, lte: end },
      },
    })),
    runSummaryStep("money.cashSales", () => db.sale.aggregate({
      _sum: { netAmount: true },
      where: {
        status: "ACTIVE",
        paymentType: "CASH_SALE",
        saleDate: { gte: start, lte: end },
      },
    })),
    runSummaryStep("money.creditSales", () => db.sale.aggregate({
      _sum: { netAmount: true },
      where: {
        status: "ACTIVE",
        paymentType: "CREDIT_SALE",
        saleDate: { gte: start, lte: end },
      },
    })),
    runSummaryStep("money.receiptTotal", () => db.receipt.aggregate({
      _sum: { totalAmount: true },
      where: {
        status: "ACTIVE",
        receiptDate: { gte: start, lte: end },
      },
    })),
    runSummaryStep("money.cashSaleCash", () => db.sale.aggregate({
      _sum: { netAmount: true },
      where: {
        status: "ACTIVE",
        paymentType: "CASH_SALE",
        paymentMethod: "CASH",
        saleDate: { gte: start, lte: end },
      },
    })),
    runSummaryStep("money.cashSaleTransfer", () => db.sale.aggregate({
      _sum: { netAmount: true },
      where: {
        status: "ACTIVE",
        paymentType: "CASH_SALE",
        paymentMethod: "TRANSFER",
        saleDate: { gte: start, lte: end },
      },
    })),
    runSummaryStep("money.receiptCash", () => db.receipt.aggregate({
      _sum: { totalAmount: true },
      where: {
        status: "ACTIVE",
        paymentMethod: "CASH",
        receiptDate: { gte: start, lte: end },
      },
    })),
    runSummaryStep("money.receiptTransfer", () => db.receipt.aggregate({
      _sum: { totalAmount: true },
      where: {
        status: "ACTIVE",
        paymentMethod: "TRANSFER",
        receiptDate: { gte: start, lte: end },
      },
    })),
    runSummaryStep("money.customerAdvanceTotal", () => db.customerAdvance.aggregate({
      _sum: { totalAmount: true },
      where: {
        status: "ACTIVE",
        advanceDate: { gte: start, lte: end },
      },
    })),
    runSummaryStep("money.customerAdvanceCash", () => db.cashBankMovement.aggregate({
      _sum: { amount: true },
      where: {
        sourceType: "CUSTOMER_ADVANCE",
        direction: "IN",
        txnDate: { gte: start, lte: end },
        account: { type: "CASH" },
      },
    })),
    runSummaryStep("money.customerAdvanceTransfer", () => db.cashBankMovement.aggregate({
      _sum: { amount: true },
      where: {
        sourceType: "CUSTOMER_ADVANCE",
        direction: "IN",
        txnDate: { gte: start, lte: end },
        account: { type: "BANK" },
      },
    })),
    runSummaryStep("money.arOutstanding", () => db.sale.aggregate({
      _sum: { amountRemain: true },
      where: {
        status: "ACTIVE",
        paymentType: "CREDIT_SALE",
        fulfillmentType: "PICKUP",
        amountRemain: { gt: 0 },
      },
    })),
    runSummaryStep("money.codOutstanding", () => db.sale.aggregate({
      _sum: { amountRemain: true },
      where: {
        status: "ACTIVE",
        paymentType: "CREDIT_SALE",
        fulfillmentType: "DELIVERY",
        amountRemain: { gt: 0 },
      },
    })),
    runSummaryStep("money.apOutstanding", () => db.purchase.aggregate({
      _sum: { amountRemain: true },
      where: {
        status: "ACTIVE",
        purchaseType: "CREDIT_PURCHASE",
        amountRemain: { gt: 0 },
      },
    })),
    runSummaryStep("counts.pendingDelivery", () => db.sale.count({
      where: {
        status: "ACTIVE",
        fulfillmentType: "DELIVERY",
        shippingStatus: "PENDING",
      },
    })),
    runSummaryStep("counts.outForDelivery", () => db.sale.count({
      where: {
        status: "ACTIVE",
        fulfillmentType: "DELIVERY",
        shippingStatus: "OUT_FOR_DELIVERY",
      },
    })),
    runSummaryStep("counts.deliveredToday", () => db.sale.count({
      where: {
        status: "ACTIVE",
        fulfillmentType: "DELIVERY",
        shippingStatus: "DELIVERED",
        // Temporary proxy until we store a dedicated delivered timestamp on Sale.
        updatedAt: { gte: start, lte: end },
      },
    })),
    runSummaryStep("counts.lowStockCount", () => db.product.count({
      where: {
        isActive: true,
        stock: { gt: 0, lte: db.product.fields.minStock },
      },
    }).catch(() => 0),
    ),
    runSummaryStep("counts.outOfStockCount", () => db.product.count({
      where: buildOutOfStockProductsWhere(),
    })),
    runSummaryStep("counts.openClaimCount", () => db.warrantyClaim.count({
      where: {
        status: { in: ["DRAFT", "SENT_TO_SUPPLIER"] },
      },
    })),
    runSummaryStep("counts.adjustmentCount", () => db.adjustment.count({
      where: {
        status: "ACTIVE",
        adjustDate: { gte: start, lte: end },
      },
    })),
    // Use the same query as the "จ่ายเงิน" report so this total stays in sync
    // with what users see there (cash purchases + expenses + supplier advances +
    // supplier payments cash portion + CN cash refunds). Active rows only.
    runSummaryStep("money.paymentsToday", async () => {
      const rows = await queryDailyPaymentRows(
        {
          from: start,
          to: end,
          fromStr: reportDayKey,
          toStr: reportDayKey,
          hasFilter: true,
          showCancelled: false,
        },
        null,
      );
      return rows
        .filter((r) => r.status === "ACTIVE")
        .reduce((sum, r) => sum + r.amount, 0);
    }),
    runSummaryStep("money.transfersToday", () => db.cashBankTransfer.aggregate({
      _sum: { amount: true },
      where: {
        status: "ACTIVE",
        transferDate: { gte: start, lte: end },
      },
    })),
    runSummaryStep("counts.cancelledCounts", () => Promise.all([
      db.sale.count({ where: { status: "CANCELLED", cancelledAt: { gte: start, lte: end } } }),
      db.purchase.count({ where: { status: "CANCELLED", cancelledAt: { gte: start, lte: end } } }),
      db.receipt.count({ where: { status: "CANCELLED", cancelledAt: { gte: start, lte: end } } }),
      db.customerAdvance.count({ where: { status: "CANCELLED", cancelledAt: { gte: start, lte: end } } }),
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
    ])),
    runSummaryStep("counts.lotCounts", () => getLotExpiryCounts(start, end)),
    // Latest running balance per active cash/bank account — mirrors the
    // Cash/Bank Snapshot report so both surfaces stay in sync.
    runSummaryStep("balances.accounts", () => db.cashBankAccount.findMany({
      where: { isActive: true },
      orderBy: [{ type: "asc" }, { code: "asc" }],
      select: {
        id: true,
        name: true,
        type: true,
        openingBalance: true,
        movements: {
          orderBy: [
            { txnDate: "desc" },
            { sorder: "desc" },
            { createdAt: "desc" },
            { id: "desc" },
          ],
          take: 1,
          select: { balanceAfter: true },
        },
      },
    })),
    // Reuse the admin Workboard's tested backlog/risk queries (overdue AR with
    // aging, due AP, COD in transit, expiring lots, cash/bank below threshold,
    // pending deliveries, supplier claims) so the LINE risk radar and the
    // Workboard never drift. It computes "as of now", matching the existing
    // snapshot behaviour of the other risk counts here.
    runSummaryStep("risks.workboard", () => getWorkboardData()),
  ]);

  const money: MoneySection = {
    salesTotal: toNumber(salesTotalAgg._sum.netAmount),
    storeSales: channelSummary.store.salesAmount,
    storeGrossProfit: channelSummary.store.grossProfit,
    storeOrderCount: channelSummary.store.orderCount,
    shopeeSales: channelSummary.shopee.salesAmount,
    shopeeGrossProfit: channelSummary.shopee.grossProfit,
    shopeeOrderCount: channelSummary.shopee.orderCount,
    cashSales: toNumber(cashSalesAgg._sum.netAmount),
    creditSales: toNumber(creditSalesAgg._sum.netAmount),
    costOfGoodsSoldToday: profitToday.costAmount,
    grossProfitToday: profitToday.grossProfit,
    grossMarginPctToday: profitToday.marginPct,
    cashInFromSales: toNumber(cashSalesAgg._sum.netAmount),
    cashInFromReceipts: toNumber(receiptTotalAgg._sum.totalAmount),
    cashInFromCustomerAdvances: toNumber(customerAdvanceTotalAgg._sum.totalAmount),
    cashInTotal:
      toNumber(cashSalesAgg._sum.netAmount) +
      toNumber(receiptTotalAgg._sum.totalAmount) +
      toNumber(customerAdvanceTotalAgg._sum.totalAmount),
    cashChannelTotal:
      toNumber(cashSaleCashAgg._sum.netAmount) +
      toNumber(receiptCashAgg._sum.totalAmount) +
      toNumber(customerAdvanceCashAgg._sum.amount),
    transferChannelTotal:
      toNumber(cashSaleTransferAgg._sum.netAmount) +
      toNumber(receiptTransferAgg._sum.totalAmount) +
      toNumber(customerAdvanceTransferAgg._sum.amount),
    arOutstanding: toNumber(arOutstandingAgg._sum.amountRemain),
    codOutstanding: toNumber(codOutstandingAgg._sum.amountRemain),
    apOutstanding: toNumber(apOutstandingAgg._sum.amountRemain),
    expensesToday: toNumber(paymentsTodayTotal),
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

  const balanceItems: AccountBalanceItem[] = balanceAccounts.map((account) => ({
    label: account.name,
    balance: Number(account.movements[0]?.balanceAfter ?? account.openingBalance),
  }));
  const balances: BalanceSection = {
    accounts: balanceItems,
    totalBalance: balanceItems.reduce((sum, account) => sum + account.balance, 0),
  };

  const risks: RiskRadarSection = {
    overdueArCount: workboardData.overdueAr.count,
    overdueArAmount: workboardData.overdueAr.totalAmountRemain,
    outOfStockCount: workboardData.lowStock.count,
    dueApCount: workboardData.dueAp.count,
    dueApAmount: workboardData.dueAp.totalAmountRemain,
    codWaitingCount: workboardData.codWaiting.count,
    codWaitingAmount: workboardData.codWaiting.totalAmountRemain,
    expiringLotWithin30: workboardData.expiringLots.buckets.withinThirtyDays,
    cashBankBelowCount: workboardData.cashBankBelow.count,
    pendingAndClaimCount:
      workboardData.pendingDeliveries.count + workboardData.supplierClaims.count,
  };

  const message = renderEmojiLineDailySummaryMessage({
    reportDateLabel,
    money,
    counts,
    balances,
    risks,
  });
  const flexMessage = buildLineDailySummaryFlexMessageV3(
    {
      reportDateLabel,
      money,
      counts,
      balances,
      risks,
    },
    options
  );

  return {
    reportDayKey,
    reportDateLabel,
    shopName: siteConfig.shopName,
    range: { start, end },
    money,
    counts,
    balances,
    risks,
    message,
    messages: [flexMessage],
    flexMessage,
  };
}
