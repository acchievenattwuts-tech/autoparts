import type { Prisma } from "@/lib/generated/prisma";
import { formatDateTimeThai } from "@/lib/th-date";

export type DeliveryLineEvent = "OUT_FOR_DELIVERY" | "DELIVERED";
export type DeliveryLineCard = {
  type: "flex";
  altText: string;
  contents: Prisma.InputJsonObject;
};

export const buildDeliveryOrderUrl = (baseUrl: string, saleId: string): string => {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:" || base.username || base.password) {
    throw new Error("INVALID_DELIVERY_APP_URL");
  }
  return new URL(`/liff/orders/${encodeURIComponent(saleId)}`, base.origin).toString();
};

const text = (value: string, size: string, color = "#213044"): Prisma.InputJsonObject => ({
  type: "text", text: value, size, color, wrap: true,
});

const detailRow = (label: string, value: string): Prisma.InputJsonObject => ({
  type: "box", layout: "vertical", spacing: "xs", margin: "lg",
  contents: [
    { type: "separator", color: "#D5DFE7", margin: "none" },
    { ...text(label, "xs", "#687586"), margin: "md" },
    text(value, "sm"),
  ],
});

export const buildDeliveryLineCard = (input: {
  eventStatus: DeliveryLineEvent; shopName: string; saleNo: string;
  customerName: string; eventAt: Date; orderUrl: string;
}): DeliveryLineCard => {
  const delivered = input.eventStatus === "DELIVERED";
  const title = delivered ? "จัดส่งสินค้าแล้ว" : "สินค้าออกส่งแล้ว";
  const gradient = {
    type: "linearGradient", angle: "150deg",
    startColor: delivered ? "#0F766E" : "#125E9E",
    endColor: delivered ? "#16A34A" : "#1E9FCA",
  };
  return {
    type: "flex", altText: `${title} · ${input.saleNo}`.slice(0, 400),
    contents: {
      type: "bubble", size: "mega",
      header: {
        type: "box", layout: "vertical", paddingAll: "20px", background: gradient,
        contents: [
          { ...text(input.shopName, "xs", "#FFFFFF"), weight: "bold" },
          { ...text(title, "xl", "#FFFFFF"), weight: "bold", margin: "md" },
          { ...text(delivered ? "ขอบคุณที่ใช้บริการ" : "บริการจัดส่งโดยร้าน", "sm", "#FFFFFF"), margin: "xs" },
        ],
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "20px", backgroundColor: "#FFFFFF",
        contents: [
          text("เลขที่บิลของคุณ", "xs", "#687586"),
          { ...text(input.saleNo, "lg"), weight: "bold", margin: "xs" },
          detailRow("ลูกค้า", input.customerName),
          detailRow(delivered ? "อัปเดตเป็นส่งแล้วเมื่อ" : "ออกส่งเมื่อ", formatDateTimeThai(input.eventAt)),
          { ...text(delivered ? 'ร้านค้าอัปเดตสถานะเป็น “ส่งแล้ว”' : "ทางร้านกำลังนำสินค้าไปจัดส่งให้คุณ", "sm"), margin: "lg" },
          {
            type: "box", layout: "vertical", margin: "lg", paddingAll: "13px",
            cornerRadius: "9px", background: gradient,
            action: { type: "uri", label: delivered ? "ดูรายการสั่งซื้อ" : "ติดตามการจัดส่ง", uri: input.orderUrl },
            contents: [{ ...text(delivered ? "ดูรายการสั่งซื้อ" : "ติดตามการจัดส่ง", "sm", "#FFFFFF"), weight: "bold", align: "center" }],
          },
          { ...text(delivered ? "หากมีข้อสงสัย ทักแชทหาร้านได้เลย" : "ขอบคุณที่ไว้วางใจร้านของเรา", "xs", "#687586"), align: "center", margin: "md" },
        ],
      },
    },
  };
};
