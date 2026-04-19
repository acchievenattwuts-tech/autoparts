import { db } from "@/lib/db";

const globalForAccessControl = globalThis as typeof globalThis & {
  accessControlSetupPromise?: Promise<void>;
};

type PermissionCatalogItem = {
  key: string;
  group: string;
  label: string;
  description?: string;
};

export const PERMISSION_CATALOG: readonly PermissionCatalogItem[] = [
  { key: "dashboard.view", group: "ภาพรวม", label: "ดู Dashboard" },

  { key: "products.view", group: "ข้อมูลหลัก", label: "ดูสินค้า" },
  { key: "products.create", group: "ข้อมูลหลัก", label: "เพิ่มสินค้า" },
  { key: "products.update", group: "ข้อมูลหลัก", label: "แก้ไขสินค้า" },
  { key: "products.cancel", group: "ข้อมูลหลัก", label: "ยกเลิกสินค้า" },
  { key: "products.manage", group: "ข้อมูลหลัก", label: "จัดการสินค้า" },

  { key: "customers.view", group: "ข้อมูลหลัก", label: "ดูลูกค้า" },
  { key: "customers.create", group: "ข้อมูลหลัก", label: "เพิ่มลูกค้า" },
  { key: "customers.update", group: "ข้อมูลหลัก", label: "แก้ไขลูกค้า" },
  { key: "customers.cancel", group: "ข้อมูลหลัก", label: "ยกเลิกลูกค้า" },
  { key: "customers.manage", group: "ข้อมูลหลัก", label: "จัดการลูกค้า" },

  { key: "master.view", group: "ข้อมูลหลัก", label: "ดูข้อมูลหลัก" },
  { key: "master.create", group: "ข้อมูลหลัก", label: "เพิ่มข้อมูลหลัก" },
  { key: "master.update", group: "ข้อมูลหลัก", label: "แก้ไขข้อมูลหลัก" },
  { key: "master.cancel", group: "ข้อมูลหลัก", label: "ยกเลิกข้อมูลหลัก" },
  { key: "master.manage", group: "ข้อมูลหลัก", label: "จัดการข้อมูลหลัก" },

  { key: "stock.bf.view", group: "สต็อก", label: "ดู BF" },
  { key: "stock.bf.create", group: "สต็อก", label: "เพิ่ม BF" },
  { key: "stock.bf.cancel", group: "สต็อก", label: "ยกเลิก BF" },
  { key: "stock.adjustments.view", group: "สต็อก", label: "ดูปรับสต็อก" },
  { key: "stock.adjustments.create", group: "สต็อก", label: "เพิ่มปรับสต็อก" },
  { key: "stock.adjustments.cancel", group: "สต็อก", label: "ยกเลิกปรับสต็อก" },
  { key: "stock.card.view", group: "สต็อก", label: "ดู Stock Card" },
  { key: "stock.card.manage", group: "สต็อก", label: "จัดการ Stock Card" },
  { key: "lot_reports.view", group: "สต็อก", label: "ดูรายงาน Lot" },

  { key: "purchases.view", group: "ระบบงาน", label: "ดูซื้อสินค้า" },
  { key: "purchases.create", group: "ระบบงาน", label: "เพิ่มซื้อสินค้า" },
  { key: "purchases.update", group: "ระบบงาน", label: "แก้ไขซื้อสินค้า" },
  { key: "purchases.cancel", group: "ระบบงาน", label: "ยกเลิกซื้อสินค้า" },

  { key: "purchase_returns.view", group: "ระบบงาน", label: "ดู CN ซื้อ" },
  { key: "purchase_returns.create", group: "ระบบงาน", label: "เพิ่ม CN ซื้อ" },
  { key: "purchase_returns.update", group: "ระบบงาน", label: "แก้ไข CN ซื้อ" },
  { key: "purchase_returns.cancel", group: "ระบบงาน", label: "ยกเลิก CN ซื้อ" },

  { key: "sales.view", group: "ระบบงาน", label: "ดูบันทึกการขาย" },
  { key: "sales.create", group: "ระบบงาน", label: "เพิ่มบันทึกการขาย" },
  { key: "sales.update", group: "ระบบงาน", label: "แก้ไขบันทึกการขาย" },
  { key: "sales.cancel", group: "ระบบงาน", label: "ยกเลิกบันทึกการขาย" },

  { key: "credit_notes.view", group: "ระบบงาน", label: "ดู CN ขาย" },
  { key: "credit_notes.create", group: "ระบบงาน", label: "เพิ่ม CN ขาย" },
  { key: "credit_notes.update", group: "ระบบงาน", label: "แก้ไข CN ขาย" },
  { key: "credit_notes.cancel", group: "ระบบงาน", label: "ยกเลิก CN ขาย" },

  { key: "receipts.view", group: "ระบบงาน", label: "ดูรับชำระ" },
  { key: "receipts.create", group: "ระบบงาน", label: "เพิ่มรับชำระ" },
  { key: "receipts.update", group: "ระบบงาน", label: "แก้ไขรับชำระ" },
  { key: "receipts.cancel", group: "ระบบงาน", label: "ยกเลิกรับชำระ" },

  { key: "supplier_advances.view", group: "ระบบงาน", label: "ดูเงินมัดจำซัพพลายเออร์" },
  { key: "supplier_advances.create", group: "ระบบงาน", label: "เพิ่มเงินมัดจำซัพพลายเออร์" },
  { key: "supplier_advances.update", group: "ระบบงาน", label: "แก้ไขเงินมัดจำซัพพลายเออร์" },
  { key: "supplier_advances.cancel", group: "ระบบงาน", label: "ยกเลิกเงินมัดจำซัพพลายเออร์" },
  { key: "supplier_payments.view", group: "ระบบงาน", label: "ดูจ่ายชำระซัพพลายเออร์" },
  { key: "supplier_payments.create", group: "ระบบงาน", label: "เพิ่มจ่ายชำระซัพพลายเออร์" },
  { key: "supplier_payments.update", group: "ระบบงาน", label: "แก้ไขจ่ายชำระซัพพลายเออร์" },
  { key: "supplier_payments.cancel", group: "ระบบงาน", label: "ยกเลิกจ่ายชำระซัพพลายเออร์" },

  { key: "warranties.view", group: "ระบบงาน", label: "ดูประกัน" },
  { key: "warranties.create", group: "ระบบงาน", label: "เพิ่มประกัน" },
  { key: "warranties.update", group: "ระบบงาน", label: "แก้ไขประกัน" },
  { key: "warranties.manage", group: "ระบบงาน", label: "จัดการประกัน" },

  { key: "warranty_claims.view", group: "ระบบงาน", label: "ดูใบเคลมสินค้า" },
  { key: "warranty_claims.create", group: "ระบบงาน", label: "เปิดใบเคลมสินค้า" },
  { key: "warranty_claims.update", group: "ระบบงาน", label: "อัปเดตสถานะเคลม" },

  { key: "expenses.view", group: "ระบบงาน", label: "ดูค่าใช้จ่าย" },
  { key: "expenses.create", group: "ระบบงาน", label: "เพิ่มค่าใช้จ่าย" },
  { key: "expenses.update", group: "ระบบงาน", label: "แก้ไขค่าใช้จ่าย" },
  { key: "expenses.cancel", group: "ระบบงาน", label: "ยกเลิกค่าใช้จ่าย" },

  { key: "cash_bank.view", group: "การเงิน", label: "ดูบัญชีเงินสดและธนาคาร" },
  { key: "cash_bank.manage", group: "การเงิน", label: "จัดการบัญชีเงินสดและธนาคาร" },
  { key: "cash_bank.transfers.view", group: "การเงิน", label: "ดูโอนเงินระหว่างบัญชี" },
  { key: "cash_bank.transfers.create", group: "การเงิน", label: "เพิ่มโอนเงินระหว่างบัญชี" },
  { key: "cash_bank.transfers.cancel", group: "การเงิน", label: "ยกเลิกโอนเงินระหว่างบัญชี" },
  { key: "cash_bank.adjustments.view", group: "การเงิน", label: "ดูปรับยอดเงิน" },
  { key: "cash_bank.adjustments.create", group: "การเงิน", label: "เพิ่มปรับยอดเงิน" },
  { key: "cash_bank.adjustments.update", group: "การเงิน", label: "แก้ไขปรับยอดเงิน" },
  { key: "cash_bank.adjustments.cancel", group: "การเงิน", label: "ยกเลิกปรับยอดเงิน" },

  { key: "delivery.view",   group: "ระบบงาน", label: "ดูคิวจัดส่ง" },
  { key: "delivery.update", group: "ระบบงาน", label: "อัปเดตสถานะจัดส่ง" },

  { key: "reports.view", group: "รายงาน", label: "ดูรายงาน" },

  { key: "content.view", group: "การตลาด", label: "ดูคอนเทนต์ Facebook" },
  { key: "content.create", group: "การตลาด", label: "สร้าง draft คอนเทนต์ Facebook" },
  { key: "content.update", group: "การตลาด", label: "แก้ไขและส่งอนุมัติคอนเทนต์ Facebook" },
  { key: "content.manage", group: "การตลาด", label: "อนุมัติและโพสต์คอนเทนต์ Facebook" },

  { key: "settings.company.view", group: "ระบบ", label: "ดูตั้งค่าร้าน" },
  { key: "settings.company.manage", group: "ระบบ", label: "จัดการตั้งค่าร้าน" },
  { key: "admin.users.view", group: "ระบบ", label: "ดูผู้ใช้" },
  { key: "admin.users.create", group: "ระบบ", label: "เพิ่มผู้ใช้" },
  { key: "admin.users.update", group: "ระบบ", label: "แก้ไขผู้ใช้" },
  { key: "admin.users.manage", group: "ระบบ", label: "จัดการผู้ใช้" },
  { key: "admin.roles.view", group: "ระบบ", label: "ดูบทบาทและสิทธิ์" },
  { key: "admin.roles.manage", group: "ระบบ", label: "จัดการบทบาทและสิทธิ์" },
] as const;

