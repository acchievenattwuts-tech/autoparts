import { CheckCircle2, Circle } from "lucide-react";
import type { FulfillmentType, ShippingStatus } from "@/lib/generated/prisma";
import { formatDateThai } from "@/lib/th-date";

type TimelineStep = {
  label: string;
  date?: Date | null;
  done: boolean;
};

export default function OrderStatusTimeline({
  saleDate,
  fulfillmentType,
  shippingStatus,
  paid,
}: {
  saleDate: Date;
  fulfillmentType: FulfillmentType;
  shippingStatus: ShippingStatus;
  paid: boolean;
}) {
  const steps: TimelineStep[] = [
    { label: "สร้างบิล", date: saleDate, done: true },
    ...(fulfillmentType === "DELIVERY"
      ? [
          {
            label: "รอจัดส่ง",
            done: ["PENDING", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"].includes(shippingStatus),
          },
          {
            label: "กำลังจัดส่ง",
            done: ["OUT_FOR_DELIVERY", "DELIVERED"].includes(shippingStatus),
          },
          {
            label: "จัดส่งแล้ว",
            done: shippingStatus === "DELIVERED",
          },
        ]
      : [{ label: "รับหน้าร้าน", done: true }]),
    { label: "ชำระครบ", done: paid },
  ];

  return (
    <ol className="space-y-3">
      {steps.map((step, index) => (
        <li key={`${step.label}-${index}`} className="flex gap-3">
          <div className="pt-0.5">
            {step.done ? (
              <CheckCircle2 className="h-5 w-5 text-blue-700" />
            ) : (
              <Circle className="h-5 w-5 text-slate-300" />
            )}
          </div>
          <div>
            <p className={step.done ? "font-semibold text-slate-950" : "font-semibold text-slate-400"}>
              {step.label}
            </p>
            {step.date ? <p className="mt-0.5 text-xs text-slate-500">{formatDateThai(step.date)}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
