"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { AlertTriangle } from "lucide-react";

import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import { appendDeliveryDateParams } from "@/lib/delivery-date-filter";
import { reorderDeliveryQueue } from "../../sales/actions";
import GpsUpdateBanner from "./GpsUpdateBanner";
import MobileDeliveryCard from "./MobileDeliveryCard";
import MobileStatusTabs from "./MobileStatusTabs";
import QueueHeader, { type Mode } from "./QueueHeader";

// Lazy-load heavy sheets — only loaded when user opens them
const DeliveryProofSheet = dynamic(() => import("./DeliveryProofSheet"), {
  ssr: false,
});
const DestinationPinSheet = dynamic(() => import("./DestinationPinSheet"), {
  ssr: false,
});

type ShippingStatus = "PENDING" | "OUT_FOR_DELIVERY" | "DELIVERED";

type Item = {
  id: string;
  productCode: string;
  productName: string;
  unitName: string;
  quantity: number;
  salePrice: number;
  totalAmount: number;
  lots: { lotNo: string; qty: number }[];
};

type QueueItem = {
  saleId: string;
  saleNo: string;
  saleDate: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string | null;
  shippingAddress: string | null;
  shippingStatus: ShippingStatus;
  shippingMethod: string;
  trackingNo: string | null;
  netAmount: number;
  paymentType: string;
  amountRemain: number;
  deliveryQueueOrder: number | null;
  deliveryStaffId: string | null;
  deliveryStaffName: string | null;
  destLatitude: number | null;
  destLongitude: number | null;
  proofCount: number;
  items: Item[];
};

type Counts = {
  PENDING: number;
  OUT_FOR_DELIVERY: number;
};

type Props = {
  items: QueueItem[];
  counts: Counts;
  currentFilter: ShippingStatus | null;
  canUpdate: boolean;
  canReorder: boolean;
  canTrack: boolean;
  myOutForDeliveryIds: string[];
  fromDate: string;
  toDate: string;
  /** `fromDate` minus the `ส่งแล้ว` default, so tab links don't leak it. */
  linkFromDate: string;
  currentLimit: number;
  hasMore: boolean;
};

