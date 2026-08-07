import {
  extractChatProductVoltage,
  extractChatProductVoltages,
  type ChatProductVoltage,
} from "@/lib/chat-core/product-spec-resolve";

export type ChatProductFitmentEvidence = {
  carBrandName: string | null;
  carModelName: string | null;
  submodel: string | null;
  engineSize: string | null;
  note?: string | null;
};

export type ChatCompatibilityProduct = {
  id: string;
  name: string;
  fitments?: ChatProductFitmentEvidence[];
};

export type ChatVehicleConstraints = {
  side: "driver" | "passenger" | null;
  generation: string | null;
  engineSize: number | null;
  voltage: ChatProductVoltage | null;
};

export type ChatProductConflictReason =
  | "opposite_side"
  | "wrong_generation"
  | "wrong_engine"
  | "wrong_voltage";

export type ChatProductCompatibilityResult<T> = {
  products: T[];
  constraints: ChatVehicleConstraints;
  suppressed: Array<{ id: string; reasons: ChatProductConflictReason[] }>;
  verificationNote: string | null;
};

const normalizeText = (value?: string | null): string => (value ?? "").trim().toLowerCase();

const detectSide = (value?: string | null): ChatVehicleConstraints["side"] => {
  const text = normalizeText(value);
  if (!text) return null;
  const driver = /(?:ฝั่ง|ด้าน|ข้าง)\s*คน\s*ขับ|driver\s*(?:side)?/i.test(text);
  const passenger = /(?:ฝั่ง|ด้าน|ข้าง)\s*คน\s*นั่ง|passenger\s*(?:side)?/i.test(text);
  return driver === passenger ? null : driver ? "driver" : "passenger";
};

const extractGenerations = (value?: string | null): Set<string> => {
  const text = normalizeText(value);
  const generations = new Set<string>();
  // The non-alphanumeric left boundary is important: "MG3" is a real model and
  // must never be interpreted as the generic generation marker "G3".
  for (const match of text.matchAll(/(?:^|[^a-z0-9])(?:g|gen(?:eration)?|เจน)\s*-?\s*(\d+[a-z]?)(?=$|[^a-z0-9])/gi)) {
    if (match[1]) generations.add(match[1].toLowerCase());
  }
  return generations;
};

const extractEngineSizes = (value?: string | null): Set<number> => {
  const text = normalizeText(value);
  const sizes = new Set<number>();
  for (const match of text.matchAll(/(?:^|[^0-9])([1-9]\.[0-9])(?:\s*(?:l|liter|litre|ลิตร))?(?=$|[^0-9])/gi)) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed)) sizes.add(parsed);
  }
  for (const match of text.matchAll(/(?:^|[^0-9])([1-9][0-9]{2,3})\s*cc(?=$|[^a-z0-9])/gi)) {
    const parsed = Number(match[1]) / 1000;
    if (Number.isFinite(parsed)) sizes.add(parsed);
  }
  return sizes;
};

export function extractChatVehicleConstraints(text?: string | null): ChatVehicleConstraints {
  const generations = extractGenerations(text);
  const engineSizes = extractEngineSizes(text);
  return {
    side: detectSide(text),
    generation: generations.size === 1 ? Array.from(generations)[0] : null,
    engineSize: engineSizes.size === 1 ? Array.from(engineSizes)[0] : null,
    // Activates only when the customer explicitly names exactly one supported
    // voltage. No V in the query (or an ambiguous "12V/24V") means no guard.
    voltage: extractChatProductVoltage(text),
  };
}

const sameEngineSize = (left: number, right: number): boolean => Math.abs(left - right) < 0.01;

function relevantFitments(
  product: ChatCompatibilityProduct,
  carBrandName?: string | null,
  carModelName?: string | null,
): ChatProductFitmentEvidence[] {
  const fitments = product.fitments ?? [];
  if (!carBrandName && !carModelName) return fitments;
  const brand = normalizeText(carBrandName);
  const model = normalizeText(carModelName);
  return fitments.filter((fitment) => {
    const brandMatches = !brand || normalizeText(fitment.carBrandName) === brand;
    const modelMatches = !model || normalizeText(fitment.carModelName) === model;
    return brandMatches && modelMatches;
  });
}

