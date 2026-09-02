export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { notFound } from "next/navigation";

import ParcelLabelDocument, {
  buildParcelLabelCss,
  type ParcelLabelParty,
} from "@/app/admin/_components/ParcelLabelDocument";
import {
  PARCEL_LABEL_MAX_IDS,
  PARCEL_LABEL_SIZE_CONFIG,
  parseParcelLabelSize,
} from "@/app/admin/_components/print/parcel-label";
import AutoPrint from "@/components/shared/AutoPrint";
import BrowserPrintButton from "@/components/shared/BrowserPrintButton";
import { db } from "@/lib/db";
import { MANUAL_MARKETPLACE_CHANNELS } from "@/lib/marketplace/config";
import { requirePermission } from "@/lib/require-auth";
import { defaultSiteConfig } from "@/lib/site-config";
import ParcelLabelSizeSwitch from "./ParcelLabelSizeSwitch";

/** คีย์ของ SiteContent ที่ใบนี้ใช้ — อ่านเท่าที่ใช้จริง ไม่ดึงทั้งตาราง */
const SHOP_CONTENT_KEYS = ["shop_name", "shop_address", "shop_phone"] as const;

const buildSender = (contents: { key: string; value: string }[]): ParcelLabelParty => {
  const map = new Map(contents.map((item) => [item.key, item.value]));

  return {
    name: map.get("shop_name")?.trim() || defaultSiteConfig.shopName,
    address: map.get("shop_address")?.trim() ?? "",
    phone: map.get("shop_phone")?.trim() ?? "",
  };
};

const ParcelLabelsPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string; size?: string }>;
}) => {
  await requirePermission("delivery.view");
  const { ids, size } = await searchParams;

  if (!ids) notFound();

  const idList = ids.split(",").filter(Boolean).slice(0, PARCEL_LABEL_MAX_IDS);
  if (idList.length === 0) notFound();

  const labelSize = parseParcelLabelSize(size);

  // อ่านอย่างเดียว — ยิงคู่ขนานบน autocommit client เหมือนหน้าพิมพ์ใบส่งของ
  // ไม่เปิด interactive transaction เพื่อไม่ให้ query ถูกบีบลงคอนเนกชันเดียว
  const [sales, siteContents] = await Promise.all([
    db.sale.findMany({
      where: {
        id: { in: idList },
        fulfillmentType: "DELIVERY",
        status: "ACTIVE",
        // ใบขาย Shopee / Lazada ไม่พิมพ์ใบปะกล่อง — แพลตฟอร์มออกใบให้เอง และ
        // `shippingAddress` ของบิลพวกนี้มักยังเป็นข้อความตั้งต้นของช่องทาง
        // ไม่ใช่ที่อยู่จริงของผู้ซื้อ ถ้าพิมพ์ออกไปจะส่งผิด
        channel: { notIn: [...MANUAL_MARKETPLACE_CHANNELS] },
      },
      orderBy: [{ saleDate: "asc" }, { saleNo: "asc" }],
      select: {
        id: true,
        customerName: true,
        customerPhone: true,
        shippingAddress: true,
        customer: { select: { name: true, phone: true, address: true, shippingAddress: true } },
      },
    }),
    db.siteContent.findMany({
      where: { key: { in: [...SHOP_CONTENT_KEYS] } },
      select: { key: true, value: true },
    }),
  ]);

  if (sales.length === 0) notFound();

  const sender = buildSender(siteContents);
  const sizeConfig = PARCEL_LABEL_SIZE_CONFIG[labelSize];

  return (
    <>
      <style>{`
${buildParcelLabelCss(labelSize)}
        @media print {
          body { background: #ffffff !important; }
          .no-print { display: none !important; }
        }
        @media screen {
          body { background: #f3f4f6 !important; color: #111827 !important; }
          .pl-sheet {
            margin: 24px auto;
            border-radius: 6px;
            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.14);
          }
        }
      `}</style>

      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b bg-white p-4">
        <span className="font-medium text-gray-700">
          ใบปะหน้ากล่อง {sales.length} ใบ · {sizeConfig.label}
        </span>
        <div className="flex items-center gap-3">
          <ParcelLabelSizeSwitch value={labelSize} />
          <BrowserPrintButton
            label="พิมพ์ทั้งหมด"
            className="rounded-lg bg-[#1e3a5f] px-4 py-1.5 text-sm text-white transition-colors hover:bg-[#162d4a]"
          />
        </div>
      </div>

      <Suspense fallback={null}>
        <AutoPrint />
      </Suspense>

      {sales.map((sale, index) => (
        <ParcelLabelDocument
          key={sale.id}
          isLead={index === 0}
          sender={sender}
          recipient={{
            name: sale.customerName?.trim() || sale.customer?.name?.trim() || "",
            phone: sale.customerPhone?.trim() || sale.customer?.phone?.trim() || "",
            address:
              sale.shippingAddress?.trim() ||
              sale.customer?.shippingAddress?.trim() ||
              sale.customer?.address?.trim() ||
              "",
          }}
        />
      ))}
    </>
  );
};

export default ParcelLabelsPage;
