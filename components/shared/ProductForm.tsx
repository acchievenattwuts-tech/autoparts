"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Plus, X, Upload, Loader2, Trash2, ZoomIn, Sparkles } from "lucide-react";
import { createProduct, researchProductWithAi, updateProduct, uploadProductImage } from "@/app/admin/(protected)/products/actions";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";
import CropImageDialog from "@/components/shared/CropImageDialog";
import { toProductImageCdnPath } from "@/lib/product-image-url";
import { derivePricesFromWholesale } from "@/lib/product-pricing";
import {
  INVENTORY_TRACKING_NON_TRACKED,
  INVENTORY_TRACKING_TRACKED,
  type InventoryTrackingValue,
} from "@/lib/inventory-tracking";
import {
  createEmptyProductFitmentRow,
  type ProductFitmentFormRow,
  PRODUCT_FITMENT_SECTION_COPY,
  type ProductFitmentTypeValue,
} from "@/lib/product-fitment";
import type { ProductAiAliasKind, ProductAiFitmentDraft, ProductAiResearchDraft } from "@/lib/product-ai-research";

// ─── Alias kind catalog ───────────────────────────────────────────────────────

const ALIAS_KINDS = [
  "ALIAS",
  "OEM",
  "PART_NO",
  "CROSS_REF",
  "KEYWORD",
  "MISSPELL",
  "EN",
  "TH",
] as const;
export type AliasKindValue = (typeof ALIAS_KINDS)[number];

interface AliasKindMeta {
  label: string;
  placeholder: string;
  chipLight: string;
  chipDark: string;
}

