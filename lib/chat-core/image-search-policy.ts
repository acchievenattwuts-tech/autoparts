import { isVehicleFreeChatCategory, isVehicleFreeChatPartType } from "@/lib/chat-core/product-spec-resolve";

export type ChatImageConfidence = "LOW" | "MEDIUM" | "HIGH";
export type ChatImageModelPartKind = "fitment" | "universal" | null;

export type ChatImageSearchPolicyDecision =
  | { action: "handoff_admin"; reason: "IMAGE_CONFIDENCE_NOT_HIGH" }
  | { action: "search_without_vehicle"; reason: "VEHICLE_FREE_CATALOG_POLICY" }
  | { action: "use_fitment_gate"; reason: "VEHICLE_REQUIRED_OR_UNKNOWN" };

/**
 * Decides whether a classified product image may bypass the vehicle gate.
 *
 * `modelPartKind` is accepted for diagnostics and golden coverage, but is not a
 * source of truth. Production samples include HIGH-confidence images where the
 * model called a radiator, belt, or evaporator case "universal". Only the
 * deterministic catalog policy may license a vehicle-free search.
 */
export function resolveChatImageSearchPolicy(input: {
  confidence: ChatImageConfidence;
  partType?: string | null;
  resolvedCategoryName?: string | null;
  modelPartKind?: ChatImageModelPartKind;
}): ChatImageSearchPolicyDecision {
  if (input.confidence !== "HIGH") {
    return { action: "handoff_admin", reason: "IMAGE_CONFIDENCE_NOT_HIGH" };
  }

  if (
    isVehicleFreeChatCategory(input.resolvedCategoryName) ||
    isVehicleFreeChatPartType(input.partType)
  ) {
    return { action: "search_without_vehicle", reason: "VEHICLE_FREE_CATALOG_POLICY" };
  }

  return { action: "use_fitment_gate", reason: "VEHICLE_REQUIRED_OR_UNKNOWN" };
}
