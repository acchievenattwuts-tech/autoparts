import type { AuditLog, Prisma } from "@/lib/generated/prisma";
import { AuditAction } from "@/lib/generated/prisma";
import {
  formatDateTimeThai,
  getThailandDateKey,
  parseDateOnlyToEndOfDay,
  parseDateOnlyToStartOfDay,
} from "@/lib/th-date";

export const AUDIT_PAGE_SIZE = 100;
export const AUDIT_ACTION_OPTIONS = Object.values(AuditAction);

const ENTITY_LABELS: Record<string, string> = {
  Adjustment: "ปรับสต็อก",
  AppRole: "บทบาทผู้ใช้",
  BalanceForward: "ยอดยกมา",
  CarBrand: "ยี่ห้อรถ",
  CarModel: "รุ่นรถ",
  CashBankAccount: "บัญชีเงินสด/ธนาคาร",
  CashBankAccountSeed: "ตั้งต้นบัญชีเงินสด/ธนาคาร",
  CashBankAdjustment: "ปรับยอดเงิน",
  CashBankTransfer: "โอนเงินระหว่างบัญชี",
  CompanySettings: "ตั้งค่าร้านค้า",
  ContentPost: "คอนเทนต์ Facebook",
  CreditNote: "ใบลดหนี้",
  Customer: "ลูกค้า",
  Expense: "ค่าใช้จ่าย",
  ExpenseCode: "รหัสค่าใช้จ่าย",
  FactProfit: "กำไรกิจกรรม",
  LineDailySummarySettings: "ตั้งค่า LINE Daily Summary",
  Product: "สินค้า",
  Purchase: "ใบซื้อ",
  PurchaseReturn: "ใบคืนซื้อ",
  Receipt: "ใบรับชำระ",
  ReportExport: "การส่งออกรายงาน",
  Sale: "ใบขาย",
  StockCard: "Stock Card",
  Supplier: "เจ้าหนี้/ซัพพลายเออร์",
  SupplierAdvance: "เงินมัดจำเจ้าหนี้",
  SupplierPayment: "จ่ายชำระเจ้าหนี้",
  User: "ผู้ใช้งาน",
  UserLineRecipient: "ผู้รับ LINE Daily Summary",
  Warranty: "ประกัน",
  WarrantyClaim: "เคลมสินค้า",
};

const staticAuditSourceHref = (href: string): ((entityId: string) => string) => () => href;

const SOURCE_ROUTE_BUILDERS: Record<string, (entityId: string) => string> = {
  Adjustment: staticAuditSourceHref("/admin/stock/adjustments"),
  AppRole: (entityId) => `/admin/roles/${entityId}/edit`,
  BalanceForward: staticAuditSourceHref("/admin/stock/bf"),
  CarBrand: staticAuditSourceHref("/admin/master/car-brands"),
  CarModel: staticAuditSourceHref("/admin/master/car-brands"),
  CashBankAccount: staticAuditSourceHref("/admin/cash-bank"),
  CashBankAccountSeed: staticAuditSourceHref("/admin/cash-bank"),
  CashBankAdjustment: staticAuditSourceHref("/admin/cash-bank/adjustments"),
  CashBankTransfer: staticAuditSourceHref("/admin/cash-bank/transfers"),
  CompanySettings: staticAuditSourceHref("/admin/settings/company"),
  ContentPost: (entityId) => `/admin/content/${entityId}`,
  CreditNote: (entityId) => `/admin/credit-notes/${entityId}`,
  Customer: (entityId) => `/admin/customers/${entityId}/edit`,
  Expense: (entityId) => `/admin/expenses/${entityId}`,
  ExpenseCode: staticAuditSourceHref("/admin/master/expense-codes"),
  LineDailySummarySettings: staticAuditSourceHref("/admin/reports/line-daily-summary"),
  Product: (entityId) => `/admin/products/${entityId}/edit`,
  Purchase: (entityId) => `/admin/purchases/${entityId}`,
  PurchaseReturn: (entityId) => `/admin/purchase-returns/${entityId}`,
  Receipt: (entityId) => `/admin/receipts/${entityId}`,
  ReportExport: staticAuditSourceHref("/admin/reports"),
  Sale: (entityId) => `/admin/sales/${entityId}`,
  StockCard: staticAuditSourceHref("/admin/stock/card"),
  Supplier: staticAuditSourceHref("/admin/master/suppliers"),
  SupplierAdvance: (entityId) => `/admin/supplier-advances/${entityId}`,
  SupplierPayment: (entityId) => `/admin/supplier-payments/${entityId}`,
  User: (entityId) => `/admin/users/${entityId}/edit`,
  UserLineRecipient: staticAuditSourceHref("/admin/reports/line-daily-summary"),
  Warranty: staticAuditSourceHref("/admin/warranties"),
  WarrantyClaim: (entityId) => `/admin/warranty-claims/${entityId}`,
};

