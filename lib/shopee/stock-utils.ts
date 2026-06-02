import { ShopeeSyncMode } from "@/lib/generated/prisma";

export type ShopeeStockReconciliationStatus =
  | "DISABLED"
  | "MONITOR_ONLY"
  | "NOT_PUSHED"
  | "IN_SYNC"
  | "NEEDS_PUSH"
  | "PUSH_FAILED";

export function calculateShopeeTargetStock(internalStock: number, buffer: number): number {
  const normalizedStock = Math.max(0, Math.floor(Number.isFinite(internalStock) ? internalStock : 0));
  const normalizedBuffer = Math.max(0, Math.floor(Number.isFinite(buffer) ? buffer : 0));
  return Math.max(0, normalizedStock - normalizedBuffer);
}

export function resolveShopeeStockStatus(input: {
  syncMode: ShopeeSyncMode;
  targetStock: number;
  lastPushedStock: number | null;
  lastError: string | null;
}): ShopeeStockReconciliationStatus {
  if (input.syncMode === ShopeeSyncMode.DISABLED) return "DISABLED";
  if (input.syncMode === ShopeeSyncMode.MONITOR_ONLY) return "MONITOR_ONLY";
  if (input.lastError) return "PUSH_FAILED";
  if (input.lastPushedStock == null) return "NOT_PUSHED";
  return input.lastPushedStock === input.targetStock ? "IN_SYNC" : "NEEDS_PUSH";
}
