import { ExternalLink } from "lucide-react";
import type { ShippingMethod } from "@/lib/generated/prisma";
import { getShippingTrackingUrl } from "@/lib/shipping";

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

  const href = getShippingTrackingUrl(shippingMethod, trackingNo);

  if (!href) {
    return (
      <p className="mt-2 rounded-xl bg-blue-50/60 px-3 py-2 font-mono text-sm text-slate-700">
        Tracking: {trackingNo}
      </p>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="rounded-xl bg-blue-50/60 px-3 py-2 font-mono text-sm text-slate-700">
        {trackingNo}
      </span>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 rounded-xl bg-blue-800 px-3 py-2 text-sm font-bold text-white shadow-sm shadow-blue-900/20"
      >
        ติดตามพัสดุ
        <ExternalLink size={14} />
      </a>
    </div>
  );
}