const ACTION_LABELS: Record<AuditAction, string> = {
  CANCEL: "ยกเลิก",
  CREATE: "สร้าง",
  DELETE: "ลบ",
  EXPORT: "ส่งออก",
  LOGIN: "เข้าสู่ระบบ",
  LOGIN_FAILED: "เข้าสู่ระบบไม่สำเร็จ",
  LOGOUT: "ออกจากระบบ",
  PASSWORD_CHANGE: "เปลี่ยนรหัสผ่าน",
  PERMISSION_CHANGE: "เปลี่ยนสิทธิ์",
  RECALCULATE: "ประมวลผลใหม่",
  ROLE_CHANGE: "เปลี่ยนบทบาท",
  UPDATE: "แก้ไข",
};

const ACTION_BADGE_CLASSES: Record<AuditAction, string> = {
  CANCEL: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200",
  CREATE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200",
  DELETE: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200",
  EXPORT: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-200",
  LOGIN: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200",
  LOGIN_FAILED: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200",
  LOGOUT: "bg-slate-200 text-slate-700 dark:bg-slate-500/15 dark:text-slate-200",
  PASSWORD_CHANGE: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200",
  PERMISSION_CHANGE: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-200",
  RECALCULATE: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200",
  ROLE_CHANGE: "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-200",
  UPDATE: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200",
};

type SearchParamMap = Record<string, string | undefined>;

type JsonScalar = string | number | boolean | null;
type JsonLike = Prisma.JsonValue;

export type AuditLogFilters = {
  user: string;
  action: AuditAction | "";
  entityType: string;
  entityRef: string;
  startDate: string;
  endDate: string;
  ready: boolean;
  page: number;
};

export type AuditDiffRow = {
  path: string;
  before: string;
  after: string;
};

function isJsonObject(value: JsonLike): value is Prisma.JsonObject {
  return Boolean(value) && !Array.isArray(value) && typeof value === "object";
}

function normalizeString(value: string | undefined): string {
  return value?.trim() ?? "";
}

export function parseAuditLogSearchParams(params: SearchParamMap): AuditLogFilters {
  const defaultDate = getThailandDateKey();
  const action = normalizeString(params.action);

  return {
    user: normalizeString(params.user),
    action: AUDIT_ACTION_OPTIONS.includes(action as AuditAction)
      ? (action as AuditAction)
      : "",
    entityType: normalizeString(params.entityType),
    entityRef: normalizeString(params.entityRef),
    startDate: params.startDate === undefined ? defaultDate : normalizeString(params.startDate),
    endDate: params.endDate === undefined ? defaultDate : normalizeString(params.endDate),
    ready: params.ready === "1",
    page: Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1),
  };
}

export function buildAuditLogListHref(filters: AuditLogFilters, page = filters.page): string {
  const nextParams = new URLSearchParams();

  nextParams.set("user", filters.user);
  nextParams.set("action", filters.action);
  nextParams.set("entityType", filters.entityType);
  nextParams.set("entityRef", filters.entityRef);
  nextParams.set("startDate", filters.startDate);
  nextParams.set("endDate", filters.endDate);
  nextParams.set("page", String(page));
  nextParams.set("ready", filters.ready ? "1" : "0");

  return `/admin/audit-log?${nextParams.toString()}`;
}