export type PermissionKey = (typeof PERMISSION_CATALOG)[number]["key"];

type RoleTemplate = {
  name: string;
  description: string;
  isSystem: boolean;
  permissions: PermissionKey[];
};

const ALL_PERMISSION_KEYS = PERMISSION_CATALOG.map((permission) => permission.key);

const STAFF_OPERATIONS_PERMISSIONS: PermissionKey[] = [
  "dashboard.view",
  "customers.view",
  "customers.create",
  "customers.update",
  "products.view",
  "purchases.view",
  "purchases.create",
  "purchases.update",
  "purchase_returns.view",
  "purchase_returns.create",
  "purchase_returns.update",
  "sales.view",
  "sales.create",
  "sales.update",
  "credit_notes.view",
  "credit_notes.create",
  "credit_notes.update",
  "receipts.view",
  "receipts.create",
  "receipts.update",
  "supplier_advances.view",
  "supplier_advances.create",
  "supplier_advances.update",
  "supplier_payments.view",
  "supplier_payments.create",
  "supplier_payments.update",
  "warranties.view",
  "warranty_claims.view",
  "warranty_claims.create",
  "warranty_claims.update",
  "expenses.view",
  "expenses.create",
  "expenses.update",
  "cash_bank.view",
  "cash_bank.transfers.view",
  "cash_bank.transfers.create",
  "cash_bank.transfers.cancel",
  "cash_bank.adjustments.view",
  "cash_bank.adjustments.create",
  "cash_bank.adjustments.cancel",
  "delivery.view",
  "delivery.update",
  "lot_reports.view",
  "content.view",
  "content.create",
  "content.update",
  "content.manage",
];

