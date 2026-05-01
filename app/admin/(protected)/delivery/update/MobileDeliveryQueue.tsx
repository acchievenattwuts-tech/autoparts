"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { ArrowDown, Loader2 } from "lucide-react";

import { reorderDeliveryQueue } from "../../sales/actions";
import DeliveryProofSheet from "./DeliveryProofSheet";
import MobileDeliveryCard from "./MobileDeliveryCard";
import MobileStatusTabs from "./MobileStatusTabs";
import QueueHeader, { type Mode } from "./QueueHeader";

type ShippingStatus = "PENDING" | "OUT_FOR_DELIVERY" | "DELIVERED";

type Item = {
  saleId:             string;
  saleNo:             string;
  saleDate:           string;
  customerName:       string;
  customerPhone:      string | null;
  shippingAddress:    string | null;
  shippingStatus:     ShippingStatus;
  shippingMethod:     string;
  trackingNo:         string | null;
  netAmount:          number;
  paymentType:        string;
  amountRemain:       number;
  deliveryQueueOrder: number | null;
  proofCount:         number;
  latestProof:        DeliveryProofSummary | null;
};

export type DeliveryProofSummary = {
  id:           string;
  receiverName: string | null;
  capturedAt:   string;
};

type Counts = {
  PENDING:          number;
  OUT_FOR_DELIVERY: number;
};

type Props = {
  items:         Item[];
  counts:        Counts;
  currentFilter: ShippingStatus | null;
};

const PULL_THRESHOLD = 80;
const PULL_MAX       = 140;