const ALIAS_KIND_META: Record<AliasKindValue, AliasKindMeta> = {
  OEM:       { label: "OEM",         placeholder: "กรอกเบอร์ OEM แล้วกด Enter",            chipLight: "bg-blue-50 text-blue-700 border-blue-100",        chipDark: "dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30" },
  PART_NO:   { label: "Part No.",    placeholder: "กรอก Part Number แล้วกด Enter",         chipLight: "bg-indigo-50 text-indigo-700 border-indigo-100",  chipDark: "dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/30" },
  CROSS_REF: { label: "เบอร์เทียบ",   placeholder: "กรอกเบอร์เทียบยี่ห้ออื่น",                   chipLight: "bg-cyan-50 text-cyan-700 border-cyan-100",        chipDark: "dark:bg-cyan-500/10 dark:text-cyan-300 dark:border-cyan-500/30" },
  ALIAS:     { label: "คำเรียกอื่น",   placeholder: "กรอกชื่อเรียกอื่น เช่น คอมแอร์",            chipLight: "bg-slate-100 text-slate-700 border-slate-200",    chipDark: "dark:bg-slate-700/40 dark:text-slate-200 dark:border-slate-600" },
  KEYWORD:   { label: "Keyword",     placeholder: "กรอกคำค้นที่ลูกค้าใช้บ่อย",                    chipLight: "bg-emerald-50 text-emerald-700 border-emerald-100", chipDark: "dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30" },
  MISSPELL:  { label: "สะกดผิด",      placeholder: "กรอกคำสะกดผิดที่พบบ่อย",                     chipLight: "bg-amber-50 text-amber-700 border-amber-100",     chipDark: "dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30" },
  EN:        { label: "EN",          placeholder: "กรอกชื่ออังกฤษ เช่น compressor",            chipLight: "bg-purple-50 text-purple-700 border-purple-100",  chipDark: "dark:bg-purple-500/10 dark:text-purple-300 dark:border-purple-500/30" },
  TH:        { label: "TH",          placeholder: "กรอกชื่อไทย",                                chipLight: "bg-pink-50 text-pink-700 border-pink-100",        chipDark: "dark:bg-pink-500/10 dark:text-pink-300 dark:border-pink-500/30" },
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface CarModelOption { id: string; name: string }
interface CarBrandOption { id: string; name: string; carModels: CarModelOption[] }
interface CategoryOption { id: string; name: string }
interface PartsBrandOption { id: string; name: string }
interface SupplierOption { id: string; name: string }

interface UnitRow {
  name: string;
  scale: number;
  isBase: boolean;
}

interface AliasRow {
  alias: string;
  kind: AliasKindValue;
}

interface ProductImageRow {
  url: string;
  alt: string | null;
  sortOrder: number;
  isPrimary: boolean;
}

export type FitmentRow = ProductFitmentFormRow;

/** Serializable product data — all Decimal fields converted to number */
export interface ProductFormData {
  id:              string;
  code:            string;
  name:            string;
  description:     string | null;
  costPrice:       number;
  inventoryTracking: InventoryTrackingValue;
  isStorefrontVisible: boolean;
  salePrice:       number;
  retailPrice:     number;
  memberPrice:     number;
  minStock:        number;
  warrantyDays:    number;
  shelfLocation:   string | null;
  saleUnitName:    string | null;
  purchaseUnitName: string | null;
  reportUnitName:  string | null;
  imageUrl:             string | null;
  productImages?:       ProductImageRow[];
  categoryId:           string;
  brandId:              string | null;
  preferredSupplierId:  string | null;
  // Lot Control
  isLotControl:       boolean;
  requireExpiryDate:  boolean;
  lotIssueMethod:     string;
  allowExpiredIssue:  boolean;
  aliases:         AliasRow[];
  fitments:        FitmentRow[];
  compatibleFitments: FitmentRow[];
  units:           UnitRow[];
}

interface ProductFormProps {
  categories:  CategoryOption[];
  carBrands:   CarBrandOption[];
  partsBrands: PartsBrandOption[];
  suppliers:   SupplierOption[];
  product?:    ProductFormData;
  returnTo?:    string;
}

// ─── Shared styles (light + dark) ─────────────────────────────────────────────

const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm " +
  "bg-white text-gray-900 placeholder:text-gray-400 " +
  "dark:bg-slate-900 dark:border-white/10 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:ring-sky-500";

const labelCls =
  "block text-sm font-medium text-gray-700 mb-1.5 dark:text-slate-200";

const sectionCls =
  "bg-white rounded-xl shadow-sm border border-gray-100 p-5 sm:p-6 " +
  "dark:bg-slate-900/60 dark:border-white/10 dark:shadow-none";

const sectionHeadingCls =
  "font-kanit text-base sm:text-lg font-semibold text-[#1e3a5f] mb-5 pb-3 border-b border-gray-100 " +
  "dark:text-sky-200 dark:border-white/10";

const helpCls =
  "mt-1 text-xs text-gray-500 dark:text-slate-400";

// Minimum gap between two AI Research triggers from the same session (anti-spam).
const AI_RESEARCH_COOLDOWN_MS = 8_000;

// Feature flag — AI Research is disabled until the Gemini billing account is set up
// (Google Search grounding returns HTTP 429 on free-tier keys). Flip to `true` to
// re-enable the button once a paid-tier key is available. The server action is also
// gated, so leaving this on without billing simply shows the quota error.
const AI_RESEARCH_ENABLED = false;

const checkboxCls =
  "w-4 h-4 rounded border-gray-300 text-[#1e3a5f] focus:ring-[#1e3a5f] " +
  "dark:border-slate-500 dark:bg-slate-800 dark:focus:ring-sky-500";

// ─── Component ────────────────────────────────────────────────────────────────

const ProductForm = ({ categories, carBrands, partsBrands, suppliers, product, returnTo = "/admin/products" }: ProductFormProps) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const productNameRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const autoResize = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  useEffect(() => {
    if (descriptionRef.current) autoResize(descriptionRef.current);
  }, [autoResize]);

  // Image
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialImages =
    product?.productImages && product.productImages.length > 0
      ? product.productImages
      : product?.imageUrl
        ? [{ url: product.imageUrl, alt: product.name, sortOrder: 0, isPrimary: true }]
        : [];
  const [productImages, setProductImages] = useState<ProductImageRow[]>(initialImages);
  const [imageUrl, setImageUrl] = useState(productImages.find((image) => image.isPrimary)?.url ?? productImages[0]?.url ?? "");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [imageUploadCode, setImageUploadCode] = useState(product?.code ?? "");
  const [cropQueue, setCropQueue] = useState<File[]>([]);
  const [cropTotal, setCropTotal] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Aliases (with kind)
  const [aliases, setAliases] = useState<AliasRow[]>(
    product?.aliases.map((a) => ({ alias: a.alias, kind: (a.kind ?? "ALIAS") as AliasKindValue })) ?? []
  );
  const [aliasInput, setAliasInput] = useState("");
  // Active kind: "ALL" = แสดงทั้งหมด, otherwise filter
  const [activeKind, setActiveKind] = useState<AliasKindValue | "ALL">("OEM");

  // Cross-kind duplicate warning state
  interface CrossKindConflict {
    pendingKind: AliasKindValue;
    clearRows: AliasRow[];
    conflictRows: AliasRow[];
    conflicts: Array<{ alias: string; existingKinds: AliasKindValue[] }>;
  }
  const [crossKindConflict, setCrossKindConflict] = useState<CrossKindConflict | null>(null);

  // Fitments (compatible car models with year range / engine / submodel)
  const [fitments, setFitments] = useState<FitmentRow[]>(product?.fitments ?? []);
  const [compatibleFitments, setCompatibleFitments] = useState<FitmentRow[]>(
    product?.compatibleFitments ?? [],
  );

  // Flattened car model options (brand / model) for SearchableSelect
  const carModelOptions = useMemo<SelectOption[]>(() => {
    const opts: SelectOption[] = [];
    for (const brand of carBrands) {
      for (const model of brand.carModels) {
        opts.push({
          id: model.id,
          label: `${brand.name} / ${model.name}`,
          sublabel: brand.name,
        });
      }
    }
    return opts;
  }, [carBrands]);

  // ── Units ──────────────────────────────────────────────────────────────────
  const initUnits = (): UnitRow[] => {
    if (product?.units && product.units.length > 0) {
      return product.units
        .slice()
        .sort((a, b) => (b.isBase ? 1 : 0) - (a.isBase ? 1 : 0))
        .map((u) => ({ name: u.name, scale: Number(u.scale), isBase: u.isBase }));
    }
    return [{ name: "ชิ้น", scale: 1, isBase: true }];
  };

  const [units, setUnits] = useState<UnitRow[]>(initUnits);
  const baseUnit = units.find((u) => u.isBase) ?? units[0];

  const [categoryId, setCategoryId]                   = useState(product?.categoryId ?? "");
  const [brandId, setBrandId]                         = useState(product?.brandId ?? "");
  const [preferredSupplierId, setPreferredSupplierId] = useState(product?.preferredSupplierId ?? "");
  const [inventoryTracking, setInventoryTracking]     = useState<InventoryTrackingValue>(
    product?.inventoryTracking ?? INVENTORY_TRACKING_TRACKED,
  );
  const [isStorefrontVisible, setIsStorefrontVisible] = useState(product?.isStorefrontVisible ?? true);

  // Lot Control
  const isNonStock = inventoryTracking === INVENTORY_TRACKING_NON_TRACKED;
  const [isLotControl, setIsLotControl]           = useState(product?.isLotControl ?? false);
  const [requireExpiryDate, setRequireExpiryDate] = useState(product?.requireExpiryDate ?? false);
  const [allowExpiredIssue, setAllowExpiredIssue] = useState(product?.allowExpiredIssue ?? false);
  const [lotIssueMethod, setLotIssueMethod]       = useState(product?.lotIssueMethod ?? "FIFO");

  // ราคาขายเป็น controlled input เพื่อให้ระบบเติมราคาปลีก/สมาชิกอัตโนมัติจากราคาขายส่งได้
  // (ผู้ใช้ยังพิมพ์แก้ทับได้ — ค่าที่บันทึกคือค่าที่อยู่ในช่องกรอกจริง)
  const [salePriceInput, setSalePriceInput]     = useState(product ? String(Number(product.salePrice)) : "0");
  const [retailPriceInput, setRetailPriceInput] = useState(product ? String(Number(product.retailPrice)) : "0");
  const [memberPriceInput, setMemberPriceInput] = useState(product ? String(Number(product.memberPrice)) : "0");

  const handleSalePriceChange = (value: string) => {
    setSalePriceInput(value);
    const derived = derivePricesFromWholesale(Number(value));
    setRetailPriceInput(String(derived.retailPrice));
    setMemberPriceInput(String(derived.memberPrice));
  };

  const [saleUnitName, setSaleUnitName]         = useState(product?.saleUnitName ?? baseUnit.name);
  const [purchaseUnitName, setPurchaseUnitName] = useState(product?.purchaseUnitName ?? baseUnit.name);
  const [reportUnitName, setReportUnitName]     = useState(product?.reportUnitName ?? baseUnit.name);
  const [isAiResearching, setIsAiResearching] = useState(false);
  const [aiResearchError, setAiResearchError] = useState("");
  const [aiDraft, setAiDraft] = useState<ProductAiResearchDraft | null>(null);
  const [aiVerifiedFitmentText, setAiVerifiedFitmentText] = useState("");
  const [aiPossibleFitmentText, setAiPossibleFitmentText] = useState("");
  const [aiApplyNotices, setAiApplyNotices] = useState<string[]>([]);
  // Anti-spam: each AI Research call hits a paid Gemini + Google Search request, so
  // throttle re-triggers to at most once per AI_RESEARCH_COOLDOWN_MS per session.
  const lastAiResearchAtRef = useRef(0);

  // ── Counts per kind for chip badges ───────────────────────────────────────
  const kindCounts = useMemo(() => {
    const map: Record<AliasKindValue, number> = {
      ALIAS: 0, OEM: 0, PART_NO: 0, CROSS_REF: 0, KEYWORD: 0, MISSPELL: 0, EN: 0, TH: 0,
    };
    for (const a of aliases) map[a.kind] = (map[a.kind] ?? 0) + 1;
    return map;
  }, [aliases]);

  const visibleAliases = activeKind === "ALL"
    ? aliases
    : aliases.filter((a) => a.kind === activeKind);

  // ── Unit handlers ──────────────────────────────────────────────────────────
  const handleUnitNameChange = (index: number, name: string) => {
    const old = units[index].name;
    setUnits((prev) => prev.map((u, i) => (i === index ? { ...u, name } : u)));
    if (saleUnitName === old) setSaleUnitName(name);
    if (purchaseUnitName === old) setPurchaseUnitName(name);
    if (reportUnitName === old) setReportUnitName(name);
  };

  const handleUnitScaleChange = (index: number, val: number) => {
    setUnits((prev) => prev.map((u, i) => (i === index ? { ...u, scale: val } : u)));
  };

  const addUnit = () => {
    setUnits((prev) => [...prev, { name: "", scale: 1, isBase: false }]);
  };

  const removeUnit = (index: number) => {
    const removed = units[index].name;
    const baseName = units.find((u) => u.isBase)?.name ?? "ชิ้น";
    setUnits((prev) => prev.filter((_, i) => i !== index));
    if (saleUnitName === removed) setSaleUnitName(baseName);
    if (purchaseUnitName === removed) setPurchaseUnitName(baseName);
    if (reportUnitName === removed) setReportUnitName(baseName);
  };

  // ── Fitment handlers ───────────────────────────────────────────────────────
  const getFitmentState = (fitmentType: ProductFitmentTypeValue) =>
    fitmentType === "COMPATIBLE"
      ? [compatibleFitments, setCompatibleFitments] as const
      : [fitments, setFitments] as const;

  const addFitment = (fitmentType: ProductFitmentTypeValue) => {
    const [, setRows] = getFitmentState(fitmentType);
    setRows((prev) => [...prev, createEmptyProductFitmentRow()]);
  };

  const updateFitment = <K extends keyof FitmentRow>(
    fitmentType: ProductFitmentTypeValue,
    index: number,
    field: K,
    value: FitmentRow[K],
  ) => {
    const [, setRows] = getFitmentState(fitmentType);
    setRows((prev) => prev.map((f, i) => (i === index ? { ...f, [field]: value } : f)));
  };

  const removeFitment = (fitmentType: ProductFitmentTypeValue, index: number) => {
    const [, setRows] = getFitmentState(fitmentType);
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const parseYear = (raw: string): number | null => {
    if (!raw.trim()) return null;
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) return null;
    return n; // range validated on submit so intermediate values (e.g. "20", "200") don't clear the input
  };

  const parseOptStr = (raw: string): string | null => (raw.trim() === "" ? null : raw);

  const getCarModelLabel = (carModelId: string) =>
    carModelOptions.find((option) => option.id === carModelId)?.label ?? "";

  const formatFitmentInputText = (rows: FitmentRow[]) => rows
    .filter((row) => row.carModelId)
    .map((row) => {
      const years = row.yearStart || row.yearEnd ? `${row.yearStart ?? ""}-${row.yearEnd ?? ""}` : "";
      return [getCarModelLabel(row.carModelId), years, row.engineSize ?? "", row.engineCode ?? "", row.submodel ?? "", row.note ?? ""]
        .filter(Boolean)
        .join(" | ");
    })
    .join("\n");

  const formatAiFitmentLine = (fitment: ProductAiFitmentDraft) => {
    const years = fitment.yearStart || fitment.yearEnd ? `${fitment.yearStart ?? ""}-${fitment.yearEnd ?? ""}` : "";
    return [[fitment.make, fitment.model].filter(Boolean).join(" / "), years, fitment.engineSize, fitment.engineCode, fitment.submodel, fitment.note]
      .filter(Boolean)
      .join(" | ");
  };

  const findCarModelIdFromText = (makeModelText: string) => {
    const normalized = makeModelText.toLowerCase().replace(/\s+/g, " ").trim();
    if (!normalized) return "";
    const exact = carModelOptions.find((option) => option.label.toLowerCase() === normalized);
    if (exact) return exact.id;
    const parts = normalized.split("/").map((part) => part.trim()).filter(Boolean);
    return carModelOptions.find((option) => {
      const label = option.label.toLowerCase();
      return parts.length > 0 ? parts.every((part) => label.includes(part)) : label.includes(normalized);
    })?.id ?? "";
  };

  const parseAiFitmentText = (text: string): FitmentRow[] => text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [makeModel = "", years = "", engineSize = "", engineCode = "", submodel = "", note = ""] = line
        .split("|")
        .map((part) => part.trim());
      const [yearStartRaw = "", yearEndRaw = ""] = years.split("-").map((part) => part.trim());
      return {
        carModelId: findCarModelIdFromText(makeModel),
        yearStart: parseYear(yearStartRaw),
        yearEnd: parseYear(yearEndRaw),
        engineSize: parseOptStr(engineSize),
        engineCode: parseOptStr(engineCode),
        submodel: parseOptStr(submodel),
        note: parseOptStr(note),
      };
    })
    .filter((row) => row.carModelId);

  const updateAiDraftAlias = (kind: ProductAiAliasKind, csv: string) => {
    setAiDraft((current) => current
      ? { ...current, aliases: { ...current.aliases, [kind]: { ...current.aliases[kind], csv } } }
      : current);
  };

  const updateAiDraftText = <K extends "productName" | "category" | "partsBrand">(field: K, value: string) => {
    setAiDraft((current) => current
      ? { ...current, [field]: { ...current[field], value } }
      : current);
  };

  const handleAiResearch = async () => {
    if (isAiResearching) return;
    const elapsed = Date.now() - lastAiResearchAtRef.current;
    if (elapsed < AI_RESEARCH_COOLDOWN_MS) {
      const waitSec = Math.ceil((AI_RESEARCH_COOLDOWN_MS - elapsed) / 1000);
      setAiResearchError(`กรุณารออีก ${waitSec} วินาทีก่อนค้นหาด้วย AI อีกครั้ง`);
      return;
    }
    lastAiResearchAtRef.current = Date.now();
    setAiResearchError("");
    setIsAiResearching(true);
    try {
      const result = await researchProductWithAi({
        productName: productNameRef.current?.value ?? product?.name ?? "",
        partsBrandName: partsBrands.find((brand) => brand.id === brandId)?.name ?? "",
        categoryName: categories.find((category) => category.id === categoryId)?.name ?? "",
        fitmentText: formatFitmentInputText(fitments),
      }, product ? "update" : "create");

      if (result.error || !result.draft) {
        setAiResearchError(result.error ?? "AI Research ไม่ได้ส่งข้อมูลกลับมา");
        return;
      }

      setAiDraft(result.draft);
      setAiVerifiedFitmentText(result.draft.verifiedFitments.map(formatAiFitmentLine).join("\n"));
      setAiPossibleFitmentText(result.draft.possibleInterchange.map(formatAiFitmentLine).join("\n"));
    } catch {
      // The server action wraps its own failures, but the RSC transport itself can
      // still reject (network drop / function timeout) — surface a clear message
      // instead of leaving an unhandled rejection with no feedback.
      setAiResearchError("เชื่อมต่อ AI Research ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsAiResearching(false);
    }
  };

  const applyAiDraft = () => {
    if (!aiDraft) return;
    if (productNameRef.current && aiDraft.productName.value.trim()) {
      productNameRef.current.value = aiDraft.productName.value.trim();
    }
    if (descriptionRef.current && aiDraft.descriptionCopyBox.trim()) {
      descriptionRef.current.value = aiDraft.descriptionCopyBox.trim();
      autoResize(descriptionRef.current);
    }
    const notices: string[] = [];
    const categoryValue = aiDraft.category.value.trim();
    const matchedCategory = categories.find((category) => category.name.trim() === categoryValue);
    if (matchedCategory) setCategoryId(matchedCategory.id);
    else if (categoryValue) notices.push(`ไม่พบหมวดหมู่ “${categoryValue}” ในระบบ กรุณาเลือกหมวดหมู่เอง`);
    const brandValue = aiDraft.partsBrand.value.trim();
    const matchedBrand = partsBrands.find((brand) => brand.name.trim().toLowerCase() === brandValue.toLowerCase());
    if (matchedBrand) setBrandId(matchedBrand.id);
    else if (brandValue) notices.push(`ไม่พบแบรนด์อะไหล่ “${brandValue}” ในระบบ กรุณาเลือก/เพิ่มแบรนด์เอง`);
    setAliases((prev) => {
      const existing = new Set(prev.map((item) => `${item.kind}::${item.alias}`));
      const next = [...prev];
      for (const kind of ALIAS_KINDS) {
        const values = aiDraft.aliases[kind].csv.split(/[,\n\t]+/).map((value) => value.trim()).filter(Boolean);
        for (const value of values) {
          const key = `${kind}::${value}`;
          if (existing.has(key)) continue;
          existing.add(key);
          next.push({ alias: value, kind });
        }
      }
      return next;
    });
    const countFitmentLines = (text: string) => text.split("\n").map((line) => line.trim()).filter(Boolean).length;
    const directRows = parseAiFitmentText(aiVerifiedFitmentText);
    const compatibleRows = parseAiFitmentText(aiPossibleFitmentText);
    const droppedVerified = countFitmentLines(aiVerifiedFitmentText) - directRows.length;
    const droppedPossible = countFitmentLines(aiPossibleFitmentText) - compatibleRows.length;
    if (droppedVerified > 0) notices.push(`รุ่นรถ VERIFIED ${droppedVerified} รายการจับคู่กับรุ่นรถในระบบไม่ได้ จึงไม่ถูกเพิ่ม กรุณาเพิ่มเอง`);
    if (droppedPossible > 0) notices.push(`รุ่นรถ POSSIBLE ${droppedPossible} รายการจับคู่กับรุ่นรถในระบบไม่ได้ จึงไม่ถูกเพิ่ม กรุณาเพิ่มเอง`);
    if (directRows.length > 0) setFitments((prev) => [...prev, ...directRows]);
    if (compatibleRows.length > 0) setCompatibleFitments((prev) => [...prev, ...compatibleRows]);
    setAiApplyNotices(notices);
    setAiDraft(null);
  };

  // ── Image upload ───────────────────────────────────────────────────────────
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploadError("");
    setCropQueue(files);
    setCropTotal(files.length);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const appendUploadedImage = (url: string, fallbackAlt: string) => {
    setProductImages((prev) => {
      const next = [
        ...prev,
        {
          url,
          alt: fallbackAlt,
          sortOrder: prev.length,
          isPrimary: prev.length === 0,
        },
      ];
      const primaryUrl = next.find((image) => image.isPrimary)?.url ?? next[0]?.url ?? "";
      setImageUrl(primaryUrl);
      return next;
    });
  };

  const handleCropConfirm = async (croppedFile: File) => {
    setIsUploading(true);
    setUploadError("");
    try {
      const fd = new FormData();
      fd.append("file", croppedFile);
      const productCode = product?.code ?? imageUploadCode;
      if (productCode) {
        fd.set("productCode", productCode);
      }
      const result = await uploadProductImage(fd);
      if (result.error) {
        setUploadError(result.error);
        setCropQueue([]);
        setCropTotal(0);
        return;
      }
      if (result.uploadCode && !product) {
        setImageUploadCode(result.uploadCode);
      }
      if (result.url) {
        appendUploadedImage(result.url, croppedFile.name.replace(/\.[^.]+$/, ""));
      }
      setCropQueue((prev) => {
        const next = prev.slice(1);
        if (next.length === 0) setCropTotal(0);
        return next;
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleCropCancel = () => {
    setCropQueue((prev) => {
      const next = prev.slice(1);
      if (next.length === 0) setCropTotal(0);
      return next;
    });
  };

  const setPrimaryImage = (url: string) => {
    setProductImages((prev) => prev.map((image) => ({ ...image, isPrimary: image.url === url })));
    setImageUrl(url);
  };

  const removeProductImage = (url: string) => {
    setProductImages((prev) => {
      const next = prev
        .filter((image) => image.url !== url)
        .map((image, index) => ({ ...image, sortOrder: index }));
      if (next.length > 0 && !next.some((image) => image.isPrimary)) {
        next[0] = { ...next[0], isPrimary: true };
      }
      setImageUrl(next.find((image) => image.isPrimary)?.url ?? next[0]?.url ?? "");
      return next;
    });
  };

  // ── Aliases ────────────────────────────────────────────────────────────────
  // Split on comma, newline, or tab so users can paste multi-item lists from
  // Excel / Notepad. Trim each segment, drop empties, dedupe within the paste,
  // and dedupe against existing aliases of the same kind.
  // If the same alias value already exists under a DIFFERENT kind, show a
  // warning and ask the user to confirm before adding.
  const addAlias = () => {
    const targetKind: AliasKindValue = activeKind === "ALL" ? "ALIAS" : activeKind;
    const segments = aliasInput
      .split(/[,\n\t]+/)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
    if (segments.length === 0) {
      setAliasInput("");
      return;
    }

    const sameKindKeys = new Set(
      aliases.filter((a) => a.kind === targetKind).map((a) => a.alias),
    );

    // Build map: alias value → kinds it already appears in (excluding targetKind)
    const crossKindMap = new Map<string, AliasKindValue[]>();
    for (const a of aliases) {
      if (a.kind !== targetKind) {
        if (!crossKindMap.has(a.alias)) crossKindMap.set(a.alias, []);
        crossKindMap.get(a.alias)!.push(a.kind);
      }
    }

    const clearRows: AliasRow[] = [];
    const conflictRows: AliasRow[] = [];
    const conflicts: Array<{ alias: string; existingKinds: AliasKindValue[] }> = [];
    const seenInBatch = new Set<string>();

    for (const segment of segments) {
      if (sameKindKeys.has(segment) || seenInBatch.has(segment)) continue;
      seenInBatch.add(segment);
      if (crossKindMap.has(segment)) {
        conflictRows.push({ alias: segment, kind: targetKind });
        conflicts.push({ alias: segment, existingKinds: crossKindMap.get(segment)! });
      } else {
        clearRows.push({ alias: segment, kind: targetKind });
      }
    }

    if (conflicts.length > 0) {
      setCrossKindConflict({ pendingKind: targetKind, clearRows, conflictRows, conflicts });
      return;
    }

    if (clearRows.length > 0) {
      setAliases((prev) => [...prev, ...clearRows]);
    }
    setAliasInput("");
  };

  const confirmCrossKindAdd = () => {
    if (!crossKindConflict) return;
    const { clearRows, conflictRows } = crossKindConflict;
    setAliases((prev) => [...prev, ...clearRows, ...conflictRows]);
    setCrossKindConflict(null);
    setAliasInput("");
  };

  const cancelCrossKindAdd = () => {
    setCrossKindConflict(null);
  };

  const removeAlias = (alias: string, kind: AliasKindValue) =>
    setAliases((prev) => prev.filter((a) => !(a.alias === alias && a.kind === kind)));

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    for (const u of units) {
      if (!u.name.trim()) {
        setError("ชื่อหน่วยนับต้องไม่ว่าง");
        return;
      }
    }
    const unitNames = units.map((u) => u.name.trim());
    if (new Set(unitNames).size !== unitNames.length) {
      setError("ชื่อหน่วยนับต้องไม่ซ้ำกัน");
      return;
    }

    const formEl = e.currentTarget;
    const formData = new FormData(formEl);
    formData.set("categoryId", categoryId);
    formData.set("brandId", brandId);
    formData.set("preferredSupplierId", preferredSupplierId);
    formData.set("inventoryTracking", inventoryTracking);
    formData.set("isStorefrontVisible", String(isStorefrontVisible));
    formData.set("imageUrl", imageUrl);
    formData.set("imageUploadCode", imageUploadCode);
    formData.set("productImages", JSON.stringify(productImages.map((image, index) => ({ ...image, sortOrder: index }))));
    formData.set("isLotControl", String(isNonStock ? false : isLotControl));
    formData.set("requireExpiryDate", String(isNonStock ? false : requireExpiryDate));
    formData.set("allowExpiredIssue", String(isNonStock ? false : allowExpiredIssue));
    formData.set("lotIssueMethod", lotIssueMethod);
    // Drop fitment rows with no carModel selected (incomplete)
    const cleanFitments = fitments.filter((f) => f.carModelId);
    const cleanCompatibleFitments = compatibleFitments.filter((f) => f.carModelId);
    const allFitments = [...cleanFitments, ...cleanCompatibleFitments];
    for (const f of allFitments) {
      if (f.yearStart !== null && (f.yearStart < 1900 || f.yearStart > 2200)) {
        setError("ปีเริ่มต้นต้องอยู่ระหว่าง ค.ศ. 1900–2200");
        return;
      }
      if (f.yearEnd !== null && (f.yearEnd < 1900 || f.yearEnd > 2200)) {
        setError("ปีจบต้องอยู่ระหว่าง ค.ศ. 1900–2200");
        return;
      }
      if (f.yearStart !== null && f.yearEnd !== null && f.yearStart > f.yearEnd) {
        setError("ปีเริ่มต้องไม่มากกว่าปีจบในรายการรุ่นรถ");
        return;
      }
    }
    formData.set("aliases", JSON.stringify(aliases));
    formData.set("fitments", JSON.stringify(cleanFitments));
    formData.set("compatibleFitments", JSON.stringify(cleanCompatibleFitments));
    formData.set("units", JSON.stringify(units));
    formData.set("saleUnitName", saleUnitName);
    formData.set("purchaseUnitName", purchaseUnitName);
    formData.set("reportUnitName", reportUnitName);

    startTransition(async () => {
      const result = product
        ? await updateProduct(product.id, formData)
        : await createProduct(formData);

      if (result.error) setError(result.error);
      else router.push(returnTo);
    });
  };

  const unitNameOptions = units.map((u) => u.name).filter((n) => n.trim() !== "");

  // ── Chip styling helpers ───────────────────────────────────────────────────
  const renderChipFilter = (kind: AliasKindValue | "ALL", label: string, count?: number) => {
    const isActive = activeKind === kind;
    return (
      <button
        key={kind}
        type="button"
        onClick={() => setActiveKind(kind)}
        className={
          "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium border transition-colors " +
          (isActive
            ? "bg-[#1e3a5f] text-white border-[#1e3a5f] dark:bg-sky-500 dark:border-sky-500"
            : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100 " +
              "dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-700")
        }
      >
        <span>{label}</span>
        {typeof count === "number" && count > 0 && (
          <span
            className={
              "inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-semibold px-1 " +
              (isActive
                ? "bg-white/20 text-white"
                : "bg-gray-200 text-gray-700 dark:bg-slate-700 dark:text-slate-200")
            }
          >
            {count}
          </span>
        )}
      </button>
    );
  };

  const renderFitmentSection = (
    fitmentType: ProductFitmentTypeValue,
    rows: FitmentRow[],
  ) => {
    const copy = PRODUCT_FITMENT_SECTION_COPY[fitmentType];

    return (
      <div className={sectionCls}>
        <div className="flex items-center justify-between mb-3 pb-3 border-b border-gray-100 dark:border-white/10">
          <h2 className="font-kanit text-base sm:text-lg font-semibold text-[#1e3a5f] dark:text-sky-200">
            {copy.adminTitle}
          </h2>
          <span className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">
            {rows.length} รายการ
          </span>
        </div>

        <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">
          {copy.adminDescription}
        </p>

        {carModelOptions.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-slate-500">ยังไม่มีข้อมูลรุ่นรถในระบบ</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-slate-500 mb-4">{copy.adminEmptyState}</p>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-white/10 text-left">
                    <th className="py-2 pr-3 font-medium text-gray-500 dark:text-slate-400 min-w-[200px]">รุ่นรถ <span className="text-red-500">*</span></th>
                    <th className="py-2 pr-3 font-medium text-gray-500 dark:text-slate-400 min-w-[120px]">โฉม</th>
                    <th className="py-2 pr-3 font-medium text-gray-500 dark:text-slate-400 w-24">ปีเริ่ม</th>
                    <th className="py-2 pr-3 font-medium text-gray-500 dark:text-slate-400 w-24">ปีจบ</th>
                    <th className="py-2 pr-3 font-medium text-gray-500 dark:text-slate-400 w-32">รหัสเครื่อง</th>
                    <th className="py-2 pr-3 font-medium text-gray-500 dark:text-slate-400 w-24">CC</th>
                    <th className="py-2 pr-3 font-medium text-gray-500 dark:text-slate-400 min-w-[140px]">โน้ต</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((f, i) => (
                    <tr key={`${fitmentType}-${i}`} className="border-b border-gray-50 dark:border-white/5 align-top">
                      <td className="py-2 pr-3">
                        <SearchableSelect
                          options={carModelOptions}
                          value={f.carModelId}
                          onChange={(id) => updateFitment(fitmentType, i, "carModelId", id)}
                          placeholder="เลือกยี่ห้อ / รุ่น"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="text"
                          value={f.submodel ?? ""}
                          onChange={(e) => updateFitment(fitmentType, i, "submodel", parseOptStr(e.target.value))}
                          placeholder="เช่น Gen 3"
                          className={`${inputCls} py-1.5`}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="number"
                          value={f.yearStart ?? ""}
                          onChange={(e) => updateFitment(fitmentType, i, "yearStart", parseYear(e.target.value))}
                          placeholder="2007"
                          min={1900}
                          max={2200}
                          className={`${inputCls} py-1.5`}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="number"
                          value={f.yearEnd ?? ""}
                          onChange={(e) => updateFitment(fitmentType, i, "yearEnd", parseYear(e.target.value))}
                          placeholder="2013"
                          min={1900}
                          max={2200}
                          className={`${inputCls} py-1.5`}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="text"
                          value={f.engineCode ?? ""}
                          onChange={(e) => updateFitment(fitmentType, i, "engineCode", parseOptStr(e.target.value))}
                          placeholder="2NZ-FE"
                          className={`${inputCls} py-1.5`}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="text"
                          value={f.engineSize ?? ""}
                          onChange={(e) => updateFitment(fitmentType, i, "engineSize", parseOptStr(e.target.value))}
                          placeholder="1.5L"
                          className={`${inputCls} py-1.5`}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="text"
                          value={f.note ?? ""}
                          onChange={(e) => updateFitment(fitmentType, i, "note", parseOptStr(e.target.value))}
                          placeholder="หมายเหตุ"
                          className={`${inputCls} py-1.5`}
                        />
                      </td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          onClick={() => removeFitment(fitmentType, i)}
                          className="text-red-400 hover:text-red-600 transition-colors dark:text-red-400 dark:hover:text-red-300"
                          title="ลบรายการนี้"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="md:hidden space-y-3">
              {rows.map((f, i) => (
                <div key={`${fitmentType}-${i}`} className="rounded-lg border border-gray-200 dark:border-white/10 p-3 space-y-2.5 bg-gray-50/40 dark:bg-slate-800/30">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-medium text-gray-500 dark:text-slate-400">#{i + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeFitment(fitmentType, i)}
                      className="text-red-400 hover:text-red-600 transition-colors dark:text-red-400 dark:hover:text-red-300"
                      aria-label="ลบ"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1 dark:text-slate-300">รุ่นรถ <span className="text-red-500">*</span></label>
                    <SearchableSelect
                      options={carModelOptions}
                      value={f.carModelId}
                      onChange={(id) => updateFitment(fitmentType, i, "carModelId", id)}
                      placeholder="เลือกยี่ห้อ / รุ่น"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1 dark:text-slate-300">โฉม</label>
                      <input
                        type="text"
                        value={f.submodel ?? ""}
                        onChange={(e) => updateFitment(fitmentType, i, "submodel", parseOptStr(e.target.value))}
                        placeholder="Gen 3"
                        className={`${inputCls} py-1.5`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1 dark:text-slate-300">รหัสเครื่อง</label>
                      <input
                        type="text"
                        value={f.engineCode ?? ""}
                        onChange={(e) => updateFitment(fitmentType, i, "engineCode", parseOptStr(e.target.value))}
                        placeholder="2NZ-FE"
                        className={`${inputCls} py-1.5`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1 dark:text-slate-300">ปีเริ่ม</label>
                      <input
                        type="number"
                        value={f.yearStart ?? ""}
                        onChange={(e) => updateFitment(fitmentType, i, "yearStart", parseYear(e.target.value))}
                        placeholder="2007"
                        min={1900}
                        max={2200}
                        className={`${inputCls} py-1.5`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1 dark:text-slate-300">ปีจบ</label>
                      <input
                        type="number"
                        value={f.yearEnd ?? ""}
                        onChange={(e) => updateFitment(fitmentType, i, "yearEnd", parseYear(e.target.value))}
                        placeholder="2013"
                        min={1900}
                        max={2200}
                        className={`${inputCls} py-1.5`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1 dark:text-slate-300">CC</label>
                      <input
                        type="text"
                        value={f.engineSize ?? ""}
                        onChange={(e) => updateFitment(fitmentType, i, "engineSize", parseOptStr(e.target.value))}
                        placeholder="1.5L"
                        className={`${inputCls} py-1.5`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1 dark:text-slate-300">โน้ต</label>
                      <input
                        type="text"
                        value={f.note ?? ""}
                        onChange={(e) => updateFitment(fitmentType, i, "note", parseOptStr(e.target.value))}
                        placeholder="หมายเหตุ"
                        className={`${inputCls} py-1.5`}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {carModelOptions.length > 0 && (
          <button
            type="button"
            onClick={() => addFitment(fitmentType)}
            className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-gray-300 hover:border-[#1e3a5f] text-gray-500 hover:text-[#1e3a5f] text-sm rounded-lg transition-colors dark:border-slate-600 dark:hover:border-sky-400 dark:text-slate-300 dark:hover:text-sky-300"
          >
            <Plus size={14} />
            {copy.adminAddLabel}
          </button>
        )}
      </div>
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">

      {/* ── 1. ข้อมูลพื้นฐาน ─────────────────────────────────────────────────── */}
      <div className={sectionCls}>
        <h2 className={sectionHeadingCls}>ข้อมูลพื้นฐาน</h2>
        {aiApplyNotices.length > 0 && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">ข้อมูลบางส่วนจาก AI ยังต้องกรอกเอง</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {aiApplyNotices.map((notice, index) => <li key={`ai-notice-${index}`}>{notice}</li>)}
                </ul>
              </div>
              <button type="button" onClick={() => setAiApplyNotices([])} className="rounded-lg p-1 text-amber-500 hover:bg-amber-100 hover:text-amber-700 dark:hover:bg-amber-500/20" aria-label="ปิดข้อความ">
                <X size={16} />
              </button>
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
          {product && (
            <div>
              <label className={labelCls}>รหัสสินค้า</label>
              <div className="inline-flex items-center px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-mono text-[#1e3a5f] font-medium dark:bg-slate-800 dark:border-white/10 dark:text-sky-200">
                {product.code}
              </div>
            </div>
          )}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200">ชื่อสินค้า <span className="text-red-500">*</span></label>
              {AI_RESEARCH_ENABLED && (
                <button
                  type="button"
                  onClick={handleAiResearch}
                  disabled={isAiResearching}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 transition-colors hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200 dark:hover:bg-sky-500/20"
                >
                  {isAiResearching ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  AI Research
                </button>
              )}
            </div>
            <input ref={productNameRef} type="text" name="name" defaultValue={product?.name ?? ""} required
              placeholder="เช่น คอมเพรสเซอร์แอร์ Toyota" className={inputCls} />
            {aiResearchError && <p className="mt-1 text-xs text-red-500 dark:text-red-300">{aiResearchError}</p>}
          </div>
          <div>
            <label className={labelCls}>หมวดหมู่ <span className="text-red-500">*</span></label>
            <SearchableSelect
              options={categories.map((c): SelectOption => ({ id: c.id, label: c.name }))}
              value={categoryId}
              onChange={setCategoryId}
              placeholder="โปรดระบุหมวดหมู่"
            />
          </div>
          <div>
            <label className={labelCls}>แบรนด์อะไหล่</label>
            <SearchableSelect
              options={[
                { id: "", label: "-- ไม่ระบุแบรนด์ --" },
                ...partsBrands.map((b): SelectOption => ({ id: b.id, label: b.name })),
              ]}
              value={brandId}
              onChange={setBrandId}
              placeholder="-- ไม่ระบุแบรนด์ --"
            />
          </div>
          <div>
            <label className={labelCls}>ผู้จำหน่ายหลัก (สำหรับเคลม)</label>
            <SearchableSelect
              options={[
                { id: "", label: "-- ไม่ระบุ --" },
                ...suppliers.map((s): SelectOption => ({ id: s.id, label: s.name })),
              ]}
              value={preferredSupplierId}
              onChange={setPreferredSupplierId}
              placeholder="-- ไม่ระบุผู้จำหน่าย --"
            />
          </div>
          <div>
            <label className={labelCls}>ตำแหน่ง Shelf</label>
            <input type="text" name="shelfLocation" defaultValue={product?.shelfLocation ?? ""}
              placeholder="เช่น A-01" className={inputCls} />
          </div>
        </div>
        <div className="mt-5">
          <label className={labelCls}>คำอธิบาย</label>
          <textarea
            ref={descriptionRef}
            name="description"
            defaultValue={product?.description ?? ""}
            rows={3}
            placeholder="คำอธิบายสินค้าเพิ่มเติม..."
            className={`${inputCls} resize-none overflow-hidden`}
            onInput={(e) => autoResize(e.currentTarget)}
          />
        </div>
      </div>

      {/* ── 2. รหัสค้นหา / OEM / Part No. / Keyword ────────────────────────── */}
      <div className={sectionCls}>
        <h2 className={sectionHeadingCls}>รหัสค้นหา / OEM / Part No. / คำพ้อง</h2>

        <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">
          ค่าเหล่านี้ใช้ค้นหาทั้งฝั่งลูกค้าและฝั่งแอดมิน — เลือก tab เพื่อสลับประเภทแล้วเพิ่มรายการเข้าไป
        </p>

        {/* Filter chips */}
        <div className="flex flex-wrap gap-2 mb-4">
          {renderChipFilter("ALL", "ทั้งหมด", aliases.length)}
          {ALIAS_KINDS.map((k) =>
            renderChipFilter(k, ALIAS_KIND_META[k].label, kindCounts[k])
          )}
        </div>

        {/* Input row */}
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-4">
          <input
            type="text"
            value={aliasInput}
            onChange={(e) => setAliasInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAlias(); } }}
            placeholder={activeKind === "ALL" ? "เลือก tab แล้วกรอกรายการเพิ่ม" : ALIAS_KIND_META[activeKind].placeholder}
            className={`flex-1 ${inputCls}`}
          />
          <button
            type="button"
            onClick={addAlias}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-[#1e3a5f] hover:bg-[#163055] text-white text-sm font-medium rounded-lg transition-colors dark:bg-sky-600 dark:hover:bg-sky-500"
          >
            <Plus size={14} />เพิ่ม
          </button>
        </div>

        {/* Cross-kind duplicate warning */}
        {crossKindConflict && (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-500/10">
            <p className="mb-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
              พบค่าซ้ำข้ามประเภท — ต้องการเพิ่มหรือไม่?
            </p>
            <ul className="mb-3 space-y-1">
              {crossKindConflict.conflicts.map(({ alias, existingKinds }) => (
                <li key={alias} className="text-sm text-amber-700 dark:text-amber-300">
                  <span className="font-medium">&quot;{alias}&quot;</span>
                  {" "}มีอยู่แล้วใน{" "}
                  <span className="font-medium">
                    {existingKinds.map((k) => ALIAS_KIND_META[k].label).join(", ")}
                  </span>
                  {" "}— ต้องการเพิ่มเป็น{" "}
                  <span className="font-medium">{ALIAS_KIND_META[crossKindConflict.pendingKind].label}</span>
                  {" "}ด้วยหรือไม่?
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={confirmCrossKindAdd}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400"
              >
                อนุญาต — เพิ่มทั้งหมด
              </button>
              <button
                type="button"
                onClick={cancelCrossKindAdd}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-4 py-1.5 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-50 dark:border-amber-500/40 dark:bg-transparent dark:text-amber-300 dark:hover:bg-amber-500/10"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        )}

        {/* Chip list (filtered) */}
        {visibleAliases.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {visibleAliases.map((a) => {
              const meta = ALIAS_KIND_META[a.kind];
              return (
                <span
                  key={`${a.kind}::${a.alias}`}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 text-sm rounded-full border ${meta.chipLight} ${meta.chipDark}`}
                >
                  {activeKind === "ALL" && (
                    <span className="text-[10px] uppercase tracking-wide opacity-70">
                      {meta.label}
                    </span>
                  )}
                  {a.alias}
                  <button
                    type="button"
                    onClick={() => removeAlias(a.alias, a.kind)}
                    className="opacity-60 hover:opacity-100 transition-opacity"
                    aria-label="ลบ"
                  >
                    <X size={12} />
                  </button>
                </span>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-400 dark:text-slate-500">
            {activeKind === "ALL"
              ? "ยังไม่มีรายการ"
              : `ยังไม่มี ${ALIAS_KIND_META[activeKind].label}`}
          </p>
        )}
      </div>

      {/* ── 3. ความเข้ากันได้กับรถยนต์ (Fitment) ──────────────────────────── */}
      <div className={sectionCls}>
        <div className="flex items-center justify-between mb-3 pb-3 border-b border-gray-100 dark:border-white/10">
          <h2 className="font-kanit text-base sm:text-lg font-semibold text-[#1e3a5f] dark:text-sky-200">
            ความเข้ากันได้กับรถยนต์
          </h2>
          <span className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">
            {fitments.length} รายการ
          </span>
        </div>

        <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">
          ระบุรุ่นรถ พร้อมโฉม/ปีเริ่ม/ปีจบ/รหัสเครื่อง — ใช้ค้นหาแบบละเอียดเช่น &quot;วีออส 2010&quot;
        </p>

        {carModelOptions.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-slate-500">ยังไม่มีข้อมูลรุ่นรถในระบบ</p>
        ) : fitments.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-slate-500 mb-4">ยังไม่มีรายการ กดปุ่มด้านล่างเพื่อเพิ่ม</p>
        ) : (
          <>
            {/* Desktop / tablet: table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-white/10 text-left">
                    <th className="py-2 pr-3 font-medium text-gray-500 dark:text-slate-400 min-w-[200px]">รุ่นรถ <span className="text-red-500">*</span></th>
                    <th className="py-2 pr-3 font-medium text-gray-500 dark:text-slate-400 min-w-[120px]">โฉม</th>
                    <th className="py-2 pr-3 font-medium text-gray-500 dark:text-slate-400 w-24">ปีเริ่ม</th>
                    <th className="py-2 pr-3 font-medium text-gray-500 dark:text-slate-400 w-24">ปีจบ</th>
                    <th className="py-2 pr-3 font-medium text-gray-500 dark:text-slate-400 w-32">รหัสเครื่อง</th>
                    <th className="py-2 pr-3 font-medium text-gray-500 dark:text-slate-400 w-24">CC</th>
                    <th className="py-2 pr-3 font-medium text-gray-500 dark:text-slate-400 min-w-[140px]">โน้ต</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {fitments.map((f, i) => (
                    <tr key={i} className="border-b border-gray-50 dark:border-white/5 align-top">
                      <td className="py-2 pr-3">
                        <SearchableSelect
                          options={carModelOptions}
                          value={f.carModelId}
                          onChange={(id) => updateFitment("DIRECT", i, "carModelId", id)}
                          placeholder="เลือกยี่ห้อ / รุ่น"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="text"
                          value={f.submodel ?? ""}
                          onChange={(e) => updateFitment("DIRECT", i, "submodel", parseOptStr(e.target.value))}
                          placeholder="เช่น Gen 3"
                          className={`${inputCls} py-1.5`}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="number"
                          value={f.yearStart ?? ""}
                          onChange={(e) => updateFitment("DIRECT", i, "yearStart", parseYear(e.target.value))}
                          placeholder="2007"
                          min={1900}
                          max={2200}
                          className={`${inputCls} py-1.5`}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="number"
                          value={f.yearEnd ?? ""}
                          onChange={(e) => updateFitment("DIRECT", i, "yearEnd", parseYear(e.target.value))}
                          placeholder="2013"
                          min={1900}
                          max={2200}
                          className={`${inputCls} py-1.5`}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="text"
                          value={f.engineCode ?? ""}
                          onChange={(e) => updateFitment("DIRECT", i, "engineCode", parseOptStr(e.target.value))}
                          placeholder="2NZ-FE"
                          className={`${inputCls} py-1.5`}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="text"
                          value={f.engineSize ?? ""}
                          onChange={(e) => updateFitment("DIRECT", i, "engineSize", parseOptStr(e.target.value))}
                          placeholder="1.5L"
                          className={`${inputCls} py-1.5`}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="text"
                          value={f.note ?? ""}
                          onChange={(e) => updateFitment("DIRECT", i, "note", parseOptStr(e.target.value))}
                          placeholder="หมายเหตุ"
                          className={`${inputCls} py-1.5`}
                        />
                      </td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          onClick={() => removeFitment("DIRECT", i)}
                          className="text-red-400 hover:text-red-600 transition-colors dark:text-red-400 dark:hover:text-red-300"
                          title="ลบรายการนี้"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: card stack */}
            <div className="md:hidden space-y-3">
              {fitments.map((f, i) => (
                <div key={i} className="rounded-lg border border-gray-200 dark:border-white/10 p-3 space-y-2.5 bg-gray-50/40 dark:bg-slate-800/30">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-medium text-gray-500 dark:text-slate-400">#{i + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeFitment("DIRECT", i)}
                      className="text-red-400 hover:text-red-600 transition-colors dark:text-red-400 dark:hover:text-red-300"
                      aria-label="ลบ"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1 dark:text-slate-300">รุ่นรถ <span className="text-red-500">*</span></label>
                    <SearchableSelect
                      options={carModelOptions}
                      value={f.carModelId}
                      onChange={(id) => updateFitment("DIRECT", i, "carModelId", id)}
                      placeholder="เลือกยี่ห้อ / รุ่น"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1 dark:text-slate-300">โฉม</label>
                      <input type="text" value={f.submodel ?? ""}
                        onChange={(e) => updateFitment("DIRECT", i, "submodel", parseOptStr(e.target.value))}
                        placeholder="Gen 3" className={`${inputCls} py-1.5`} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1 dark:text-slate-300">รหัสเครื่อง</label>
                      <input type="text" value={f.engineCode ?? ""}
                        onChange={(e) => updateFitment("DIRECT", i, "engineCode", parseOptStr(e.target.value))}
                        placeholder="2NZ-FE" className={`${inputCls} py-1.5`} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1 dark:text-slate-300">ปีเริ่ม</label>
                      <input type="number" value={f.yearStart ?? ""}
                        onChange={(e) => updateFitment("DIRECT", i, "yearStart", parseYear(e.target.value))}
                        placeholder="2007" min={1900} max={2200} className={`${inputCls} py-1.5`} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1 dark:text-slate-300">ปีจบ</label>
                      <input type="number" value={f.yearEnd ?? ""}
                        onChange={(e) => updateFitment("DIRECT", i, "yearEnd", parseYear(e.target.value))}
                        placeholder="2013" min={1900} max={2200} className={`${inputCls} py-1.5`} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1 dark:text-slate-300">CC</label>
                      <input type="text" value={f.engineSize ?? ""}
                        onChange={(e) => updateFitment("DIRECT", i, "engineSize", parseOptStr(e.target.value))}
                        placeholder="1.5L" className={`${inputCls} py-1.5`} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1 dark:text-slate-300">โน้ต</label>
                      <input type="text" value={f.note ?? ""}
                        onChange={(e) => updateFitment("DIRECT", i, "note", parseOptStr(e.target.value))}
                        placeholder="หมายเหตุ" className={`${inputCls} py-1.5`} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {carModelOptions.length > 0 && (
          <button
            type="button"
            onClick={() => addFitment("DIRECT")}
            className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-gray-300 hover:border-[#1e3a5f] text-gray-500 hover:text-[#1e3a5f] text-sm rounded-lg transition-colors dark:border-slate-600 dark:hover:border-sky-400 dark:text-slate-300 dark:hover:text-sky-300"
          >
            <Plus size={14} />
            เพิ่มรุ่นรถที่ใช้ได้
          </button>
        )}
      </div>

      {/* ── 4. รูปภาพสินค้า ──────────────────────────────────────────────── */}
      {renderFitmentSection("COMPATIBLE", compatibleFitments)}

      <div className={sectionCls}>
        <h2 className={sectionHeadingCls}>รูปภาพสินค้า</h2>
        <div className="flex flex-col sm:flex-row items-start gap-5">
          <div className="flex-shrink-0">
            {imageUrl ? (
              <div className="relative w-32 h-32 rounded-xl overflow-hidden border border-gray-200 dark:border-white/10">
                <Image src={toProductImageCdnPath(imageUrl) ?? imageUrl} alt="preview" fill className="object-cover" sizes="128px" />
                <button type="button" onClick={() => removeProductImage(imageUrl)}
                  className="absolute top-1 right-1 bg-red-500 hover:bg-red-600 text-white rounded-full p-0.5 transition-colors">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <div className="w-32 h-32 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center bg-gray-50 dark:bg-slate-800 dark:border-slate-700">
                <p className="text-xs text-gray-400 dark:text-slate-500 text-center px-2">ยังไม่มีรูปภาพ</p>
              </div>
            )}
          </div>
          <div className="flex-1 space-y-3">
            <input ref={fileInputRef} type="file" accept="image/*"
              onChange={handleImageChange} className="hidden" id="imageUpload" multiple />
            <label htmlFor="imageUpload"
              className={`inline-flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-medium cursor-pointer transition-colors ${isUploading ? "opacity-60 cursor-not-allowed" : ""} border-gray-300 hover:bg-gray-50 bg-white dark:border-white/10 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800`}>
              {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              {isUploading ? "กำลังอัปโหลด..." : "อัปโหลดรูปภาพหลายรูป"}
            </label>
            <p className="text-xs text-gray-400 dark:text-slate-500">รองรับ JPG, PNG, WebP ขนาดไม่เกิน 3MB ต่อไฟล์ ระบบจะให้ครอปเป็น 1:1 (800×800) ก่อนอัปโหลด รูปหลักจะถูกใช้แทน imageUrl เดิม</p>
            {uploadError && <p className="text-xs text-red-500 dark:text-red-400">{uploadError}</p>}
            {productImages.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {productImages.map((image, index) => (
                  <div key={`${image.url}-${index}`} className="group relative w-24 rounded-xl border border-gray-200 bg-white p-1 dark:border-white/10 dark:bg-slate-900">
                    <button
                      type="button"
                      onClick={() => setPreviewUrl(image.url)}
                      className={`relative block aspect-square w-full cursor-zoom-in overflow-hidden rounded-lg ${image.isPrimary ? "ring-2 ring-[#1e3a5f] dark:ring-sky-400" : ""}`}
                      aria-label="ดูรูปขนาดใหญ่"
                    >
                      <Image src={toProductImageCdnPath(image.url) ?? image.url} alt={image.alt || `product-${index + 1}`} fill className="object-cover" sizes="96px" />
                      <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100">
                        <ZoomIn size={18} />
                      </span>
                    </button>
                    <div className="mt-1 flex items-center justify-between gap-1">
                      <button
                        type="button"
                        onClick={() => setPrimaryImage(image.url)}
                        className="truncate text-[11px] font-medium text-[#1e3a5f] hover:underline dark:text-sky-300"
                      >
                        {image.isPrimary ? "รูปหลัก" : "ตั้งเป็นหลัก"}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeProductImage(image.url)}
                        className="rounded-full p-1 text-red-500 transition hover:bg-red-50 dark:hover:bg-red-500/10"
                        aria-label="ลบรูป"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {previewUrl && (
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={() => setPreviewUrl(null)}
          >
            <div className="relative w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => setPreviewUrl(null)}
                className="absolute -top-10 right-0 text-white transition-colors hover:text-gray-300"
                aria-label="ปิด"
              >
                <X size={28} />
              </button>
              <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-white dark:bg-slate-950">
                <Image
                  src={toProductImageCdnPath(previewUrl) ?? previewUrl}
                  alt="preview"
                  fill
                  className="object-contain"
                  sizes="(max-width: 768px) 100vw, 672px"
                />
              </div>
            </div>
          </div>
        )}

        <CropImageDialog
          file={cropQueue[0] ?? null}
          index={cropTotal - cropQueue.length}
          total={cropTotal}
          onCancel={handleCropCancel}
          onConfirm={handleCropConfirm}
        />
      </div>

      {/* ── 5. ราคา & สต็อก ──────────────────────────────────────────────── */}
      <div className={sectionCls}>
        <h2 className={sectionHeadingCls}>ราคา &amp; สต็อก</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          <div className="sm:col-span-2 lg:col-span-1">
            <label className={labelCls}>การคำนวณสต็อก</label>
            <select
              name="inventoryTracking"
              value={inventoryTracking}
              onChange={(e) => setInventoryTracking(e.target.value as InventoryTrackingValue)}
              className={inputCls}
            >
              <option value={INVENTORY_TRACKING_TRACKED}>คำนวณสต็อก</option>
              <option value={INVENTORY_TRACKING_NON_TRACKED}>ไม่คำนวณสต็อก</option>
            </select>
            <p className={helpCls}>
              สินค้าไม่คำนวณสต็อกจะไม่เข้า Stock Card MAVG หรือ Lot และใช้ราคาทุนด้านล่างเป็นต้นทุนขาย
            </p>
          </div>
          <div>
            <label className={labelCls}>ราคาทุน (บาท)</label>
            <input type="number" name="costPrice"
              defaultValue={product ? Number(product.costPrice) : 0}
              min={0} step={0.01} className={inputCls} />
            <p className={helpCls}>
              {isNonStock
                ? "ใช้เป็นต้นทุนขายสำหรับคำนวณกำไร และระบบจะบันทึก snapshot ลงรายการขาย"
                : "ใช้เป็นราคาทุนอ้างอิง ส่วนกำไรใช้ MAVG จาก Stock Card"}
            </p>
          </div>
          <div>
            <label className={labelCls}>ราคาขายส่ง (บาท)</label>
            <input type="number" name="salePrice"
              value={salePriceInput}
              onChange={(e) => handleSalePriceChange(e.target.value)}
              min={0} step={0.01} className={inputCls} />
            <p className={helpCls}>
              ราคาสำหรับกลุ่มลูกค้าประเภท “ราคาขายส่ง” เช่น อู่ซ่อมรถ — เมื่อกรอกช่องนี้
              ระบบจะคำนวณราคาสมาชิก (+40%) และราคาขายปลีก (+70%) ให้อัตโนมัติ ปัดขึ้นลงท้ายด้วย 0 และแก้ไขเองได้
            </p>
          </div>
          <div>
            <label className={labelCls}>ราคาสมาชิก (บาท)</label>
            <input type="number" name="memberPrice"
              value={memberPriceInput}
              onChange={(e) => setMemberPriceInput(e.target.value)}
              min={0} step={0.01} className={inputCls} />
            <p className={helpCls}>ราคาสำหรับกลุ่มลูกค้าประเภท “สมาชิก” — เว้น 0 ระบบจะแสดง “สอบถามราคา”</p>
          </div>
          <div>
            <label className={labelCls}>ราคาขายปลีก (บาท)</label>
            <input type="number" name="retailPrice"
              value={retailPriceInput}
              onChange={(e) => setRetailPriceInput(e.target.value)}
              min={0} step={0.01} className={inputCls} />
            <p className={helpCls}>ราคาสำหรับลูกค้าทั่วไป — เว้น 0 ระบบจะแสดง “สอบถามราคา”</p>
          </div>
          <div>
            <label className={labelCls}>Stock ขั้นต่ำ</label>
            <input type="number" name="minStock"
              defaultValue={product?.minStock ?? 1}
              min={0} step={1} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>ระยะเวลาประกัน (วัน)</label>
            <input type="number" name="warrantyDays"
              defaultValue={product?.warrantyDays ?? 0}
              min={0} step={1} className={inputCls}
              placeholder="0 = ไม่มีประกัน" />
          </div>
          <div>
            <label className={labelCls}>สถานะหน้าบ้าน</label>
            <select
              name="isStorefrontVisible"
              value={isStorefrontVisible ? "true" : "false"}
              onChange={(e) => setIsStorefrontVisible(e.target.value === "true")}
              className={inputCls}
            >
              <option value="true">แสดง</option>
              <option value="false">ซ่อน</option>
            </select>
            <p className={helpCls}>
              มีผลเฉพาะการแสดงสินค้าหน้าบ้าน ไม่กระทบสถานะใช้งานในหลังบ้าน
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs text-gray-400 dark:text-slate-500">
          * จำนวน Stock เริ่มต้นกำหนดได้ที่ระบบ BF (ยอดยกมา)
        </p>
      </div>

      {/* ── 6. หน่วยนับ ───────────────────────────────────────────────────── */}
      <div className={sectionCls}>
        <h2 className="font-kanit text-base sm:text-lg font-semibold text-[#1e3a5f] mb-1 pb-0 dark:text-sky-200">
          หน่วยนับสินค้า
        </h2>
        <p className="text-xs text-gray-400 dark:text-slate-500 mb-5 pb-3 border-b border-gray-100 dark:border-white/10">
          หน่วยหลัก (isBase) ต้องมี Scale = 1 เสมอ · Scale ของหน่วยอื่น = จำนวนหน่วยย่อยต่อ 1 หน่วยนั้น
        </p>

        <div className="overflow-x-auto mb-4">
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="border-b border-gray-100 dark:border-white/10">
                <th className="text-left py-2 pr-4 text-gray-500 dark:text-slate-400 font-medium w-10">#</th>
                <th className="text-left py-2 pr-4 text-gray-500 dark:text-slate-400 font-medium">ชื่อหน่วย</th>
                <th className="text-left py-2 pr-4 text-gray-500 dark:text-slate-400 font-medium w-32">Scale</th>
                <th className="text-left py-2 pr-4 text-gray-500 dark:text-slate-400 font-medium w-28">ประเภท</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {units.map((unit, i) => (
                <tr key={i} className="border-b border-gray-50 dark:border-white/5">
                  <td className="py-2 pr-4 text-gray-400 dark:text-slate-500">{i + 1}</td>
                  <td className="py-2 pr-4">
                    <input
                      type="text"
                      value={unit.name}
                      onChange={(e) => handleUnitNameChange(i, e.target.value)}
                      placeholder="เช่น ชิ้น, โหล, กล่อง"
                      className={`${inputCls} py-1.5`}
                    />
                  </td>
                  <td className="py-2 pr-4">
                    {unit.isBase ? (
                      <input
                        type="number"
                        value={1}
                        disabled
                        className="w-24 px-2.5 py-1.5 border border-gray-200 rounded-md text-sm bg-gray-50 text-gray-400 dark:border-white/10 dark:bg-slate-800 dark:text-slate-500"
                      />
                    ) : (
                      <input
                        type="number"
                        value={unit.scale}
                        onChange={(e) => handleUnitScaleChange(i, Number(e.target.value))}
                        min={0.001}
                        step={0.001}
                        className={`${inputCls} w-24 py-1.5`}
                      />
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {unit.isBase ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[#1e3a5f]/10 text-[#1e3a5f] dark:bg-sky-500/15 dark:text-sky-300">
                        หน่วยหลัก
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300">
                        หน่วยเพิ่มเติม
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {!unit.isBase && (
                      <button
                        type="button"
                        onClick={() => removeUnit(i)}
                        className="text-red-400 hover:text-red-600 transition-colors dark:text-red-400 dark:hover:text-red-300"
                        title="ลบหน่วยนี้"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button
          type="button"
          onClick={addUnit}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-gray-300 hover:border-[#1e3a5f] text-gray-500 hover:text-[#1e3a5f] text-sm rounded-lg transition-colors dark:border-slate-600 dark:hover:border-sky-400 dark:text-slate-300 dark:hover:text-sky-300"
        >
          <Plus size={14} />
          เพิ่มหน่วยนับ
        </button>

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-gray-100 dark:border-white/10">
          <div>
            <label className={labelCls}>หน่วยขาย <span className="text-red-500">*</span></label>
            <select value={saleUnitName} onChange={(e) => setSaleUnitName(e.target.value)} className={inputCls}>
              {unitNameOptions.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>หน่วยซื้อ <span className="text-red-500">*</span></label>
            <select value={purchaseUnitName} onChange={(e) => setPurchaseUnitName(e.target.value)} className={inputCls}>
              {unitNameOptions.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>หน่วยรายงาน <span className="text-red-500">*</span></label>
            <select value={reportUnitName} onChange={(e) => setReportUnitName(e.target.value)} className={inputCls}>
              {unitNameOptions.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* ── 7. Lot Control (conditional) ─────────────────────────────────── */}
      {!isNonStock && (
        <div className={sectionCls}>
          <h2 className={sectionHeadingCls}>Lot Control</h2>
          <label className="flex items-center gap-3 cursor-pointer mb-4">
            <input
              type="checkbox"
              checked={isLotControl}
              onChange={(e) => setIsLotControl(e.target.checked)}
              className={checkboxCls}
            />
            <span className="text-sm font-medium text-gray-700 dark:text-slate-200">
              เปิดใช้ระบบ Lot Control สำหรับสินค้านี้
            </span>
          </label>

          {isLotControl && (
            <div className="pl-7 space-y-4 border-l-2 border-[#1e3a5f]/20 ml-2 dark:border-sky-500/20">
              <div>
                <label className={labelCls}>วิธีจ่ายออก (Lot Issue Method)</label>
                <select
                  value={lotIssueMethod}
                  onChange={(e) => setLotIssueMethod(e.target.value)}
                  className={`${inputCls} max-w-sm`}
                >
                  <option value="FIFO">FIFO — เข้าก่อนออกก่อน (เรียงตามวันผลิต)</option>
                  <option value="FEFO">FEFO — หมดอายุก่อนออกก่อน (เรียงตามวันหมดอายุ)</option>
                  <option value="MANUAL">MANUAL — เลือกเองทุกครั้ง</option>
                </select>
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={requireExpiryDate}
                  onChange={(e) => setRequireExpiryDate(e.target.checked)}
                  className={checkboxCls}
                />
                <span className="text-sm text-gray-700 dark:text-slate-200">
                  บังคับกรอกวันหมดอายุ (EXP) ตอนรับสินค้าเข้า
                </span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowExpiredIssue}
                  onChange={(e) => setAllowExpiredIssue(e.target.checked)}
                  className={checkboxCls}
                />
                <span className="text-sm text-gray-700 dark:text-slate-200">
                  อนุญาตให้จ่ายสินค้าหมดอายุแล้วออกได้
                </span>
              </label>
            </div>
          )}
        </div>
      )}

      {/* ── Error & Submit ─────────────────────────────────────────────────── */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 dark:bg-red-500/10 dark:border-red-500/30">
          <p className="text-sm text-red-600 dark:text-red-300">{error}</p>
        </div>
      )}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center sm:justify-end gap-3 pt-2">
        <button type="button" onClick={() => router.push(returnTo)}
          className="px-5 py-2.5 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg transition-colors dark:border-white/10 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
          ยกเลิก
        </button>
        <button type="submit" disabled={isPending || isUploading}
          className="inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-[#f97316] hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60">
          {isPending ? (
            <><Loader2 size={16} className="animate-spin" />กำลังบันทึก...</>
          ) : product ? "บันทึกการแก้ไข" : "เพิ่มสินค้า"}
        </button>
      </div>

      {aiDraft && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-950">
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 p-4 dark:border-white/10">
              <div>
                <h3 className="font-kanit text-lg font-semibold text-[#1e3a5f] dark:text-sky-200">ตรวจร่างข้อมูลจาก AI Research</h3>
                <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">แก้ไขข้อมูลใน modal นี้ได้ก่อนกดตกลง ระบบจะนำไปกรอกในฟอร์ม แต่ยังไม่บันทึกสินค้า</p>
              </div>
              <button type="button" onClick={() => setAiDraft(null)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-slate-800 dark:hover:text-slate-200" aria-label="ปิด AI Research">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-5 overflow-y-auto p-4">
              {(aiDraft.warnings.length > 0 || aiDraft.questionsForAdmin.length > 0) && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  {aiDraft.warnings.length > 0 && (
                    <div>
                      <p className="font-semibold">คำเตือน/ข้อจำกัด</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5">
                        {aiDraft.warnings.map((warning, index) => <li key={`warning-${index}`}>{warning}</li>)}
                      </ul>
                    </div>
                  )}
                  {aiDraft.questionsForAdmin.length > 0 && (
                    <div className="mt-3">
                      <p className="font-semibold">ข้อมูลที่ควรถาม/ตรวจเพิ่ม</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5">
                        {aiDraft.questionsForAdmin.map((question, index) => <li key={`question-${index}`}>{question}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className={labelCls}>ชื่อสินค้า</label>
                  <input value={aiDraft.productName.value} onChange={(e) => updateAiDraftText("productName", e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>หมวดหมู่</label>
                  <input value={aiDraft.category.value} onChange={(e) => updateAiDraftText("category", e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>แบรนด์อะไหล่</label>
                  <input value={aiDraft.partsBrand.value} onChange={(e) => updateAiDraftText("partsBrand", e.target.value)} className={inputCls} />
                </div>
              </div>

              <div>
                <label className={labelCls}>คำอธิบายสินค้า</label>
                <textarea
                  value={aiDraft.descriptionCopyBox}
                  onChange={(e) => setAiDraft((current) => current ? { ...current, descriptionCopyBox: e.target.value } : current)}
                  rows={8}
                  className={`${inputCls} resize-y`}
                />
              </div>

              <div>
                <h4 className="mb-3 font-kanit text-base font-semibold text-[#1e3a5f] dark:text-sky-200">รหัสค้นหา / OEM / Part No. / คำพ้อง</h4>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {ALIAS_KINDS.map((kind) => (
                    <div key={kind}>
                      <label className={labelCls}>{ALIAS_KIND_META[kind].label}{aiDraft.aliases[kind].required && <span className="text-red-500"> *</span>}</label>
                      <textarea
                        value={aiDraft.aliases[kind].csv}
                        onChange={(e) => updateAiDraftAlias(kind, e.target.value)}
                        rows={2}
                        className={`${inputCls} resize-y`}
                        placeholder="คั่นแต่ละคำด้วยลูกน้ำ"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className={labelCls}>VERIFIED — ใช้ร่วมกันได้</label>
                  <textarea
                    value={aiVerifiedFitmentText}
                    onChange={(e) => setAiVerifiedFitmentText(e.target.value)}
                    rows={5}
                    className={`${inputCls} resize-y`}
                    placeholder="ยี่ห้อ / รุ่น | ปีเริ่ม-ปีจบ | CC | รหัสเครื่อง | โฉม | โน้ต"
                  />
                  <p className={helpCls}>จะเพิ่มเฉพาะรุ่นรถที่ match กับ master data ในระบบได้เท่านั้น</p>
                </div>
                <div>
                  <label className={labelCls}>POSSIBLE_MATCH — ต้องเทียบอะไหล่เดิมก่อน</label>
                  <textarea
                    value={aiPossibleFitmentText}
                    onChange={(e) => setAiPossibleFitmentText(e.target.value)}
                    rows={5}
                    className={`${inputCls} resize-y`}
                    placeholder="ยี่ห้อ / รุ่น | ปีเริ่ม-ปีจบ | CC | รหัสเครื่อง | โฉม | โน้ต"
                  />
                  <p className={helpCls}>ข้อมูลส่วนนี้จะไปอยู่ใน section “อาจใช้ร่วมกันได้บางรุ่น”</p>
                </div>
              </div>

              {aiDraft.sources.length > 0 && (
                <div>
                  <h4 className="mb-2 font-kanit text-base font-semibold text-[#1e3a5f] dark:text-sky-200">แหล่งอ้างอิงที่ AI ใช้</h4>
                  <ul className="space-y-1 text-xs text-gray-600 dark:text-slate-300">
                    {aiDraft.sources.map((source, index) => (
                      <li key={`${source.url}-${index}`} className="break-all">• {source.title || source.sourceType}: {source.url}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-gray-100 p-4 sm:flex-row sm:justify-end dark:border-white/10">
              <button type="button" onClick={() => setAiDraft(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-slate-800">ยกเลิก</button>
              <button type="button" onClick={applyAiDraft} className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-500">
                <Sparkles size={15} /> ตกลงและกรอกลงฟอร์ม
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
};

export default ProductForm;