export function buildAuditLogWhere(filters: AuditLogFilters): Prisma.AuditLogWhereInput | undefined {
  if (!filters.ready) {
    return undefined;
  }

  const createdAt: Prisma.DateTimeFilter = {};

  if (filters.startDate) {
    createdAt.gte = parseDateOnlyToStartOfDay(filters.startDate);
  }

  if (filters.endDate) {
    createdAt.lte = parseDateOnlyToEndOfDay(filters.endDate);
  }

  return {
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.user
      ? {
          OR: [
            { userName: { contains: filters.user, mode: "insensitive" } },
            { userId: { contains: filters.user, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(filters.entityType
      ? { entityType: { contains: filters.entityType, mode: "insensitive" } }
      : {}),
    ...(filters.entityRef
      ? {
          AND: [
            {
              OR: [
                { entityRef: { contains: filters.entityRef, mode: "insensitive" } },
                { entityId: { contains: filters.entityRef, mode: "insensitive" } },
              ],
            },
          ],
        }
      : {}),
    ...(filters.startDate || filters.endDate ? { createdAt } : {}),
  };
}

export function getAuditActionLabel(action: AuditAction): string {
  return ACTION_LABELS[action] ?? action;
}

export function getAuditActionBadgeClass(action: AuditAction): string {
  return ACTION_BADGE_CLASSES[action] ?? ACTION_BADGE_CLASSES.UPDATE;
}

export function getAuditEntityLabel(entityType: string): string {
  return ENTITY_LABELS[entityType] ?? entityType;
}

export function getAuditSourceHref(
  entityType: string,
  entityId: string | null,
): string | null {
  if (!entityId) {
    return null;
  }

  const builder = SOURCE_ROUTE_BUILDERS[entityType];
  return builder ? builder(entityId) : null;
}

function formatScalar(value: JsonScalar): string {
  if (value === null) {
    return "-";
  }

  if (typeof value === "string") {
    return value;
  }

  return String(value);
}

function formatJsonValue(value: JsonLike): string {
  if (value === null) {
    return "-";
  }

  if (Array.isArray(value) || isJsonObject(value)) {
    return JSON.stringify(value, null, 2);
  }

  return formatScalar(value);
}

function collectDiffRows(
  beforeValue: JsonLike,
  afterValue: JsonLike,
  prefix: string,
): AuditDiffRow[] {
  if (isJsonObject(beforeValue) || isJsonObject(afterValue)) {
    const beforeObject = isJsonObject(beforeValue) ? beforeValue : {};
    const afterObject = isJsonObject(afterValue) ? afterValue : {};
    const keys = new Set([...Object.keys(beforeObject), ...Object.keys(afterObject)]);

    const rows = [...keys]
      .sort((left, right) => left.localeCompare(right))
      .flatMap((key) => {
        const path = prefix ? `${prefix}.${key}` : key;
        return collectDiffRows(
          (beforeObject[key] ?? null) as JsonLike,
          (afterObject[key] ?? null) as JsonLike,
          path,
        );
      });

    if (rows.length > 0) {
      return rows;
    }
  }

  if (
    JSON.stringify(beforeValue ?? null) === JSON.stringify(afterValue ?? null) &&
    prefix !== ""
  ) {
    return [];
  }

  return [
    {
      path: prefix || "value",
      before: formatJsonValue(beforeValue ?? null),
      after: formatJsonValue(afterValue ?? null),
    },
  ];
}

export function buildAuditDiffRows(
  beforeValue: AuditLog["before"],
  afterValue: AuditLog["after"],
): AuditDiffRow[] {
  return collectDiffRows(
    (beforeValue ?? null) as JsonLike,
    (afterValue ?? null) as JsonLike,
    "",
  );
}

export function formatAuditJson(value: AuditLog["meta"] | AuditLog["before"] | AuditLog["after"]): string {
  if (value === null) {
    return "-";
  }

  return JSON.stringify(value, null, 2);
}

export function formatAuditTimestamp(value: Date): string {
  return formatDateTimeThai(value);
}