const MobileDeliveryQueue = ({ items, counts, currentFilter }: Props) => {
  const router = useRouter();

  const initialIds = useMemo(() => items.map((i) => i.saleId), [items]);

  const [mode, setMode]                 = useState<Mode>("view");
  const [draftOrder, setDraftOrder]     = useState<string[]>(initialIds);
  const [error, setError]               = useState("");
  const [isPending, startTransition]    = useTransition();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDist, setPullDist]         = useState(0);
  const [selectedProofSale, setSelectedProofSale] = useState<Item | null>(null);

  // Sync draft when items prop changes (React recommended pattern)
  const [prevInitialIds, setPrevInitialIds] = useState(initialIds);
  if (prevInitialIds !== initialIds) {
    setPrevInitialIds(initialIds);
    setDraftOrder(initialIds);
  }

  const itemMap = useMemo(() => new Map(items.map((i) => [i.saleId, i])), [items]);

  const orderedItems: Item[] =
    mode === "reorder"
      ? draftOrder.map((id) => itemMap.get(id)).filter((i): i is Item => Boolean(i))
      : items;

  const originalIds = useMemo(() => items.map((i) => i.saleId), [items]);
  const hasChanges  = draftOrder.some((id, i) => id !== originalIds[i]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
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

  const handleMoveUp = (saleId: string) => {
    setDraftOrder((prev) => {
      const idx = prev.indexOf(saleId);
      if (idx <= 0) return prev;
      return arrayMove(prev, idx, idx - 1);
    });
  };

  const handleMoveDown = (saleId: string) => {
    setDraftOrder((prev) => {
      const idx = prev.indexOf(saleId);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      return arrayMove(prev, idx, idx + 1);
    });
  };

  const handleEnterReorder = () => {
    setError("");
    setDraftOrder(items.map((i) => i.saleId));
    setMode("reorder");
  };

  const handleCancelReorder = () => {
    setError("");
    setDraftOrder(items.map((i) => i.saleId));
    setMode("view");
  };

  const handleSaveReorder = () => {
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

  // Pull-to-refresh
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const touchStartY        = useRef<number | null>(null);
  const pulling            = useRef(false);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    if (mode === "reorder") return; // disable pull-to-refresh in drag mode

    const onTouchStart = (e: TouchEvent) => {
      if (window.scrollY > 0) return;
      touchStartY.current = e.touches[0].clientY;
      pulling.current = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!pulling.current || touchStartY.current === null) return;
      if (window.scrollY > 0) {
        pulling.current = false;
        setPullDist(0);
        return;
      }
      const delta = e.touches[0].clientY - touchStartY.current;
      if (delta <= 0) {
        setPullDist(0);
        return;
      }
      // Resist past threshold
      const eased = Math.min(PULL_MAX, delta * 0.5);
      setPullDist(eased);
      if (eased > 4) e.preventDefault();
    };

    const onTouchEnd = () => {
      if (!pulling.current) return;
      pulling.current = false;
      touchStartY.current = null;
      setPullDist((current) => {
        if (current >= PULL_THRESHOLD) {
          setIsRefreshing(true);
          router.refresh();
        }
        return 0;
      });
    };

    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd);
    container.addEventListener("touchcancel", onTouchEnd);

    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [mode, router]);

  // Clear refreshing indicator after items refresh
  useEffect(() => {
    if (isRefreshing) {
      const timer = setTimeout(() => setIsRefreshing(false), 600);
      return () => clearTimeout(timer);
    }
  }, [isRefreshing, items]);

  const pullProgress = Math.min(1, pullDist / PULL_THRESHOLD);
  const showSpinner  = isRefreshing || pullDist >= PULL_THRESHOLD;

  return (
    <div ref={scrollContainerRef} className="-m-4 lg:-m-6">
      {/* Pull-to-refresh indicator */}
      <div
        className="flex items-center justify-center overflow-hidden transition-[height] duration-150"
        style={{
          height: isRefreshing ? 56 : pullDist,
        }}
      >
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-slate-400">
          <Loader2
            size={18}
            className={showSpinner ? "animate-spin" : ""}
            style={{
              transform: showSpinner ? "none" : `rotate(${pullProgress * 360}deg)`,
              opacity:   pullProgress + (isRefreshing ? 1 : 0),
            }}
          />
          <span style={{ opacity: pullProgress + (isRefreshing ? 1 : 0) }}>
            {isRefreshing
              ? "กำลังโหลด..."
              : pullDist >= PULL_THRESHOLD
              ? "ปล่อยเพื่อรีเฟรช"
              : "ดึงเพื่อรีเฟรช"}
          </span>
        </div>
      </div>

      {/* Sticky header */}
      <div className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-white/10 dark:bg-[#0f172a]/95">
        <QueueHeader
          mode={mode}
          totalCount={items.length}
          isPending={isPending}
          hasChanges={hasChanges}
          onEnter={handleEnterReorder}
          onCancel={handleCancelReorder}
          onSave={handleSaveReorder}
        />
        {mode === "view" ? (
          <div className="mt-3">
            <MobileStatusTabs
              current={currentFilter}
              counts={counts}
              disabled={false}
            />
          </div>
        ) : null}
      </div>

      <div className="space-y-3 px-3 py-3 sm:px-4">
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-400/20 dark:bg-red-500/5 dark:text-red-300">
            <span>{error}</span>
          </div>
        )}

        {orderedItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-400 dark:border-white/10 dark:bg-slate-900 dark:text-slate-500">
            ไม่มีรายการจัดส่ง
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={orderedItems.map((i) => i.saleId)}
              strategy={verticalListSortingStrategy}
            >
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
                  proofCount={item.proofCount}
                  latestProof={item.latestProof}
                  queueIndex={index}
                  totalInList={orderedItems.length}
                  mode={mode}
                  canMoveUp={index > 0}
                  canMoveDown={index < orderedItems.length - 1}
                  onMoveUp={() => handleMoveUp(item.saleId)}
                  onMoveDown={() => handleMoveDown(item.saleId)}
                  onOpenProof={() => setSelectedProofSale(item)}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}

        {mode === "view" && items.length > 0 && (
          <div className="flex items-center justify-center gap-2 pt-2 text-xs text-gray-400 dark:text-slate-500">
            <ArrowDown size={12} />
            ดึงลงจากบนสุดเพื่อรีเฟรช
          </div>
        )}
      </div>

      <DeliveryProofSheet
        selectedSale={selectedProofSale}
        onClose={() => setSelectedProofSale(null)}
      />
    </div>
  );
};

export default MobileDeliveryQueue;
