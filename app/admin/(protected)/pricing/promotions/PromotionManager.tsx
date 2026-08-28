"use client";

import { Fragment, useState, useTransition, type TransitionStartFunction } from "react";
import { cancelPricePromotion, createPricePromotionDraft, publishPricePromotion, updatePricePromotionDraft } from "./actions";

type Option = { id: string; label: string };
type PromotionRow = {
  id: string;
  name: string;
  priceListId: string;
  priceListName: string;
  startDate: string;
  endDate: string;
  dateRange: string;
  status: "DRAFT" | "PUBLISHED" | "CANCELLED";
  note: string | null;
  itemCount: number;
  items: Array<{ productId: string; label: string; normalReferencePrice: number; promotionPrice: number }>;
};
type ItemRow = { key: number; productId: string; promotionPrice: number };

const fieldClass = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-white/15 dark:bg-slate-950 dark:text-slate-100";

export default function PromotionManager({
  priceLists,
  products,
  promotions,
  today,
}: {
  priceLists: Option[];
  products: Option[];
  promotions: PromotionRow[];
  today: string;
}) {
  const [items, setItems] = useState<ItemRow[]>([{ key: 1, productId: "", promotionPrice: 0 }]);
  const [message, setMessage] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-6">
      <form
        className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/60"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          startTransition(async () => {
            const result = await createPricePromotionDraft({
              name: form.get("name"),
              priceListId: form.get("priceListId"),
              startDate: form.get("startDate"),
              endDate: form.get("endDate"),
              note: form.get("note"),
              items: items.map(({ productId, promotionPrice }) => ({ productId, promotionPrice })),
            });
            setMessage(result.error ?? "สร้าง draft โปรโมชั่นแล้ว");
            if (!result.error) setItems([{ key: Date.now(), productId: "", promotionPrice: 0 }]);
          });
        }}
      >
        <h2 className="font-kanit text-lg font-semibold text-slate-900 dark:text-slate-100">สร้าง scheduled price override</h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <input name="name" required placeholder="ชื่อโปรโมชั่น" className={fieldClass} />
          <select name="priceListId" required defaultValue="" className={fieldClass}>
            <option value="">เลือกระดับราคา</option>
            {priceLists.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          <input name="startDate" type="date" required defaultValue={today} className={fieldClass} />
          <input name="endDate" type="date" required defaultValue={today} className={fieldClass} />
        </div>
        <div className="space-y-2">
          {items.map((item, index) => (
            <div key={item.key} className="grid gap-2 md:grid-cols-[1fr_180px_auto]">
              <select
                required
                value={item.productId}
                onChange={(event) => setItems((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, productId: event.target.value } : row))}
                className={fieldClass}
              >
                <option value="">เลือกสินค้า</option>
                {products.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
              <input
                type="number"
                min={0}
                step={0.01}
                value={item.promotionPrice}
                onChange={(event) => setItems((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, promotionPrice: Number(event.target.value) } : row))}
                className={fieldClass}
                aria-label="ราคาโปรโมชั่น"
              />
              <button type="button" disabled={items.length === 1} onClick={() => setItems((rows) => rows.filter((_, rowIndex) => rowIndex !== index))} className="rounded-lg border border-rose-300 px-3 py-2 text-sm text-rose-700 disabled:opacity-40 dark:border-rose-400/40 dark:text-rose-300">ลบ</button>
            </div>
          ))}
          <button type="button" onClick={() => setItems((rows) => [...rows, { key: Date.now(), productId: "", promotionPrice: 0 }])} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 dark:border-white/15 dark:text-slate-200">+ เพิ่มสินค้า</button>
        </div>
        <textarea name="note" maxLength={1000} placeholder="หมายเหตุ" className={`${fieldClass} min-h-20 w-full`} />
        {message ? <p className="text-sm text-slate-600 dark:text-slate-300">{message}</p> : null}
        <button disabled={pending} className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{pending ? "กำลังบันทึก..." : "บันทึก Draft"}</button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900/60">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600 dark:bg-white/5 dark:text-slate-300"><tr><th className="p-3">โปรโมชั่น</th><th className="p-3">ระดับราคา</th><th className="p-3">ช่วงวันที่</th><th className="p-3">สินค้า</th><th className="p-3">สถานะ</th><th className="p-3 text-right">จัดการ</th></tr></thead>
          <tbody>{promotions.map((promotion) => (
            <Fragment key={promotion.id}>
            <tr className="border-t border-slate-100 dark:border-white/10">
              <td className="p-3 font-medium text-slate-900 dark:text-slate-100">{promotion.name}</td>
              <td className="p-3 text-slate-600 dark:text-slate-300">{promotion.priceListName}</td>
              <td className="p-3 text-slate-600 dark:text-slate-300">{promotion.dateRange}</td>
              <td className="p-3 tabular-nums">{promotion.itemCount}</td>
              <td className="p-3">{promotion.status}</td>
              <td className="p-3 text-right"><div className="flex justify-end gap-2">
                <button type="button" onClick={() => setExpandedId((current) => current === promotion.id ? null : promotion.id)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700 dark:border-white/15 dark:text-slate-200">{expandedId === promotion.id ? "ปิด" : "รายละเอียด"}</button>
                {promotion.status === "DRAFT" ? <button disabled={pending} onClick={() => startTransition(async () => {
                  let result = await publishPricePromotion(promotion.id);
                  if (result.belowCostProducts?.length && window.confirm(`สินค้าต่ำกว่าทุน: ${result.belowCostProducts.join(", ")}\nยืนยันเผยแพร่หรือไม่?`)) result = await publishPricePromotion(promotion.id, true);
                  setMessage(result.error ?? "เผยแพร่โปรโมชั่นแล้ว");
                })} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white">เผยแพร่</button> : null}
                {promotion.status !== "CANCELLED" ? <button disabled={pending} onClick={() => startTransition(async () => setMessage((await cancelPricePromotion(promotion.id)).error ?? "ยกเลิกโปรโมชั่นแล้ว"))} className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs text-rose-700 dark:border-rose-400/40 dark:text-rose-300">ยกเลิก</button> : null}
              </div></td>
            </tr>
            {expandedId === promotion.id ? <tr className="border-t border-slate-100 dark:border-white/10"><td colSpan={6} className="p-4">
              <PromotionDetail promotion={promotion} priceLists={priceLists} products={products} pending={pending} run={startTransition} setMessage={setMessage} />
            </td></tr> : null}
            </Fragment>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

function PromotionDetail({ promotion, priceLists, products, pending, run, setMessage }: {
  promotion: PromotionRow;
  priceLists: Option[];
  products: Option[];
  pending: boolean;
  run: TransitionStartFunction;
  setMessage: (message: string) => void;
}) {
  const [draftItems, setDraftItems] = useState<ItemRow[]>(promotion.items.map((item, index) => ({ key: index + 1, productId: item.productId, promotionPrice: item.promotionPrice })));
  if (promotion.status !== "DRAFT") {
    return <div className="space-y-3">
      {promotion.note ? <p className="text-slate-600 dark:text-slate-300">หมายเหตุ: {promotion.note}</p> : null}
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-slate-500 dark:text-slate-400"><th className="py-2">สินค้า</th><th className="py-2 text-right">ราคาปกติ ณ ตอนสร้าง</th><th className="py-2 text-right">ราคาโปรโมชั่น</th></tr></thead><tbody>{promotion.items.map((item) => <tr key={item.productId} className="border-t border-slate-100 dark:border-white/10"><td className="py-2">{item.label}</td><td className="py-2 text-right tabular-nums">{item.normalReferencePrice.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td><td className="py-2 text-right tabular-nums">{item.promotionPrice.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td></tr>)}</tbody></table></div>
    </div>;
  }
  return <form className="space-y-3" onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    run(async () => setMessage((await updatePricePromotionDraft(promotion.id, {
      name: form.get("name"), priceListId: form.get("priceListId"), startDate: form.get("startDate"), endDate: form.get("endDate"), note: form.get("note"),
      items: draftItems.map(({ productId, promotionPrice }) => ({ productId, promotionPrice })),
    })).error ?? "แก้ไข Draft แล้ว"));
  }}>
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
      <input name="name" required defaultValue={promotion.name} className={fieldClass} />
      <select name="priceListId" required defaultValue={promotion.priceListId} className={fieldClass}>{priceLists.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
      <input name="startDate" type="date" required defaultValue={promotion.startDate} className={fieldClass} />
      <input name="endDate" type="date" required defaultValue={promotion.endDate} className={fieldClass} />
    </div>
    {draftItems.map((item, index) => <div key={item.key} className="grid gap-2 md:grid-cols-[1fr_180px_auto]">
      <select required value={item.productId} onChange={(event) => setDraftItems((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, productId: event.target.value } : row))} className={fieldClass}><option value="">เลือกสินค้า</option>{products.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
      <input type="number" min={0} step={0.01} value={item.promotionPrice} onChange={(event) => setDraftItems((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, promotionPrice: Number(event.target.value) } : row))} className={fieldClass} aria-label="ราคาโปรโมชั่น" />
      <button type="button" disabled={draftItems.length === 1} onClick={() => setDraftItems((rows) => rows.filter((_, rowIndex) => rowIndex !== index))} className="rounded-lg border border-rose-300 px-3 py-2 text-sm text-rose-700 disabled:opacity-40 dark:border-rose-400/40 dark:text-rose-300">ลบ</button>
    </div>)}
    <button type="button" onClick={() => setDraftItems((rows) => [...rows, { key: Date.now(), productId: "", promotionPrice: 0 }])} className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-white/15">+ เพิ่มสินค้า</button>
    <textarea name="note" maxLength={1000} defaultValue={promotion.note ?? ""} className={`${fieldClass} min-h-20 w-full`} />
    <button disabled={pending} className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">บันทึกการแก้ไข Draft</button>
  </form>;
}
