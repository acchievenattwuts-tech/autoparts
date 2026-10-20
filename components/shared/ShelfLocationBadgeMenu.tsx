"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, PackageX, Star } from "lucide-react";

import { changeShelfLocationAction } from "@/app/admin/(protected)/stock/shelf-map/location-actions";
import {
  formatShelfBadgeLabel,
  shelfBadgeClassName,
  shelfBadgeTitle,
  type ShelfLocationBadgeItem,
} from "@/components/shared/ShelfLocationBadges";
import { cn } from "@/lib/utils";

type ShelfLocationBadgeMenuProps = {
  productId: string;
  locations: readonly ShelfLocationBadgeItem[];
  size?: "sm" | "md";
  emptyLabel?: string;
  className?: string;
};

type MenuAction = "confirm" | "promote" | "remove";

const menuItemClassName =
  "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-60 dark:text-slate-200 dark:hover:bg-white/10";

/**
 * ShelfLocationBadges plus the per-location actions for staff holding stock.shelf_map.manage:
 * confirm it is still there, make an overflow location the home, or mark a location empty
 * ("ที่นี่หมดแล้ว"). Render ShelfLocationBadges instead for people without that permission.
 */
const ShelfLocationBadgeMenu = ({
  productId,
  locations,
  size = "sm",
  emptyLabel = "ยังไม่มีที่เก็บ",
  className,
}: ShelfLocationBadgeMenuProps) => {
  const router = useRouter();
  const containerRef = useRef<HTMLSpanElement>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!openId) return;
    const handlePointer = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpenId(null);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenId(null);
    };
    document.addEventListener("pointerdown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [openId]);

  if (locations.length === 0) {
    return <span className={cn("text-xs text-gray-400 dark:text-slate-500", className)}>{emptyLabel}</span>;
  }

  const runAction = (location: ShelfLocationBadgeItem, action: MenuAction) => {
    if (action === "remove") {
      const question = location.isPrimary
        ? `เอาที่เก็บประจำ ${location.code} ออก? ถ้ามีที่เก็บเพิ่ม ระบบจะตั้งที่ล่าสุดเป็นที่เก็บประจำแทน`
        : `ยืนยันว่าที่ ${location.code} ไม่มีสินค้านี้แล้ว?`;
      if (!window.confirm(question)) return;
    }
    setFeedback(null);
    startTransition(async () => {
      const result = await changeShelfLocationAction({
        productId,
        change: { kind: action, locationId: location.id },
      });
      setOpenId(null);
      if (result.ok) {
        setFeedback({ tone: "success", text: result.message });
        router.refresh();
      } else {
        setFeedback({ tone: "error", text: result.error });
      }
    });
  };

  const openLocation = locations.find((location) => location.id === openId) ?? null;

  return (
    <span ref={containerRef} className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {locations.map((location) => (
        <button
          key={location.id}
          type="button"
          onClick={() => setOpenId((current) => (current === location.id ? null : location.id))}
          disabled={isPending}
          aria-haspopup="menu"
          aria-expanded={openId === location.id}
          title={shelfBadgeTitle(location)}
          className={cn(
            shelfBadgeClassName(location.isPrimary, size),
            "cursor-pointer hover:opacity-90 disabled:opacity-60",
            openId === location.id && "ring-2 ring-[#1e3a5f]/40 ring-offset-1 dark:ring-sky-400/50 dark:ring-offset-slate-950",
          )}
        >
          {formatShelfBadgeLabel(location)}
        </button>
      ))}
      {/* In-flow panel under the badges instead of a floating popover, so it never runs off a phone screen. */}
      {openLocation && (
        <span
          role="menu"
          className="mt-1 block basis-full rounded-lg border border-gray-200 bg-white p-1 shadow-sm dark:border-white/10 dark:bg-slate-900"
        >
          <span className="block px-3 pb-1 pt-2 text-xs text-gray-500 dark:text-slate-400">
            {openLocation.isPrimary ? "ที่เก็บประจำ" : "ที่เก็บเพิ่ม"} {openLocation.code}
            {openLocation.note ? ` · ${openLocation.note}` : ""}
          </span>
          <span className="grid gap-0.5 sm:grid-cols-3">
            <button type="button" role="menuitem" className={menuItemClassName} disabled={isPending} onClick={() => runAction(openLocation, "confirm")}>
              <CheckCircle2 size={15} className="shrink-0 text-emerald-600 dark:text-emerald-300" />
              ยืนยันว่าอยู่ที่นี่
            </button>
            {!openLocation.isPrimary && (
              <button type="button" role="menuitem" className={menuItemClassName} disabled={isPending} onClick={() => runAction(openLocation, "promote")}>
                <Star size={15} className="shrink-0 text-[#1e3a5f] dark:text-sky-300" />
                ตั้งเป็นที่เก็บประจำ
              </button>
            )}
            <button type="button" role="menuitem" className={menuItemClassName} disabled={isPending} onClick={() => runAction(openLocation, "remove")}>
              <PackageX size={15} className="shrink-0 text-rose-600 dark:text-rose-300" />
              {openLocation.isPrimary ? "เอาที่เก็บประจำออก" : "ที่นี่หมดแล้ว"}
            </button>
          </span>
        </span>
      )}
      {feedback && (
        <span
          role="status"
          className={cn(
            "basis-full text-xs",
            feedback.tone === "success" ? "text-emerald-700 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300",
          )}
        >
          {feedback.text}
        </span>
      )}
    </span>
  );
};

export default ShelfLocationBadgeMenu;
