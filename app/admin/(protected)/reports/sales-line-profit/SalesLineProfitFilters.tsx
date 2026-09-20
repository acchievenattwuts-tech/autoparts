"use client";

import { useState } from "react";
import Link from "next/link";
import { FileSpreadsheet } from "lucide-react";
import AdminExportLink from "@/components/shared/AdminExportLink";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import MultiSelectFilter, { type MultiSelectOption } from "@/components/shared/MultiSelectFilter";
import SearchableSelectFilter from "@/components/shared/SearchableSelectFilter";

const inputClass =
  "mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500/30 dark:border-white/20 dark:bg-slate-900 dark:text-slate-100";

export default function SalesLineProfitFilters({
  defaults,
  customerOptions,
  categoryOptions,
  productOptions,
  exportHref,
}: {
  defaults: {
    from: string;
    to: string;
    channel: string;
    customerIds: string[];
    categoryId: string;
    productCodeFrom: string;
    productCodeTo: string;
    productIds: string[];
    status: string;
    includeReturns: boolean;
  };
  customerOptions: MultiSelectOption[];
  categoryOptions: Array<{ id: string; label: string }>;
  productOptions: MultiSelectOption[];
  exportHref: string;
}) {
  const [customerIds, setCustomerIds] = useState(defaults.customerIds);
  const [productIds, setProductIds] = useState(defaults.productIds);
  const [includeReturns, setIncludeReturns] = useState(defaults.includeReturns);

  return (
    <AdminSearchForm
      method="GET"
      action="/admin/reports/sales-line-profit"
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-[#101b2e]"
    >
      <input type="hidden" name="customerIds" value={customerIds.join(",")} />
      <input type="hidden" name="productIds" value={productIds.join(",")} />
      <input type="hidden" name="includeReturns" value={includeReturns ? "1" : "0"} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-sm text-slate-600 dark:text-slate-300">
          ตั้งแต่วันที่
          <input type="date" name="from" defaultValue={defaults.from} className={inputClass} />
        </label>
        <label className="text-sm text-slate-600 dark:text-slate-300">
          ถึงวันที่
          <input type="date" name="to" defaultValue={defaults.to} className={inputClass} />
        </label>
        <label className="text-sm text-slate-600 dark:text-slate-300">
          ช่องทาง
          <select name="channel" defaultValue={defaults.channel} className={inputClass}>
            <option value="ALL">ทุกช่องทาง</option>
            <option value="STORE">หน้าร้าน</option>
            <option value="SHOPEE">Shopee</option>
            <option value="LAZADA">Lazada</option>
          </select>
        </label>
        <label className="text-sm text-slate-600 dark:text-slate-300">
          สถานะเอกสาร
          <select name="status" defaultValue={defaults.status} className={inputClass}>
            <option value="ACTIVE">ใช้งาน</option>
            <option value="CANCELLED">ยกเลิก (ตรวจสอบย้อนหลัง)</option>
          </select>
        </label>
        <label className="text-sm text-slate-600 dark:text-slate-300">
          หมวดสินค้า
          <span className="mt-1 block">
            <SearchableSelectFilter
              name="categoryId"
              defaultValue={defaults.categoryId}
              options={categoryOptions}
              placeholder="ทุกหมวด"
            />
          </span>
        </label>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <label className="text-sm text-slate-600 dark:text-slate-300">
          ลูกค้า
          <span className="mt-1 block">
            <MultiSelectFilter
              options={customerOptions}
              values={customerIds}
              onChange={setCustomerIds}
              placeholder="ลูกค้าทั้งหมด"
              searchPlaceholder="ค้นหารหัสหรือชื่อลูกค้า..."
            />
          </span>
        </label>
        <label className="text-sm text-slate-600 dark:text-slate-300">
          สินค้าที่ต้องการดู
          <span className="mt-1 block">
            <MultiSelectFilter
              options={productOptions}
              values={productIds}
              onChange={setProductIds}
              placeholder="สินค้าทั้งหมด"
              searchPlaceholder="ค้นหารหัสหรือชื่อสินค้า..."
            />
          </span>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
        <label className="text-sm text-slate-600 dark:text-slate-300">
          รหัสสินค้า From
          <input
            name="productCodeFrom"
            defaultValue={defaults.productCodeFrom}
            maxLength={100}
            className={inputClass}
          />
        </label>
        <label className="text-sm text-slate-600 dark:text-slate-300">
          รหัสสินค้า To
          <input
            name="productCodeTo"
            defaultValue={defaults.productCodeTo}
            maxLength={100}
            className={inputClass}
          />
        </label>
        <label className="flex min-h-10 items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={includeReturns}
            onChange={(event) => setIncludeReturns(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          รวมใบลดหนี้/คืนสินค้าเป็นแถวติดลบ
        </label>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        มุมกำไรต่อบิลแสดงยอดทั้งบิลของเอกสารที่มีสินค้าตรงเงื่อนไข ส่วนมุมกำไรต่อสินค้าแสดงเฉพาะรายการที่ตรงหมวด ช่วงรหัส และสินค้าที่เลือกแบบ AND
      </p>

      <div className="flex flex-wrap gap-2">
        <AdminSearchSubmitButton className="min-h-10 rounded-lg bg-[#1e3a5f] px-4 text-sm font-medium text-white hover:bg-[#163055] dark:bg-sky-600 dark:hover:bg-sky-500">
          แสดงรายงาน
        </AdminSearchSubmitButton>
        <Link
          href="/admin/reports/sales-line-profit"
          className="inline-flex min-h-10 items-center rounded-lg bg-slate-100 px-4 text-sm font-medium text-slate-700 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
        >
          ล้างตัวกรอง
        </Link>
        <AdminExportLink
          href={exportHref}
          className="ml-auto inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700"
        >
          <FileSpreadsheet size={16} /> Excel
        </AdminExportLink>
      </div>
    </AdminSearchForm>
  );
}
