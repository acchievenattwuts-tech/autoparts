"use client";

import { useState, useTransition, type CSSProperties } from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Copy,
  GripVertical,
  Hourglass,
  Loader2,
  MapPin,
  PackageCheck,
  Phone,
  RotateCcw,
  Save,
  Truck,
  UserCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { updateShippingStatus } from "../../sales/actions";
import {
  SHIPPING_METHOD_LABEL,
  SHIPPING_METHOD_OPTIONS,
  SHIPPING_STATUS_BADGE,
  SHIPPING_STATUS_LABEL,
} from "@/lib/shipping";
import { formatDateThai } from "@/lib/th-date";

type ShippingStatus = "PENDING" | "OUT_FOR_DELIVERY" | "DELIVERED";
type CardMode = "view" | "reorder";

type Props = {
  saleId: string;
  saleNo: string;
  saleDate: string;
  customerName: string;
  customerPhone: string | null;
  shippingAddress: string | null;
  shippingStatus: ShippingStatus;
  shippingMethod: string;
  trackingNo: string | null;
  netAmount: number;
  paymentType: string;
  amountRemain: number;
  deliveryStaffId: string | null;
  deliveryStaffName: string | null;
  proofCount: number;
  queueIndex: number;
  mode: CardMode;
  canUpdate: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onOpenProof: () => void;
};

const STATUS_ACTION = {
  PENDING: { label: "รอจัดส่ง", Icon: Hourglass },
  OUT_FOR_DELIVERY: { label: "กำลังส่ง", Icon: Truck },
  DELIVERED: { label: "ส่งแล้ว", Icon: PackageCheck },
} satisfies Record<ShippingStatus, { label: string; Icon: typeof Truck }>;

const STATUS_DOT = {
  PENDING: "bg-amber-400",
  OUT_FOR_DELIVERY: "bg-sky-400",
  DELIVERED: "bg-emerald-500",
} satisfies Record<ShippingStatus, string>;

const PREV_STATUS: Partial<Record<ShippingStatus, ShippingStatus>> = {
  OUT_FOR_DELIVERY: "PENDING",
  DELIVERED: "OUT_FOR_DELIVERY",
};

const isExternalCarrier = (method: string) => method !== "NONE" && method !== "SELF";

const getDeliveryStaffLabel = ({
  shippingStatus,
  deliveryStaffName,
}: {
  shippingStatus: ShippingStatus;
  deliveryStaffName?: string | null;
}) => {
  if (deliveryStaffName) {
    return {
      label: deliveryStaffName,
      helper: "ผู้ส่ง",
      className:
        "border-blue-100 bg-blue-50 text-blue-800 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-200",
      iconClassName: "bg-blue-100 text-blue-700 dark:bg-blue-400/15 dark:text-blue-200",
    };
  }

  if (shippingStatus === "DELIVERED") {
    return {
      label: "ยังไม่ได้บันทึกผู้ส่ง",
      helper: "ควรตรวจสอบ",
      className:
        "border-amber-100 bg-amber-50 text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200",
      iconClassName: "bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-200",
    };
  }

  return {
    label: "บันทึกอัตโนมัติ",
    helper: "เมื่อกดส่งแล้ว",
    className:
      "border-gray-200 bg-gray-50 text-gray-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200",
    iconClassName: "bg-white text-gray-500 dark:bg-slate-900 dark:text-slate-300",
  };
};