const STAFF_VIEWER_PERMISSIONS: PermissionKey[] = [
  "dashboard.view",
  "products.view",
  "customers.view",
  "master.view",
  "stock.bf.view",
  "stock.adjustments.view",
  "stock.card.view",
  "lot_reports.view",
  "purchases.view",
  "purchase_returns.view",
  "sales.view",
  "credit_notes.view",
  "receipts.view",
  "supplier_advances.view",
  "supplier_payments.view",
  "warranties.view",
  "warranty_claims.view",
  "expenses.view",
  "cash_bank.view",
  "cash_bank.transfers.view",
  "cash_bank.adjustments.view",
  "reports.view",
  "delivery.view",
  "content.view",
];

const DEFAULT_ROLE_TEMPLATES: RoleTemplate[] = [
  {
    name: "ADMIN",
    description: "เข้าถึงและจัดการทุกเมนูในระบบ",
    isSystem: true,
    permissions: ALL_PERMISSION_KEYS,
  },
  {
    name: "STAFF_OPERATIONS",
    description: "ทำงานเอกสารประจำวันได้ แต่ไม่แตะการตั้งค่าระบบและผู้ใช้",
    isSystem: true,
    permissions: STAFF_OPERATIONS_PERMISSIONS,
  },
  {
    name: "STAFF_VIEWER",
    description: "ดูข้อมูลได้อย่างเดียว",
    isSystem: true,
    permissions: STAFF_VIEWER_PERMISSIONS,
  },
];

export const ALL_MENU_PERMISSION_KEYS = ALL_PERMISSION_KEYS;

