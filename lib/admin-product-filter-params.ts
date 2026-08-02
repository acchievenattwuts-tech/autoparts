/**
 * ตัวกรองสินค้าฝั่งแอดมิน (/admin/products และ /admin/products/search)
 *
 * `categoryId` เป็น param แบบ "ซ้ำได้" — เลือกได้หลายหมวดพร้อมกัน
 * (`?categoryId=a&categoryId=b`) โดยยังคงชื่อ param เดิมไว้ ลิงก์/bookmark
 * ที่ส่งมาแค่ค่าเดียวจึงยังใช้งานได้ตามปกติ
 */

import { resolveCarYearRangeFilterStrings } from "@/lib/car-year-range";

/** ค่าที่ Next.js ส่งมาใน searchParams — ซ้ำ key ได้จึงอาจเป็น array */
export type AdminProductFilterRawValue = string | string[] | undefined;

export type AdminProductFilterParams = {
  search?: string;
  categoryIds?: string[];
  brandId?: string;
  carBrandId?: string;
  carModelId?: string;
  yearMin?: string;
  yearMax?: string;
  stockStatus?: string;
  statusFilter?: string;
  trackingFilter?: string;
};

/** คู่ [key, value] สำหรับสร้าง URLSearchParams — รองรับ key ซ้ำ */
export type AdminProductFilterQueryEntries = [string, string][];

const normalizeParam = (value?: AdminProductFilterRawValue): string | undefined => {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
};

/** แปลงค่าที่ซ้ำ key ได้ให้เป็น array ที่ตัดค่าว่างและค่าซ้ำออกแล้ว */
export const normalizeMultiParam = (value?: AdminProductFilterRawValue): string[] => {
  const raw = value === undefined ? [] : Array.isArray(value) ? value : [value];
  return Array.from(
    new Set(raw.flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean)),
  );
};

export function parseAdminProductFilterParams(
  params: Record<string, AdminProductFilterRawValue>,
): AdminProductFilterParams {
  const categoryIds = normalizeMultiParam(params.categoryId);
  // ปีรถ: กรอกด้านเดียว = ปีนั้นปีเดียว (ต้องกรอกครบ 2 ช่องถึงจะเป็นช่วง) — ดู
  // lib/car-year-range.ts; ทำที่ชั้น parse เพื่อให้ chip ที่แสดงกับ query ที่รันตรงกัน
  const yearRange = resolveCarYearRangeFilterStrings(
    normalizeParam(params.yearMin),
    normalizeParam(params.yearMax),
  );

  const parsed: AdminProductFilterParams = {
    search: normalizeParam(params.search),
    ...(categoryIds.length > 0 ? { categoryIds } : {}),
    brandId: normalizeParam(params.brandId),
    carBrandId: normalizeParam(params.carBrandId),
    carModelId: normalizeParam(params.carModelId),
    yearMin: yearRange.yearMin,
    yearMax: yearRange.yearMax,
    stockStatus: normalizeParam(params.stockStatus),
    statusFilter: normalizeParam(params.statusFilter),
    trackingFilter: normalizeParam(params.trackingFilter),
  };

  return Object.fromEntries(
    Object.entries(parsed).flatMap(([key, value]) =>
      value === undefined || (Array.isArray(value) && value.length === 0) ? [] : [[key, value]],
    ),
  ) as AdminProductFilterParams;
}

export function buildAdminProductFilterSearchParams(
  params: AdminProductFilterParams & { page?: string },
): AdminProductFilterQueryEntries {
  const singles: [string, string | undefined][] = [
    ["search", params.search],
    ["page", params.page],
    ["brandId", params.brandId],
    ["carBrandId", params.carBrandId],
    ["carModelId", params.carModelId],
    ["yearMin", params.yearMin],
    ["yearMax", params.yearMax],
    ["stockStatus", params.stockStatus],
    ["statusFilter", params.statusFilter],
    ["trackingFilter", params.trackingFilter],
  ];

  const entries: AdminProductFilterQueryEntries = [];
  for (const [key, value] of singles) {
    const normalized = normalizeParam(value);
    if (normalized) entries.push([key, normalized]);
    // แทรกหมวดหมู่ต่อจาก search เพื่อให้ลำดับ param ใน URL คงที่และอ่านง่าย
    if (key === "page") {
      for (const categoryId of params.categoryIds ?? []) {
        entries.push(["categoryId", categoryId]);
      }
    }
  }

  return entries;
}

/** query string พร้อมใช้ (ไม่มี `?` นำหน้า) */
export function buildAdminProductFilterQueryString(
  params: AdminProductFilterParams & { page?: string },
): string {
  return new URLSearchParams(buildAdminProductFilterSearchParams(params)).toString();
}