const MobileDeliveryCard = ({
  saleId,
  saleNo,
  saleDate,
  customerName,
  customerPhone,
  shippingAddress,
  shippingStatus,
  shippingMethod,
  trackingNo,
  netAmount,
  paymentType,
  amountRemain,
  deliveryStaffName,
  proofCount,
  queueIndex,
  mode,
  canUpdate,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onOpenProof,
}: Props) => {
  const router = useRouter();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: saleId,
    disabled: mode !== "reorder",
  });

  const dragStyle: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
    zIndex: isDragging ? 30 : undefined,
  };

  const [isPending, startTransition] = useTransition();
  const [trackingInput, setTrackingInput] = useState(trackingNo ?? "");
  const [shippingMethodInput, setShippingMethodInput] = useState(shippingMethod);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const [prevTrackingNo, setPrevTrackingNo] = useState(trackingNo ?? "");
  const propTracking = trackingNo ?? "";
  if (prevTrackingNo !== propTracking) {
    setPrevTrackingNo(propTracking);
    setTrackingInput(propTracking);
  }

  const [prevShippingMethod, setPrevShippingMethod] = useState(shippingMethod);
  if (prevShippingMethod !== shippingMethod) {
    setPrevShippingMethod(shippingMethod);
    setShippingMethodInput(shippingMethod);
  }

  const requiresTracking = isExternalCarrier(shippingMethodInput);
  const trackingChanged =
    trackingInput.trim() !== (trackingNo ?? "") || shippingMethodInput !== shippingMethod;
  const phoneDigits = customerPhone?.replace(/[^0-9+]/g, "") ?? "";
  const mapsHref = shippingAddress
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shippingAddress)}`
    : null;
  const deliveryStaffLabel = getDeliveryStaffLabel({
    shippingStatus,
    deliveryStaffName,
  });

  const runUpdate = (nextStatus: ShippingStatus) => {
    setError("");
    startTransition(async () => {
      const result = await updateShippingStatus(saleId, {
        shippingStatus: nextStatus,
        trackingNo: trackingInput.trim(),
        shippingMethod: shippingMethodInput,
      });
      if (result?.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  const handleSaveTracking = () => {
    if (!canUpdate) return;
    runUpdate(shippingStatus);
  };

  const handleStatusChange = (nextStatus: ShippingStatus) => {
    if (!canUpdate) return;
    if (
      requiresTracking &&
      (nextStatus === "OUT_FOR_DELIVERY" || nextStatus === "DELIVERED") &&
      !trackingInput.trim()
    ) {
      setError("กรุณากรอกเลขติดตามก่อนเปลี่ยนสถานะ");
      return;
    }

    const isBackward = PREV_STATUS[shippingStatus] === nextStatus;
    const confirmText =
      nextStatus === "DELIVERED"
        ? `ยืนยันว่าส่ง ${saleNo} ถึงลูกค้าแล้วใช่หรือไม่?`
        : isBackward
          ? `ยืนยันการย้อนสถานะ ${saleNo} กลับเป็น "${STATUS_ACTION[nextStatus].label}"?`
          : null;

    if (confirmText && !window.confirm(confirmText)) return;
    runUpdate(nextStatus);
  };

  const handleCopyTracking = async () => {
    if (!trackingInput.trim()) return;
    try {
      await navigator.clipboard.writeText(trackingInput.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Ignore clipboard errors on unsupported devices
    }
  };

  if (mode === "reorder") {
    return (
      <div
        ref={setNodeRef}
        style={dragStyle}
        className={`overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900 ${
          isDragging ? "shadow-2xl ring-2 ring-[#1e3a5f] dark:ring-sky-400" : ""
        }`}
      >
        <div className="flex items-center gap-3 px-4 py-4">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="touch-none rounded-xl border border-gray-200 bg-gray-50 p-2.5 text-gray-500 active:scale-95 active:bg-gray-100 dark:border-white/10 dark:bg-slate-800 dark:text-slate-300"
            aria-label="ลากเพื่อจัดลำดับ"
          >
            <GripVertical size={20} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-gray-900 dark:text-slate-100">
              {customerName}
            </p>
            {shippingAddress ? (
              <p className="truncate text-xs text-gray-500 dark:text-slate-400">{shippingAddress}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={onMoveUp}
              disabled={!canMoveUp}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-30 dark:border-white/10 dark:bg-slate-900 dark:text-slate-300"
              aria-label="เลื่อนขึ้น"
            >
              <ChevronUp size={16} />
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={!canMoveDown}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-30 dark:border-white/10 dark:bg-slate-900 dark:text-slate-300"
              aria-label="เลื่อนลง"
            >
              <ChevronDown size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={dragStyle}
      className={`overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900 ${
        isDragging ? "shadow-2xl ring-2 ring-[#1e3a5f] dark:ring-sky-400" : ""
      }`}
    >
      <div className="flex items-stretch border-b border-gray-100 dark:border-white/10">
        <div className="flex w-14 shrink-0 items-center justify-center bg-gradient-to-br from-[#1e3a5f] to-[#2d4f7a] text-white dark:from-slate-800 dark:to-slate-700">
          <span className="font-kanit text-xl font-bold tabular-nums">
            {String(queueIndex + 1).padStart(2, "0")}
          </span>
        </div>
        <div className="flex flex-1 items-start justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[shippingStatus]}`} />
              <p className="font-mono text-base font-semibold text-[#1e3a5f] dark:text-sky-300">{saleNo}</p>
            </div>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">{formatDateThai(saleDate)}</p>
          </div>
          <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${SHIPPING_STATUS_BADGE[shippingStatus]}`}>
            {SHIPPING_STATUS_LABEL[shippingStatus]}
          </span>
        </div>
      </div>

      <div className="space-y-3 px-4 py-3">
        <div>
          <p className="text-base font-semibold text-gray-900 dark:text-slate-100">{customerName}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-base font-bold text-gray-900 dark:text-slate-100">
              ฿{netAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
            </span>
            {paymentType === "CASH_SALE" ? (
              <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200">
                ชำระแล้ว
              </span>
            ) : (
              <span className="inline-flex rounded-full bg-orange-100 px-2.5 py-0.5 text-[11px] font-medium text-orange-700 dark:bg-orange-400/15 dark:text-orange-200">
                COD ฿{amountRemain.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {phoneDigits ? (
            <a
              href={`tel:${phoneDigits}`}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-50 px-3 py-2.5 text-sm font-medium text-blue-700 active:scale-[0.98] dark:bg-blue-400/10 dark:text-blue-300"
            >
              <Phone size={16} />
              <span className="truncate">{customerPhone}</span>
            </a>
          ) : (
            <span className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-50 px-3 py-2.5 text-sm font-medium text-gray-400 dark:bg-white/5 dark:text-slate-500">
              <Phone size={16} />
              ไม่มีเบอร์
            </span>
          )}
          {mapsHref ? (
            <a
              href={mapsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-700 active:scale-[0.98] dark:bg-emerald-400/10 dark:text-emerald-300"
            >
              <MapPin size={16} />
              เปิดแผนที่
            </a>
          ) : (
            <span className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-50 px-3 py-2.5 text-sm font-medium text-gray-400 dark:bg-white/5 dark:text-slate-500">
              <MapPin size={16} />
              ไม่มีที่อยู่
            </span>
          )}
        </div>

        {shippingAddress ? (
          <div className="rounded-2xl bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:bg-white/5 dark:text-slate-300">
            {shippingAddress}
          </div>
        ) : null}

        <div className={`flex items-center gap-3 rounded-2xl border px-3 py-2.5 ${deliveryStaffLabel.className}`}>
          <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${deliveryStaffLabel.iconClassName}`}>
            <UserCheck size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{deliveryStaffLabel.label}</p>
            <p className="text-xs opacity-70">{deliveryStaffLabel.helper}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenProof}
          disabled={!canUpdate}
          className={`inline-flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium ${
            proofCount > 0
              ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200"
              : "border-gray-200 bg-white text-gray-700 hover:border-[#1e3a5f] dark:border-white/10 dark:bg-slate-900 dark:text-slate-200"
          } disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {proofCount > 0 ? <CheckCircle2 size={16} /> : <ClipboardCheck size={16} />}
          {proofCount > 0
            ? `มีหลักฐาน ${proofCount.toLocaleString("th-TH")} รายการ`
            : "หลักฐานรับของ"}
        </button>

        <div className="rounded-2xl border border-gray-200 p-3 dark:border-white/10">
          <div className="grid gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-gray-500 dark:text-slate-400">ประเภทขนส่ง</span>
              <span className="text-sm font-medium text-gray-900 dark:text-slate-100">
                {SHIPPING_METHOD_OPTIONS[shippingMethodInput] ?? SHIPPING_METHOD_LABEL[shippingMethodInput] ?? "-"}
              </span>
            </div>

            {canUpdate ? (
              <select
                value={shippingMethodInput}
                onChange={(event) => {
                  setShippingMethodInput(event.target.value);
                  setError("");
                }}
                className="rounded-xl border border-gray-300 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
              >
                {Object.entries(SHIPPING_METHOD_OPTIONS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            ) : null}

            {isExternalCarrier(shippingMethodInput) || trackingInput ? (
              <div>
                <label className="mb-1 block text-xs text-gray-500 dark:text-slate-400">
                  เลขติดตาม{requiresTracking ? " *" : ""}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={trackingInput}
                    onChange={(event) => {
                      setTrackingInput(event.target.value);
                      setError("");
                    }}
                    disabled={!canUpdate}
                    className="min-w-0 flex-1 rounded-xl border border-gray-300 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
                    placeholder="Tracking"
                  />
                  <button
                    type="button"
                    onClick={handleCopyTracking}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 text-gray-600 dark:border-white/10 dark:text-slate-200"
                    aria-label="คัดลอก tracking"
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                </div>
              </div>
            ) : null}

            {canUpdate ? (
              <button
                type="button"
                onClick={handleSaveTracking}
                disabled={isPending || !trackingChanged}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
              >
                {isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                บันทึกขนส่ง
              </button>
            ) : null}
          </div>
        </div>

        {canUpdate ? (
          <div className="grid grid-cols-2 gap-2">
            {shippingStatus === "PENDING" ? (
              <button
                type="button"
                onClick={() => handleStatusChange("OUT_FOR_DELIVERY")}
                disabled={isPending}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1e3a5f] px-3 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                <Truck size={16} />
                ออกส่ง
              </button>
            ) : null}
            {shippingStatus !== "DELIVERED" ? (
              <button
                type="button"
                onClick={() => handleStatusChange("DELIVERED")}
                disabled={isPending}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                <PackageCheck size={16} />
                ส่งแล้ว
              </button>
            ) : null}
            {PREV_STATUS[shippingStatus] ? (
              <button
                type="button"
                onClick={() => handleStatusChange(PREV_STATUS[shippingStatus]!)}
                disabled={isPending}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-sm font-medium text-amber-800 disabled:opacity-50 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200"
              >
                <RotateCcw size={16} />
                ย้อนกลับ
              </button>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p className="text-sm text-red-600 dark:text-red-300">{error}</p>
        ) : null}
      </div>
    </div>
  );
};

export default MobileDeliveryCard;
