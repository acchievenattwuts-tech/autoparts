import { ExternalLink } from "lucide-react";
import type { ShippingMethod } from "@/lib/generated/prisma";

const TRACKING_URL: Partial<Record<ShippingMethod, (trackingNo: string) => string>> = {
  KERRY: (trackingNo) => `https://th.kerryexpress.com/th/track/?track=${encodeURIComponent(trackingNo)}`,
  FLASH: (trackingNo) => `https://www.flashexpress.co.th/tracking/?se=${encodeURIComponent(trackingNo)}`,
  JT: (trackingNo) => `https://www.jtexpress.co.th/index/query/gzquery.html?bills=${encodeURIComponent(trackingNo)}`,
  OTHER: (trackingNo) => `https://www.google.com/search?q=tracking+${encodeURIComponent(trackingNo)}`,
};

export default function TrackingSmartLink({
  shippingMethod,
  trackingNo,
}: {
  shippingMethod: ShippingMethod;
  trackingNo: string | null;
}) {
  if (!trackingNo) {
    return null;
  }

  const href = TRACKING_URL[shippingMethod]?.(trackingNo);

  if (!href) {
    return (
      <p className="mt-2 rounded-xl bg-blue-50/60 px-3 py-2 font-mono text-sm text-slate-700">
        Tracking: {trackingNo}
      </p>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="mt-3 inline-flex items-center gap-2 rounded-xl bg-blue-800 px-3 py-2 text-sm font-bold text-white shadow-sm shadow-blue-900/20"
    >
      ติดตามพัสดุ
      <ExternalLink size={14} />
    </a>
  );
}
