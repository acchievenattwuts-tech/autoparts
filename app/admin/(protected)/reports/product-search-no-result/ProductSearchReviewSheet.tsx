"use client";

import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle, Copy, EyeOff, Search } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";

import {
  applyProductAliasCandidate,
  applyProductFitmentCandidate,
  applySearchSynonymCandidate,
  markProductSearchReviewOutcome,
} from "./actions";

// ─── Types ───────────────────────────────────────────────────────────────────

type CandidateAction = "search-synonym" | "product-alias-oem" | "fitment-year" | "review-noise";

type ClusterProps = {
  normalizedQuery: string;
  rawQueries: string[];
  candidateAction: CandidateAction;
};

type OutcomeProps = {
  status: string;
  note: string | null;
} | null;

type ProductOption = { code: string; name: string };

type CarBrandOption = {
  id: string;
  name: string;
  carModels: { id: string; name: string }[];
};

type FitmentHint = { yearStart: number | null; yearEnd: number | null };

type Props = {
  cluster: ClusterProps;
  outcome: OutcomeProps;
  products: ProductOption[];
  carBrands: CarBrandOption[];
  fitmentYearHint: FitmentHint;
  returnTo: string;
};

const aliasKindOptions = ["OEM", "PART_NO", "CROSS_REF", "ALIAS", "KEYWORD", "MISSPELL"] as const;

// ─── Main Component ───────────────────────────────────────────────────────────