export const ADMIN_ROUTE_RULES: Array<{ prefix: string; permission: PermissionKey | null }> = [
  { prefix: "/admin/profile/change-password", permission: null },
  { prefix: "/admin/users", permission: "admin.users.view" },
  { prefix: "/admin/roles", permission: "admin.roles.view" },
  { prefix: "/admin/products", permission: "products.view" },
  { prefix: "/admin/customers", permission: "customers.view" },
  { prefix: "/admin/master", permission: "master.view" },
  { prefix: "/admin/stock/bf", permission: "stock.bf.view" },
  { prefix: "/admin/stock/adjustments", permission: "stock.adjustments.view" },
  { prefix: "/admin/stock/card-lot", permission: "lot_reports.view" },
  { prefix: "/admin/stock/lot", permission: "lot_reports.view" },
  { prefix: "/admin/stock/card", permission: "stock.card.view" },
  { prefix: "/admin/lots", permission: "lot_reports.view" },
  { prefix: "/admin/purchases", permission: "purchases.view" },
  { prefix: "/admin/purchase-returns", permission: "purchase_returns.view" },
  { prefix: "/admin/delivery", permission: "delivery.view" },
  { prefix: "/admin/content/approval-queue", permission: "content.view" },
  { prefix: "/admin/content", permission: "content.view" },
  { prefix: "/admin/sales", permission: "sales.view" },
  { prefix: "/admin/credit-notes", permission: "credit_notes.view" },
  { prefix: "/admin/receipts", permission: "receipts.view" },
  { prefix: "/admin/supplier-advances", permission: "supplier_advances.view" },
  { prefix: "/admin/supplier-payments", permission: "supplier_payments.view" },
  { prefix: "/admin/warranties", permission: "warranties.view" },
  { prefix: "/admin/warranty-claims", permission: "warranty_claims.view" },
  { prefix: "/admin/expenses", permission: "expenses.view" },
  { prefix: "/admin/cash-bank/ledger", permission: "cash_bank.view" },
  { prefix: "/admin/cash-bank/transfers", permission: "cash_bank.transfers.view" },
  { prefix: "/admin/cash-bank/adjustments", permission: "cash_bank.adjustments.view" },
  { prefix: "/admin/cash-bank", permission: "cash_bank.view" },
  { prefix: "/admin/reports", permission: "reports.view" },
  { prefix: "/admin/settings/company", permission: "settings.company.view" },
  { prefix: "/admin", permission: "dashboard.view" },
];

export async function ensureAccessControlSetup(): Promise<void> {
  // Fast path: check if all catalog keys exist in DB (handles additions gracefully)
  const existingCount = await db.permission.count({
    where: { key: { in: ALL_PERMISSION_KEYS } },
  });
  if (existingCount >= PERMISSION_CATALOG.length) return;

  // Bulk-insert missing permissions (skipDuplicates handles concurrent calls)
  await db.permission.createMany({
    data: PERMISSION_CATALOG.map((p) => ({
      key:         p.key,
      group:       p.group,
      label:       p.label,
      description: p.description ?? null,
    })),
    skipDuplicates: true,
  });

  // Fetch all permission ids in one query
  const permissionMap = new Map(
    (await db.permission.findMany({
      where:  { key: { in: ALL_PERMISSION_KEYS } },
      select: { id: true, key: true },
    })).map((p) => [p.key, p.id])
  );

  // Create default roles if they don't exist yet
  for (const roleTemplate of DEFAULT_ROLE_TEMPLATES) {
    const role = await db.appRole.upsert({
      where:  { name: roleTemplate.name },
      update: {},
      create: {
        name:        roleTemplate.name,
        description: roleTemplate.description,
        isSystem:    roleTemplate.isSystem,
      },
      select: { id: true },
    });

    const permissionIds = roleTemplate.permissions
      .map((key) => permissionMap.get(key))
      .filter((id): id is string => typeof id === "string");

    if (permissionIds.length === 0) continue;

    await db.appRolePermission.createMany({
      data: permissionIds.map((permissionId) => ({
        appRoleId: role.id,
        permissionId,
      })),
      skipDuplicates: true,
    });
  }
}

export function ensureAccessControlSetupOnce(): Promise<void> {
  if (!globalForAccessControl.accessControlSetupPromise) {
    globalForAccessControl.accessControlSetupPromise = ensureAccessControlSetup().catch((error) => {
      globalForAccessControl.accessControlSetupPromise = undefined;
      throw error;
    });
  }

  return globalForAccessControl.accessControlSetupPromise;
}

