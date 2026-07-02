import type { ComponentType } from "react";
import {
  Archive,
  Award,
  BarChart3,
  Boxes,
  Car,
  ClipboardList,
  FileCheck,
  FileX,
  Layers,
  LayoutDashboard,
  ListChecks,
  MapPin,
  Megaphone,
  MessageCircle,
  Package,
  PackageSearch,
  Receipt,
  RefreshCw,
  RotateCcw,
  ScrollText,
  SearchX,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  Store,
  Tags,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  Languages,
  KeyRound,
  UserCog,
} from "lucide-react";

import type { PermissionKey } from "@/lib/access-control";

export type AdminNavItem = {
  label: string;
  href: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  permission?: PermissionKey;
  keywords?: string;
};

export type AdminNavSection = {
  section: string;
  items: AdminNavItem[];
};

export const ADMIN_NAVIGATION: readonly AdminNavSection[] = [
  {
    section: "ภาพรวม",
    items: [
      { label: "Today Workboard", href: "/admin/workboard", icon: ClipboardList, permission: "workboard.view", keywords: "workboard today overview" },
      { label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard, permission: "dashboard.view", keywords: "dashboard overview" },
    ],
  },
  {
    section: "ขาย & ลูกหนี้",
    items: [
      { label: "บันทึกการขาย", href: "/admin/sales", icon: TrendingUp, permission: "sales.view", keywords: "sales ขาย invoice" },
      { label: "คิวจัดส่ง", href: "/admin/delivery", icon: MapPin, permission: "delivery.view", keywords: "delivery dispatch shipping" },
      { label: "ใบเสร็จรับเงิน", href: "/admin/receipts", icon: FileCheck, permission: "receipts.view", keywords: "receipt รับชำระ" },
      { label: "Credit Note (CN)", href: "/admin/credit-notes", icon: FileX, permission: "credit_notes.view", keywords: "credit note cn ลดหนี้" },
      { label: "LINE OA Conversations", href: "/admin/line-conversations", icon: MessageCircle, permission: "line_conversations.view", keywords: "line oa chat conversations ai agent reply customer" },
      { label: "สลิปการชำระเงิน (LINE)", href: "/admin/line-payment-slips", icon: Receipt, permission: "line_payment_slips.view", keywords: "line payment slip สลิป โอนเงิน หลักฐานการโอน ตรวจสลิป ชำระเงิน ocr" },
    ],
  },
  {
    section: "ซื้อ & เจ้าหนี้",
    items: [
      { label: "ซื้อสินค้าเข้า", href: "/admin/purchases", icon: ShoppingCart, permission: "purchases.view", keywords: "purchase ซื้อ" },
      { label: "คืนสินค้าซัพพลายเออร์", href: "/admin/purchase-returns", icon: RotateCcw, permission: "purchase_returns.view", keywords: "purchase return คืนซื้อ" },
      { label: "เงินมัดจำซัพพลายเออร์", href: "/admin/supplier-advances", icon: Wallet, permission: "supplier_advances.view", keywords: "supplier advance มัดจำ" },
      { label: "จ่ายชำระซัพพลายเออร์", href: "/admin/supplier-payments", icon: FileCheck, permission: "supplier_payments.view", keywords: "supplier payment จ่ายชำระ" },
    ],
  },
  {
    section: "สต็อก",
    items: [
      { label: "ยอดยกมา (BF)", href: "/admin/stock/bf", icon: Archive, permission: "stock.bf.view", keywords: "bf stock beginning balance" },
      { label: "ปรับสต็อก", href: "/admin/stock/adjustments", icon: RefreshCw, permission: "stock.adjustments.view", keywords: "stock adjustment ปรับสต็อก" },
      { label: "Stock Card MAVG", href: "/admin/stock/card", icon: ClipboardList, permission: "stock.card.view", keywords: "stock card mavg" },
      { label: "Stock Card Lot", href: "/admin/lots/balance", icon: Layers, permission: "lot_reports.view", keywords: "stock card lot lots" },
    ],
  },
  {
    section: "บริการหลังการขาย",
    items: [
      { label: "ประกันสินค้า", href: "/admin/warranties", icon: ShieldCheck, permission: "warranties.view", keywords: "warranty ประกัน" },
      { label: "ใบเคลมสินค้า", href: "/admin/warranty-claims", icon: ShieldAlert, permission: "warranty_claims.view", keywords: "claim warranty เคลม" },
    ],
  },
  {
    section: "การเงิน",
    items: [
      { label: "บัญชีเงินสด / ธนาคาร", href: "/admin/cash-bank", icon: Wallet, permission: "cash_bank.view", keywords: "cash bank เงินสด ธนาคาร" },
      { label: "โอนเงินระหว่างบัญชี", href: "/admin/cash-bank/transfers", icon: RefreshCw, permission: "cash_bank.transfers.view", keywords: "transfer cash bank โอนเงิน" },
      { label: "ปรับยอดเงิน", href: "/admin/cash-bank/adjustments", icon: Receipt, permission: "cash_bank.adjustments.view", keywords: "cash adjustment ปรับยอดเงิน" },
      { label: "ค่าใช้จ่าย", href: "/admin/expenses", icon: Receipt, permission: "expenses.view", keywords: "expenses ค่าใช้จ่าย" },
      { label: "ทำจ่ายค่าส่งพนักงาน", href: "/admin/delivery-commissions", icon: Truck, permission: "delivery_commissions.view", keywords: "delivery commission payout ค่าส่ง พนักงานส่ง" },
    ],
  },
  {
    section: "รายงาน",
    items: [
      { label: "รายงาน", href: "/admin/reports", icon: BarChart3, permission: "reports.view", keywords: "reports รายงาน" },
      { label: "Product Search No Result", href: "/admin/reports/product-search-no-result", icon: SearchX, permission: "product_search_report.view", keywords: "product search no result telemetry คำค้นหา ไม่พบผลลัพธ์" },
      { label: "Search Coverage Audit", href: "/admin/reports/search-coverage-audit", icon: ListChecks, permission: "search_coverage.view", keywords: "search coverage audit backfill ขาดข้อมูล oem keyword รูป รุ่นรถ fitment" },
    ],
  },
  {
    section: "ข้อมูลหลัก",
    items: [
      { label: "ค้นสินค้าบนมือถือ", href: "/admin/products/search", icon: PackageSearch, permission: "products.view", keywords: "mobile product search ค้นสินค้า มือถือ app สินค้า" },
      { label: "สินค้า", href: "/admin/products", icon: Package, permission: "products.view", keywords: "products สินค้า" },
      { label: "ลูกค้า", href: "/admin/customers", icon: Users, permission: "customers.view", keywords: "customers ลูกค้า" },
      { label: "ประเภทลูกค้า", href: "/admin/master/customer-types", icon: UserCog, permission: "master.view", keywords: "customer type ประเภทลูกค้า อู่ ทั่วไป แสดงราคา ซ่อนราคา master" },
      { label: "ซัพพลายเออร์", href: "/admin/master/suppliers", icon: Truck, permission: "master.view", keywords: "suppliers ซัพพลายเออร์ master" },
      { label: "หมวดหมู่สินค้า", href: "/admin/master/categories", icon: Tags, permission: "master.view", keywords: "categories หมวดหมู่สินค้า master" },
      { label: "แบรนด์อะไหล่", href: "/admin/master/parts-brands", icon: Award, permission: "master.view", keywords: "parts brands แบรนด์อะไหล่ master" },
      { label: "ยี่ห้อ / รุ่นรถ", href: "/admin/master/car-brands", icon: Car, permission: "master.view", keywords: "car brands car models ยี่ห้อ รุ่นรถ master" },
      { label: "รหัสค่าใช้จ่าย", href: "/admin/master/expense-codes", icon: Wallet, permission: "master.view", keywords: "expense codes รหัสค่าใช้จ่าย master" },
      { label: "คลังคำพ้อง", href: "/admin/master/search-synonyms", icon: Languages, permission: "search_synonyms.view", keywords: "synonym search คำพ้อง คลังคำพ้อง dictionary master" },
    ],
  },
  {
    section: "การตลาด & เว็บไซต์",
    items: [
      { label: "คอนเทนต์ Facebook", href: "/admin/content", icon: Megaphone, permission: "content.view", keywords: "content facebook คอนเทนต์" },
      { label: "คิวอนุมัติโพสต์", href: "/admin/content/approval-queue", icon: ListChecks, permission: "content.view", keywords: "approval queue อนุมัติโพสต์ content" },
      { label: "Shopee / Marketplace", href: "/admin/marketplace/shopee", icon: Store, permission: "marketplace.view", keywords: "shopee marketplace ช่องทางขาย ออเดอร์ sync มาร์เก็ตเพลส" },
      { label: "Shopee Stock Sync", href: "/admin/marketplace/shopee/stock", icon: Boxes, permission: "marketplace.view", keywords: "shopee stock sync marketplace buffer reconciliation สต็อก ส่งสต็อก" },
    ],
  },
  {
    section: "ตั้งค่าระบบ",
    items: [
      { label: "ตั้งค่าร้านค้า", href: "/admin/settings/company", icon: Settings, permission: "settings.company.view", keywords: "settings company ตั้งค่าร้านค้า" },
      { label: "ผู้ใช้งาน", href: "/admin/users", icon: Users, permission: "admin.users.view", keywords: "users ผู้ใช้งาน admin" },
      { label: "บทบาทและสิทธิ์", href: "/admin/roles", icon: ShieldCheck, permission: "admin.roles.view", keywords: "roles permissions บทบาท สิทธิ์" },
      { label: "Audit Log", href: "/admin/audit-log", icon: ScrollText, permission: "audit_log.view", keywords: "audit log" },
      { label: "Backup Center", href: "/admin/backup-center", icon: Archive, permission: "system.backup", keywords: "backup สำรองข้อมูล blob postgres database database backup vercel supabase" },
      { label: "AI Keys (Gemini)", href: "/admin/line-ai-keys", icon: KeyRound, permission: "line_ai_keys.view", keywords: "ai key gemini google line oa api key rotation fallback rate limit quota สถานะ คีย์" },
    ],
  },
] as const;

export const filterAdminNavigationByPermission = (
  navigation: readonly AdminNavSection[],
  permissions?: readonly string[],
): AdminNavSection[] =>
  navigation
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => !item.permission || permissions === undefined || permissions.includes(item.permission),
      ),
    }))
    .filter((section) => section.items.length > 0);

export const flattenAdminNavigation = (navigation: readonly AdminNavSection[]): AdminNavItem[] =>
  navigation.flatMap((section) => section.items.map((item) => ({ ...item, keywords: [section.section, item.keywords].filter(Boolean).join(" ") })));