function analyzeProductEvidence(
  product: ChatCompatibilityProduct,
  carBrandName?: string | null,
  carModelName?: string | null,
) {
  const fitments = relevantFitments(product, carBrandName, carModelName);
  const fitmentText = fitments
    .flatMap((fitment) => [fitment.submodel, fitment.engineSize, fitment.note])
    .filter(Boolean)
    .join(" ");
  const combinedText = `${product.name} ${fitmentText}`.trim();
  const fitmentEngineSizes = new Set(
    fitments.flatMap((fitment) => Array.from(extractEngineSizes(fitment.engineSize))),
  );
  return {
    side: detectSide(combinedText),
    generations: extractGenerations(combinedText),
    // Multi-fitment product names often mention an engine belonging to a different
    // vehicle on the same row. Once a relevant brand/model fitment exists, only
    // its structured engineSize is strong enough to declare a contradiction.
    engineSizes: fitments.length > 0 ? fitmentEngineSizes : extractEngineSizes(product.name),
    // Product.name is the strongest catalog presentation fact available today.
    // Aliases/descriptions are intentionally excluded because they may mention
    // comparison variants (or contain a bad manual alias) without describing the
    // actual SKU. Missing voltage is not a conflict; only an explicit opposite is.
    voltages: new Set(extractChatProductVoltages(product.name)),
  };
}

function buildVerificationNote(constraints: ChatVehicleConstraints, missing: string[]): string | null {
  if (missing.length === 0) return null;
  const vehicle = [
    constraints.generation ? `G${constraints.generation}` : null,
    constraints.side === "driver" ? "ฝั่งคนขับ" : constraints.side === "passenger" ? "ฝั่งคนนั่ง" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const vehicleText = vehicle ? `สำหรับ ${vehicle} ` : "";
  return `รายการที่แสดงเป็นรายการที่เป็นไปได้${vehicleText}เบื้องต้นนะคะ แต่ข้อมูลที่ผูกในระบบยังยืนยัน${missing.join(" และ ")}ได้ไม่ครบทุกชิ้น กรุณาเทียบรูปอะไหล่เดิม ปลั๊ก จุดยึด และเบอร์บนตัวอะไหล่ก่อนสั่งซื้อค่ะ`;
}

/**
 * Removes only candidates that explicitly contradict customer-supplied vehicle
 * details. Missing product metadata is not a conflict: the item stays visible as
 * a possible match, accompanied by a deterministic verification warning.
 */
export function filterChatProductsByVehicleCompatibility<T extends ChatCompatibilityProduct>(input: {
  products: T[];
  customerText?: string | null;
  carBrandName?: string | null;
  carModelName?: string | null;
}): ChatProductCompatibilityResult<T> {
  const constraints = extractChatVehicleConstraints(input.customerText);
  const kept: Array<{ product: T; evidence: ReturnType<typeof analyzeProductEvidence> }> = [];
  const suppressed: ChatProductCompatibilityResult<T>["suppressed"] = [];

  for (const product of input.products) {
    const evidence = analyzeProductEvidence(product, input.carBrandName, input.carModelName);
    const reasons: ChatProductConflictReason[] = [];
    if (constraints.side && evidence.side && constraints.side !== evidence.side) {
      reasons.push("opposite_side");
    }
    if (
      constraints.generation &&
      evidence.generations.size > 0 &&
      !evidence.generations.has(constraints.generation)
    ) {
      reasons.push("wrong_generation");
    }
    if (
      constraints.engineSize !== null &&
      evidence.engineSizes.size > 0 &&
      !Array.from(evidence.engineSizes).some((size) => sameEngineSize(size, constraints.engineSize as number))
    ) {
      reasons.push("wrong_engine");
    }
    if (
      constraints.voltage !== null &&
      evidence.voltages.size > 0 &&
      !evidence.voltages.has(constraints.voltage)
    ) {
      reasons.push("wrong_voltage");
    }

    if (reasons.length > 0) suppressed.push({ id: product.id, reasons });
    else kept.push({ product, evidence });
  }

  const missing: string[] = [];
  if (constraints.generation && kept.some(({ evidence }) => evidence.generations.size === 0)) {
    missing.push(`รุ่น G${constraints.generation}`);
  }
  if (constraints.side && kept.some(({ evidence }) => evidence.side === null)) {
    missing.push(constraints.side === "driver" ? "ตำแหน่งฝั่งคนขับ" : "ตำแหน่งฝั่งคนนั่ง");
  }
  if (constraints.engineSize !== null && kept.some(({ evidence }) => evidence.engineSizes.size === 0)) {
    missing.push(`เครื่อง ${constraints.engineSize.toFixed(1)}`);
  }
  if (constraints.voltage !== null && kept.some(({ evidence }) => evidence.voltages.size === 0)) {
    missing.push(`ระบบไฟ ${constraints.voltage}V`);
  }

  return {
    products: kept.map(({ product }) => product),
    constraints,
    suppressed,
    verificationNote: kept.length > 0 ? buildVerificationNote(constraints, missing) : null,
  };
}

export function appendChatCompatibilityNote(reply: string, note?: string | null): string {
  const trimmedReply = reply.trim();
  const trimmedNote = note?.trim();
  if (!trimmedNote || trimmedReply.includes(trimmedNote)) return trimmedReply;
  return `${trimmedReply}\n\n${trimmedNote}`;
}