export async function getUserPermissionKeys(userId: string): Promise<PermissionKey[]> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      appRole: {
        select: {
          permissions: {
            select: {
              permission: {
                select: { key: true },
              },
            },
          },
        },
      },
    },
  });

  if (!user) return [];
  if (user.role === "ADMIN") return [...ALL_PERMISSION_KEYS];

  return (
    user.appRole?.permissions
      .map((item) => item.permission.key)
      .filter((permissionKey): permissionKey is PermissionKey =>
        ALL_PERMISSION_KEYS.includes(permissionKey as PermissionKey)
      ) ?? []
  );
}

export function getAllPermissionKeys(): PermissionKey[] {
  return [...ALL_PERMISSION_KEYS];
}

export function hasPermissionAccess(
  role: string | null | undefined,
  permissions: readonly string[] | null | undefined,
  permission: PermissionKey
): boolean {
  if (role === "ADMIN") return true;
  return Array.isArray(permissions) && permissions.includes(permission);
}

export function hasAnyPermissionAccess(
  role: string | null | undefined,
  permissions: readonly string[] | null | undefined,
  requiredPermissions: readonly PermissionKey[]
): boolean {
  if (role === "ADMIN") return true;
  if (!Array.isArray(permissions)) return false;
  return requiredPermissions.some((permission) => permissions.includes(permission));
}

export function getRoutePermission(pathname: string): PermissionKey | null | undefined {
  if (pathname === "/admin/products/new") return "products.create";
  if (/^\/admin\/products\/[^/]+\/edit$/.test(pathname)) return "products.update";
  if (pathname === "/admin/customers/new") return "customers.create";
  if (/^\/admin\/customers\/[^/]+\/edit$/.test(pathname)) return "customers.update";
  if (pathname === "/admin/purchases/new") return "purchases.create";
  if (/^\/admin\/purchases\/[^/]+\/edit$/.test(pathname)) return "purchases.update";
  if (pathname === "/admin/purchase-returns/new") return "purchase_returns.create";
  if (/^\/admin\/purchase-returns\/[^/]+\/edit$/.test(pathname)) return "purchase_returns.update";
  if (pathname === "/admin/sales/new") return "sales.create";
  if (/^\/admin\/sales\/[^/]+\/edit$/.test(pathname)) return "sales.update";
  if (pathname === "/admin/credit-notes/new") return "credit_notes.create";
  if (/^\/admin\/credit-notes\/[^/]+\/edit$/.test(pathname)) return "credit_notes.update";
  if (pathname === "/admin/receipts/new") return "receipts.create";
  if (/^\/admin\/receipts\/[^/]+\/edit$/.test(pathname)) return "receipts.update";
  if (pathname === "/admin/supplier-advances/new") return "supplier_advances.create";
  if (/^\/admin\/supplier-advances\/[^/]+\/edit$/.test(pathname)) return "supplier_advances.update";
  if (pathname === "/admin/supplier-payments/new") return "supplier_payments.create";
  if (/^\/admin\/supplier-payments\/[^/]+\/edit$/.test(pathname)) return "supplier_payments.update";
  if (pathname === "/admin/expenses/new") return "expenses.create";
  if (/^\/admin\/expenses\/[^/]+\/edit$/.test(pathname)) return "expenses.update";
  if (pathname === "/admin/cash-bank") return "cash_bank.view";
  if (pathname === "/admin/cash-bank/ledger") return "cash_bank.view";
  if (pathname === "/admin/cash-bank/transfers") return "cash_bank.transfers.view";
  if (pathname === "/admin/cash-bank/adjustments") return "cash_bank.adjustments.view";
  if (pathname === "/admin/warranties/new") return "warranties.create";
  if (pathname === "/admin/warranty-claims/new") return "warranty_claims.create";
  if (pathname === "/admin/content") return "content.view";
  if (pathname === "/admin/content/approval-queue") return "content.view";
  if (/^\/admin\/content\/[^/]+$/.test(pathname)) return "content.view";
  if (pathname === "/admin/users/new") return "admin.users.create";
  if (/^\/admin\/users\/[^/]+\/edit$/.test(pathname)) return "admin.users.update";
  if (pathname === "/admin/roles/new") return "admin.roles.manage";
  if (/^\/admin\/roles\/[^/]+\/edit$/.test(pathname)) return "admin.roles.manage";

  const rule = ADMIN_ROUTE_RULES.find((item) => pathname.startsWith(item.prefix));
  return rule ? rule.permission : undefined;
}