export const ProductSearchReviewSheet = ({
  cluster,
  outcome,
  products,
  carBrands,
  fitmentYearHint,
  returnTo,
}: Props) => {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmLabel, setConfirmLabel] = useState("");
  const pendingFormRef = useRef<HTMLFormElement | null>(null);
  const confirmedRef = useRef(false);

  // SearchableSelect state
  const [productCodeForAlias, setProductCodeForAlias] = useState("");
  const [productCodeForFitment, setProductCodeForFitment] = useState("");
  const [carModelId, setCarModelId] = useState("");

  const productOptions: SelectOption[] = products.map((p) => ({
    id: p.code,
    label: p.code,
    sublabel: p.name,
  }));

  const carModelOptions: SelectOption[] = carBrands.flatMap((brand) =>
    brand.carModels.map((model) => ({
      id: model.id,
      label: `${brand.name} / ${model.name}`,
      sublabel: brand.name,
    })),
  );

  // Intercept form submit — show confirmation dialog first
  const handleApplySubmit = (label: string, e: React.FormEvent<HTMLFormElement>) => {
    if (confirmedRef.current) {
      confirmedRef.current = false;
      return; // allow native submission
    }
    e.preventDefault();
    pendingFormRef.current = e.currentTarget;
    setConfirmLabel(label);
    setConfirmOpen(true);
  };

  const handleConfirm = () => {
    setConfirmOpen(false);
    if (pendingFormRef.current) {
      confirmedRef.current = true;
      pendingFormRef.current.requestSubmit();
      pendingFormRef.current = null;
    }
  };

  const inputCls =
    "h-8 rounded-md border border-input bg-background px-2 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-ring dark:text-slate-100";
  const labelCls = "flex flex-col gap-1 text-[11px] font-medium text-gray-500 dark:text-slate-400";

  return (
    <>
      {/* ── Sheet trigger ── */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetTrigger className="h-7 rounded-md bg-sky-600 px-3 text-xs font-medium text-white hover:bg-sky-700 dark:bg-sky-500 dark:hover:bg-sky-400">
          Review
        </SheetTrigger>

        <SheetContent side="right" className="flex w-full max-w-lg flex-col gap-0 overflow-y-auto p-0">
          <SheetHeader className="border-b border-gray-100 px-5 py-4 dark:border-white/10">
            <SheetTitle className="font-kanit text-sm font-semibold text-gray-900 dark:text-slate-100">
              Review: {cluster.normalizedQuery}
            </SheetTitle>
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
              Raw variants: {cluster.rawQueries.join(" | ")}
            </p>
            {outcome?.status ? (
              <p className="text-xs font-medium text-sky-700 dark:text-sky-200">
                Current status: {outcome.status}
                {outcome.note ? ` — ${outcome.note}` : ""}
              </p>
            ) : null}
          </SheetHeader>

          <div className="flex flex-col gap-5 p-5">
            {/* ── Apply form: SearchSynonym ── */}
            {cluster.candidateAction === "search-synonym" ? (
              <section className="rounded-lg border border-sky-100 bg-sky-50 p-4 dark:border-sky-400/20 dark:bg-sky-400/10">
                <p className="mb-3 text-xs font-semibold text-sky-900 dark:text-sky-100">เพิ่ม SearchSynonym</p>
                <form
                  action={applySearchSynonymCandidate}
                  onSubmit={(e) => handleApplySubmit("เพิ่ม SearchSynonym", e)}
                  className="flex flex-col gap-3"
                >
                  <input type="hidden" name="candidate" value={cluster.rawQueries[0] || cluster.normalizedQuery} />
                  <input type="hidden" name="normalizedQuery" value={cluster.normalizedQuery} />
                  <input type="hidden" name="candidateAction" value={cluster.candidateAction} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <div className="flex flex-wrap gap-3">
                    <label className={labelCls}>
                      Term (canonical)
                      <input
                        name="term"
                        defaultValue=""
                        placeholder="เช่น compressor"
                        className={`${inputCls} w-48`}
                      />
                    </label>
                    <label className={labelCls}>
                      Language
                      <input
                        name="language"
                        defaultValue=""
                        placeholder="th / en"
                        className={`${inputCls} w-20`}
                      />
                    </label>
                  </div>
                  <button
                    type="submit"
                    className="mt-1 h-9 self-start rounded-md bg-[#1e3a5f] px-4 text-xs font-medium text-white hover:bg-[#163055] dark:bg-sky-700 dark:hover:bg-sky-600"
                  >
                    Apply synonym
                  </button>
                </form>
              </section>
            ) : null}

            {/* ── Apply form: ProductAlias/OEM ── */}
            {cluster.candidateAction === "product-alias-oem" ? (
              <section className="rounded-lg border border-emerald-100 bg-emerald-50 p-4 dark:border-emerald-400/20 dark:bg-emerald-400/10">
                <p className="mb-3 text-xs font-semibold text-emerald-900 dark:text-emerald-100">เพิ่ม ProductAlias/OEM</p>
                <form
                  action={applyProductAliasCandidate}
                  onSubmit={(e) => handleApplySubmit("เพิ่ม ProductAlias", e)}
                  className="flex flex-col gap-3"
                >
                  <input type="hidden" name="alias" value={cluster.rawQueries[0] || cluster.normalizedQuery} />
                  <input type="hidden" name="normalizedQuery" value={cluster.normalizedQuery} />
                  <input type="hidden" name="candidateAction" value={cluster.candidateAction} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <div className="flex flex-col gap-3">
                    <label className={labelCls}>
                      Product code
                      <SearchableSelect
                        options={productOptions}
                        value={productCodeForAlias}
                        onChange={setProductCodeForAlias}
                        placeholder="พิมพ์เพื่อค้นหา product code"
                      />
                      <input type="hidden" name="productCode" value={productCodeForAlias} />
                    </label>
                    <label className={labelCls}>
                      Kind
                      <select
                        name="kind"
                        defaultValue="OEM"
                        className={`${inputCls} w-36`}
                      >
                        {aliasKindOptions.map((kind) => (
                          <option key={kind} value={kind}>
                            {kind}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <button
                    type="submit"
                    className="mt-1 h-9 self-start rounded-md bg-emerald-700 px-4 text-xs font-medium text-white hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                  >
                    Add alias
                  </button>
                </form>
              </section>
            ) : null}

            {/* ── Apply form: Fitment/Year ── */}
            {cluster.candidateAction === "fitment-year" ? (
              <section className="rounded-lg border border-violet-100 bg-violet-50 p-4 dark:border-violet-400/20 dark:bg-violet-400/10">
                <p className="mb-3 text-xs font-semibold text-violet-900 dark:text-violet-100">เพิ่ม ProductFitment</p>
                <form
                  action={applyProductFitmentCandidate}
                  onSubmit={(e) => handleApplySubmit("เพิ่ม ProductFitment", e)}
                  className="flex flex-col gap-3"
                >
                  <input type="hidden" name="normalizedQuery" value={cluster.normalizedQuery} />
                  <input type="hidden" name="candidateAction" value={cluster.candidateAction} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <div className="flex flex-col gap-3">
                    <label className={labelCls}>
                      Product code
                      <SearchableSelect
                        options={productOptions}
                        value={productCodeForFitment}
                        onChange={setProductCodeForFitment}
                        placeholder="พิมพ์เพื่อค้นหา product code"
                      />
                      <input type="hidden" name="productCode" value={productCodeForFitment} />
                    </label>
                    <label className={labelCls}>
                      Car model
                      <SearchableSelect
                        options={carModelOptions}
                        value={carModelId}
                        onChange={setCarModelId}
                        placeholder="เลือกรุ่นรถ"
                      />
                      <input type="hidden" name="carModelId" value={carModelId} />
                    </label>
                    <div className="flex flex-wrap gap-3">
                      <label className={labelCls}>
                        Year start
                        <input
                          name="yearStart"
                          type="number"
                          min={1900}
                          max={2200}
                          defaultValue={fitmentYearHint.yearStart ?? ""}
                          className={`${inputCls} w-24`}
                        />
                      </label>
                      <label className={labelCls}>
                        Year end
                        <input
                          name="yearEnd"
                          type="number"
                          min={1900}
                          max={2200}
                          defaultValue={fitmentYearHint.yearEnd ?? ""}
                          className={`${inputCls} w-24`}
                        />
                      </label>
                      <label className={labelCls}>
                        Submodel
                        <input name="submodel" placeholder="optional" className={`${inputCls} w-28`} />
                      </label>
                      <label className={labelCls}>
                        Engine
                        <input name="engineCode" placeholder="optional" className={`${inputCls} w-28`} />
                      </label>
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="mt-1 h-9 self-start rounded-md bg-violet-700 px-4 text-xs font-medium text-white hover:bg-violet-800 dark:bg-violet-600 dark:hover:bg-violet-500"
                  >
                    Add fitment
                  </button>
                </form>
              </section>
            ) : null}

            {/* ── Status / Triage ── (Item 21: visually grouped with icons) */}
            <section className="rounded-lg border border-gray-100 bg-gray-50 p-4 dark:border-white/10 dark:bg-white/5">
              <p className="mb-3 text-xs font-semibold text-gray-700 dark:text-slate-300">เปลี่ยนสถานะ</p>
              <form action={markProductSearchReviewOutcome} className="flex flex-col gap-3">
                <input type="hidden" name="normalizedQuery" value={cluster.normalizedQuery} />
                <input type="hidden" name="candidateAction" value={cluster.candidateAction} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <label className={labelCls}>
                  Note (ไม่บังคับ)
                  <input
                    name="note"
                    defaultValue={outcome?.note ?? ""}
                    placeholder="optional"
                    className={`${inputCls} w-full`}
                  />
                </label>
                {/* Segmented control row with icons */}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    name="status"
                    value="ignored"
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-white/15 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
                  >
                    <EyeOff className="h-3.5 w-3.5" />
                    Ignore
                  </button>
                  <button
                    type="submit"
                    name="status"
                    value="needs-investigation"
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200 dark:hover:bg-amber-400/20"
                  >
                    <Search className="h-3.5 w-3.5" />
                    Needs investigation
                  </button>
                  <button
                    type="submit"
                    name="status"
                    value="duplicate"
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border border-cyan-200 bg-cyan-50 px-3 text-xs font-medium text-cyan-800 hover:bg-cyan-100 dark:border-cyan-400/20 dark:bg-cyan-400/10 dark:text-cyan-200 dark:hover:bg-cyan-400/20"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Duplicate
                  </button>
                </div>
              </form>
            </section>
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Confirmation AlertDialog ── (Item 13) */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              ยืนยันการ Apply
            </AlertDialogTitle>
            <AlertDialogDescription>
              คุณต้องการ <span className="font-semibold text-gray-900 dark:text-slate-100">{confirmLabel}</span> สำหรับ&nbsp;
              <span className="font-mono font-semibold text-sky-700 dark:text-sky-300">{cluster.normalizedQuery}</span>{" "}
              หรือไม่?
              <br />
              การกระทำนี้จะเขียนข้อมูลลงฐานข้อมูลและบันทึก audit log ทันที
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirm}
              className="bg-[#1e3a5f] text-white hover:bg-[#163055] dark:bg-sky-700 dark:hover:bg-sky-600"
            >
              <CheckCircle className="mr-1.5 h-4 w-4" />
              ยืนยัน
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
