import type { PermissionKey } from "@/lib/access-control";
import { ADMIN_NAVIGATION, flattenAdminNavigation } from "@/lib/admin-navigation";

export type CommandGroupKey =
  | "create"
  | "navigate"
  | "personal";

export type QuickCommand = {
  id: string;
  label: string;
  sublabel?: string;
  href?: string;
  action?: "logout" | "toggle-theme";
  permission?: PermissionKey;
  group: CommandGroupKey;
  keywords?: string;
};

export const COMMAND_GROUP_LABEL: Record<CommandGroupKey, string> = {
  create: "สร้างเอกสารใหม่",
  navigate: "ไปหน้า",
  personal: "ตั้งค่า / ส่วนตัว",
};

export const QUICK_COMMANDS: readonly QuickCommand[] = [
  // Create
  { id: "create-sale", label: "สร้างใบขายใหม่", href: "/admin/sales/new", permission: "sales.create", group: "create", keywords: "sale ขาย invoice" },
  { id: "create-purchase", label: "สร้างใบซื้อใหม่", href: "/admin/purchases/new", permission: "purchases.create", group: "create", keywords: "purchase ซื้อ" },
  { id: "create-purchase-return", label: "สร้างใบคืนซื้อใหม่", href: "/admin/purchase-returns/new", permission: "purchase_returns.create", group: "create", keywords: "return คืน" },
  { id: "create-cn", label: "สร้าง CN ใหม่", href: "/admin/credit-notes/new", permission: "credit_notes.create", group: "create", keywords: "credit note ลดหนี้" },
  { id: "create-receipt", label: "สร้างใบเสร็จรับเงินใหม่", href: "/admin/receipts/new", permission: "receipts.create", group: "create", keywords: "receipt รับชำระ" },
  { id: "create-expense", label: "สร้างค่าใช้จ่ายใหม่", href: "/admin/expenses/new", permission: "expenses.create", group: "create", keywords: "expense ค่าใช้จ่าย" },
  { id: "create-claim", label: "สร้างใบเคลมใหม่", href: "/admin/warranty-claims/new", permission: "warranty_claims.create", group: "create", keywords: "claim เคลม" },
  { id: "create-supplier-advance", label: "สร้างมัดจำซัพพลายเออร์", href: "/admin/supplier-advances/new", permission: "supplier_advances.create", group: "create", keywords: "advance มัดจำ" },
  { id: "create-supplier-payment", label: "สร้างใบจ่ายชำระซัพพลายเออร์", href: "/admin/supplier-payments/new", permission: "supplier_payments.create", group: "create", keywords: "supplier payment จ่าย" },

  // Navigate
  ...flattenAdminNavigation(ADMIN_NAVIGATION).map((item) => ({
    id: `nav-${item.href.replace(/^\/+/, "").replace(/[^\w]+/g, "-")}`,
    label: item.label,
    href: item.href,
    permission: item.permission,
    group: "navigate" as const,
    keywords: item.keywords,
  })),

  // Personal
  { id: "personal-toggle-theme", label: "สลับ Dark / Light mode", action: "toggle-theme", group: "personal", keywords: "dark light theme mode" },
  { id: "personal-change-password", label: "เปลี่ยนรหัสผ่าน", href: "/admin/profile", group: "personal", keywords: "password รหัสผ่าน profile" },
  { id: "personal-logout", label: "ออกจากระบบ", action: "logout", group: "personal", keywords: "logout signout ออก" },
];

export const filterCommandsByPermission = (
  commands: readonly QuickCommand[],
  role: string | null | undefined,
  permissions: readonly string[] | null | undefined,
): QuickCommand[] => {
  if (role === "ADMIN") return [...commands];
  if (!Array.isArray(permissions)) return [];
  return commands.filter((cmd) => !cmd.permission || permissions.includes(cmd.permission));
};
