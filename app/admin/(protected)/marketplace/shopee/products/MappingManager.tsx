"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Link2, Loader2, Trash2, Wand2 } from "lucide-react";

import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";
import type { AutoMatchSuggestion } from "@/lib/shopee/services/mapping";
import type { ShopeeMappingRow } from "@/lib/shopee/services/mapping";
import type { ShopeeItemSummary } from "@/lib/shopee/services/products";

import {
  applySuggestionsAction,
  createMappingAction,
  deleteMappingAction,
  pullShopeeItemsAction,
} from "./actions";

type ProductLite = { id: string; code: string; name: string };

type Props = {
  shopRecordId: string;
  canManage: boolean;
  products: ProductLite[];
  mappings: ShopeeMappingRow[];
};

const SYNC_MODE_LABEL: Record<string, string> = {
  MONITOR_ONLY: "เฝ้าดูอย่างเดียว",
  PUSH_INTERNAL_TO_SHOPEE: "ส่งสต็อกไป Shopee",
  DISABLED: "ปิด",
};

const suggestionKey = (s: AutoMatchSuggestion) => `${s.itemId}::${s.modelId}`;

const MappingManager = ({ shopRecordId, canManage, products, mappings }: Props) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [productId, setProductId] = useState("");
  const [itemId, setItemId] = useState("");
  const [modelId, setModelId] = useState("");
  const [sellerSku, setSellerSku] = useState("");
  const [syncMode, setSyncMode] = useState("MONITOR_ONLY");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const [pulling, setPulling] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);
  const [items, setItems] = useState<ShopeeItemSummary[] | null>(null);
  const [suggestions, setSuggestions] = useState<AutoMatchSuggestion[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const productOptions: SelectOption[] = products.map((p) => ({
    id: p.id,
    label: p.name,
    sublabel: p.code,
  }));

  const handleCreate = () => {
    setMessage(null);
    if (!productId || !itemId.trim()) {
      setMessage({ kind: "error", text: "เลือกสินค้าและกรอก Shopee item id ก่อน" });
      return;
    }
    const fd = new FormData();
    fd.set("shopRecordId", shopRecordId);
    fd.set("productId", productId);
    fd.set("itemId", itemId.trim());
    fd.set("modelId", modelId.trim() || "0");
    fd.set("sellerSku", sellerSku.trim());
    fd.set("syncMode", syncMode);
    startTransition(async () => {
      const result = await createMappingAction(fd);
      if (result.ok) {
        setMessage({ kind: "ok", text: "บันทึกการ map แล้ว" });
        setProductId("");
        setItemId("");
        setModelId("");
        setSellerSku("");
        router.refresh();
      } else {
        setMessage({ kind: "error", text: result.error });
      }
    });
  };

  const handleDelete = (id: string) => {
    const fd = new FormData();
    fd.set("id", id);
    startTransition(async () => {
      const result = await deleteMappingAction(fd);
      if (!result.ok) setMessage({ kind: "error", text: result.error });
      else router.refresh();
    });
  };

  const handlePull = () => {
    setPullError(null);
    setPulling(true);
    startTransition(async () => {
      const result = await pullShopeeItemsAction(shopRecordId);
      setPulling(false);
      if (!result.ok) {
        setPullError(result.error);
        return;
      }
      setItems(result.items);
      setSuggestions(result.suggestions);
      setSelected(new Set(result.suggestions.map(suggestionKey)));
    });
  };

  const toggleSelected = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleApply = () => {
    const chosen = suggestions.filter((s) => selected.has(suggestionKey(s)));
    if (chosen.length === 0) {
      setMessage({ kind: "error", text: "ยังไม่ได้เลือกรายการที่จะ map" });
      return;
    }
    const fd = new FormData();
    fd.set("shopRecordId", shopRecordId);
    fd.set("suggestions", JSON.stringify(chosen));
    startTransition(async () => {
      const result = await applySuggestionsAction(fd);
      if (result.ok) {
        setMessage({ kind: "ok", text: `map อัตโนมัติ ${chosen.length} รายการแล้ว` });
        setItems(null);
        setSuggestions([]);
        setSelected(new Set());
        router.refresh();
      } else {
        setMessage({ kind: "error", text: result.error });
      }
    });
  };

  return (
    <div className="space-y-5">
      {message ? (
        <div
          className={`rounded-xl border px-4 py-2.5 text-sm ${
            message.kind === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-100"
              : "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-100"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      {/* Existing mappings */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0d1728]">
        <h2 className="font-kanit text-base font-semibold text-slate-900 dark:text-slate-100">
          การ map ปัจจุบัน ({mappings.length})
        </h2>
        <div className="mt-3 space-y-2">
          {mappings.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
              ยังไม่มีการ map สินค้า
            </p>
          ) : (
            mappings.map((m) => (
              <div
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-2.5 dark:border-white/10 dark:bg-white/5"
              >
                <div className="min-w-0 text-sm">
                  <p className="font-medium text-slate-900 dark:text-slate-100">
                    {m.productCode} · {m.productName}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    item {m.itemId} · model {m.modelId}
                    {m.sellerSku ? ` · SKU ${m.sellerSku}` : ""} · {SYNC_MODE_LABEL[m.syncMode] ?? m.syncMode}
                  </p>
                </div>
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => handleDelete(m.id)}
                    disabled={isPending}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50 dark:border-white/10 dark:text-slate-300 dark:hover:border-rose-400/30 dark:hover:bg-rose-400/10 dark:hover:text-rose-200"
                  >
                    <Trash2 size={13} />
                    ลบ
                  </button>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>

      {canManage ? (
        <>
          {/* Manual add */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0d1728]">
            <h2 className="flex items-center gap-2 font-kanit text-base font-semibold text-slate-900 dark:text-slate-100">
              <Link2 size={18} /> เพิ่มการ map เอง
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">สินค้าในระบบ</label>
                <SearchableSelect
                  options={productOptions}
                  value={productId}
                  onChange={setProductId}
                  placeholder="ค้นหาสินค้า (ชื่อ/รหัส)"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Shopee item id</label>
                <input
                  value={itemId}
                  onChange={(e) => setItemId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-orange-400 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
                  placeholder="เช่น 123456789"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">model id (ถ้าไม่มีให้ใส่ 0)</label>
                <input
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-orange-400 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">seller SKU (ไม่บังคับ)</label>
                <input
                  value={sellerSku}
                  onChange={(e) => setSellerSku(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-orange-400 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">โหมด sync</label>
                <select
                  value={syncMode}
                  onChange={(e) => setSyncMode(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-orange-400 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="MONITOR_ONLY">เฝ้าดูอย่างเดียว</option>
                  <option value="PUSH_INTERNAL_TO_SHOPEE">ส่งสต็อกไป Shopee</option>
                  <option value="DISABLED">ปิด</option>
                </select>
              </div>
            </div>
            <button
              type="button"
              onClick={handleCreate}
              disabled={isPending}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-orange-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-orange-700 disabled:opacity-50 dark:bg-orange-500 dark:hover:bg-orange-400"
            >
              {isPending ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}
              บันทึกการ map
            </button>
          </section>

          {/* Pull + auto-suggest */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0d1728]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-kanit text-base font-semibold text-slate-900 dark:text-slate-100">
                <Wand2 size={18} /> ดึงสินค้าจาก Shopee + แนะนำ map อัตโนมัติ
              </h2>
              <button
                type="button"
                onClick={handlePull}
                disabled={pulling || isPending}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/10"
              >
                {pulling ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                ดึงสินค้าจาก Shopee
              </button>
            </div>

            {pullError ? (
              <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200">
                {pullError}
              </p>
            ) : null}

            {items ? (
              <div className="mt-4 space-y-3">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  ดึงมา {items.length} รายการ · แนะนำ map ได้ {suggestions.length} รายการ (SKU ตรงกับรหัสสินค้า)
                </p>
                {suggestions.length > 0 ? (
                  <>
                    <div className="space-y-2">
                      {suggestions.map((s) => {
                        const key = suggestionKey(s);
                        return (
                          <label
                            key={key}
                            className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-2.5 text-sm dark:border-white/10 dark:bg-white/5"
                          >
                            <input
                              type="checkbox"
                              checked={selected.has(key)}
                              onChange={() => toggleSelected(key)}
                              className="h-4 w-4 accent-orange-600"
                            />
                            <span className="min-w-0">
                              <span className="font-medium text-slate-900 dark:text-slate-100">
                                {s.productCode} · {s.productName}
                              </span>
                              <span className="block text-xs text-slate-500 dark:text-slate-400">
                                item {s.itemId} · model {s.modelId} · SKU {s.sku}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={handleApply}
                      disabled={isPending || selected.size === 0}
                      className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-400"
                    >
                      {isPending ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
                      map ที่เลือก ({selected.size})
                    </button>
                  </>
                ) : (
                  <p className="text-sm text-slate-500 dark:text-slate-400">ไม่พบ SKU ที่ตรงกับรหัสสินค้าในระบบ</p>
                )}
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
};

export default MappingManager;