const MobileDeliveryQueue = ({
  items,
  counts,
  currentFilter,
  canUpdate,
  canReorder,
  canTrack,
  myOutForDeliveryIds,
  fromDate,
  toDate,
  linkFromDate,
  currentLimit,
  hasMore,
}: Props) => {
  const router = useRouter();
  const initialIds = useMemo(() => items.map((i) => i.saleId), [items]);

  const [mode, setMode] = useState<Mode>("view");
  const [draftOrder, setDraftOrder] = useState<string[]>(initialIds);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const [selectedProofSale, setSelectedProofSale] = useState<QueueItem | null>(null);
  const [selectedPinSale, setSelectedPinSale] = useState<QueueItem | null>(null);

  const [prevInitialIds, setPrevInitialIds] = useState(initialIds);
  if (prevInitialIds !== initialIds) {
    setPrevInitialIds(initialIds);
    setDraftOrder(initialIds);
    if (mode === "reorder" && !canReorder) {
      setMode("view");
    }
  }

  const itemMap = useMemo(() => new Map(items.map((i) => [i.saleId, i])), [items]);
  const orderedItems =
    mode === "reorder"
      ? draftOrder.map((id) => itemMap.get(id)).filter((i): i is QueueItem => Boolean(i))
      : items;
  const originalIds = useMemo(() => items.map((i) => i.saleId), [items]);
  const hasChanges = draftOrder.some((id, index) => id !== originalIds[index]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setDraftOrder((prev) => {
      const oldIndex = prev.indexOf(String(active.id));
      const newIndex = prev.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  const handleSaveReorder = () => {
    if (!canReorder) return;
    setError("");
    startTransition(async () => {
      const result = await reorderDeliveryQueue(draftOrder);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setMode("view");
      router.refresh();
    });
  };

  const loadMoreHref = (() => {
    const params = new URLSearchParams();
    if (currentFilter) params.set("status", currentFilter);
    appendDeliveryDateParams(params, { fromKey: linkFromDate, toKey: toDate });
    params.set("limit", String(Math.min(300, currentLimit + 100)));
    return `/admin/delivery/update?${params.toString()}`;
  })();

  return (
    <div className="-m-4 lg:-m-6">
      <div className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-white/10 dark:bg-[#0f172a]/95">
        <QueueHeader
          mode={mode}
          totalCount={items.length}
          isPending={isPending}
          hasChanges={hasChanges}
          canReorder={canReorder}
          onEnter={() => {
            if (!canReorder) return;
            setError("");
            setDraftOrder(items.map((i) => i.saleId));
            setMode("reorder");
          }}
          onCancel={() => {
            setError("");
            setDraftOrder(items.map((i) => i.saleId));
            setMode("view");
          }}
          onSave={handleSaveReorder}
        />
        {mode === "view" ? (
          <div className="mt-3 space-y-3">
            <MobileStatusTabs
              current={currentFilter}
              counts={counts}
              disabled={false}
              fromDate={linkFromDate}
              toDate={toDate}
            />
            <AdminSearchForm method="GET" className="space-y-2">
              {currentFilter ? <input type="hidden" name="status" value={currentFilter} /> : null}
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="block text-[11px] font-medium text-gray-500 dark:text-slate-400">
                    ตั้งแต่วันที่
                  </span>
                  <input
                    type="date"
                    name="from"
                    defaultValue={fromDate}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-[11px] font-medium text-gray-500 dark:text-slate-400">
                    ถึงวันที่
                  </span>
                  <input
                    type="date"
                    name="to"
                    defaultValue={toDate}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
                  />
                </label>
              </div>
              <AdminSearchSubmitButton className="inline-flex w-full items-center justify-center rounded-xl bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#162d4a] dark:bg-sky-700 dark:hover:bg-sky-600">
                แสดงรายการ
              </AdminSearchSubmitButton>
            </AdminSearchForm>
          </div>
        ) : null}
      </div>

      <div className="space-y-3 px-3 py-3 sm:px-4">
        {canTrack && myOutForDeliveryIds.length > 0 ? (
          <GpsUpdateBanner saleIds={myOutForDeliveryIds} />
        ) : null}

        {!canUpdate ? (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>บัญชีนี้ดูคิวได้เท่านั้น ไม่สามารถอัปเดตสถานะ จัดคิว หรือบันทึกหลักฐานได้</span>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-400/20 dark:bg-red-500/5 dark:text-red-300">
            {error}
          </div>
        ) : null}

        {hasMore ? (
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:border-sky-400/20 dark:bg-sky-400/10 dark:text-sky-200">
            ตอนนี้แสดง {items.length.toLocaleString("th-TH")} รายการแรก ถ้าต้องการจัดลำดับคิว กรุณาโหลดรายการให้ครบก่อน
          </div>
        ) : null}

        {orderedItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-400 dark:border-white/10 dark:bg-slate-900 dark:text-slate-500">
            ไม่มีรายการจัดส่ง
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={orderedItems.map((i) => i.saleId)} strategy={verticalListSortingStrategy}>
              {orderedItems.map((item, index) => (
                <MobileDeliveryCard
                  key={item.saleId}
                  saleId={item.saleId}
                  saleNo={item.saleNo}
                  saleDate={item.saleDate}
                  customerName={item.customerName}
                  customerPhone={item.customerPhone}
                  shippingAddress={item.shippingAddress}
                  shippingStatus={item.shippingStatus}
                  shippingMethod={item.shippingMethod}
                  trackingNo={item.trackingNo}
                  netAmount={item.netAmount}
                  paymentType={item.paymentType}
                  amountRemain={item.amountRemain}
                  deliveryStaffId={item.deliveryStaffId}
                  deliveryStaffName={item.deliveryStaffName}
                  destLatitude={item.destLatitude}
                  destLongitude={item.destLongitude}
                  proofCount={item.proofCount}
                  items={item.items}
                  queueIndex={index}
                  mode={mode}
                  canUpdate={canUpdate}
                  canMoveUp={index > 0}
                  canMoveDown={index < orderedItems.length - 1}
                  onMoveUp={() => setDraftOrder((prev) => arrayMove(prev, index, index - 1))}
                  onMoveDown={() => setDraftOrder((prev) => arrayMove(prev, index, index + 1))}
                  onOpenProof={() => setSelectedProofSale(item)}
                  onOpenPin={() => setSelectedPinSale(item)}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}

        {hasMore ? (
          <a
            href={loadMoreHref}
            className="inline-flex w-full items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:border-[#1e3a5f] hover:text-[#1e3a5f] dark:border-white/10 dark:bg-slate-900 dark:text-slate-100"
          >
            โหลดเพิ่ม
          </a>
        ) : null}

      </div>

      <DeliveryProofSheet
        selectedSale={
          selectedProofSale
            ? {
                saleId: selectedProofSale.saleId,
                saleNo: selectedProofSale.saleNo,
                customerName: selectedProofSale.customerName,
                proofCount: selectedProofSale.proofCount,
              }
            : null
        }
        canUpdate={canUpdate}
        onClose={() => setSelectedProofSale(null)}
      />

      <DestinationPinSheet
        selectedSale={
          selectedPinSale
            ? {
                saleId: selectedPinSale.saleId,
                saleNo: selectedPinSale.saleNo,
                customerId: selectedPinSale.customerId,
                customerName: selectedPinSale.customerName,
                destLatitude: selectedPinSale.destLatitude,
                destLongitude: selectedPinSale.destLongitude,
              }
            : null
        }
        onClose={() => setSelectedPinSale(null)}
      />
    </div>
  );
};

export default MobileDeliveryQueue;
