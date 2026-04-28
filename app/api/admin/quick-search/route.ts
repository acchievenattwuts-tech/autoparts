import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  getAllPermissionKeys,
  hasPermissionAccess,
  type PermissionKey,
} from "@/lib/access-control";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TAKE_PER_GROUP = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const MAX_QUERY_LENGTH = 80;

type ResultItem = {
  id: string;
  label: string;
  sublabel?: string;
  href: string;
};

type ResultGroup = {
  key: string;
  label: string;
  items: ResultItem[];
};

const insensitiveContains = (q: string) => ({ contains: q, mode: "insensitive" as const });

const normalize = (raw: string | null): string => {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (trimmed.length > MAX_QUERY_LENGTH) return trimmed.slice(0, MAX_QUERY_LENGTH);
  return trimmed;
};

const safeError = (message: string, status = 500) =>
  NextResponse.json({ error: message }, { status });

export const GET = async (request: Request): Promise<NextResponse> => {
  try {
    const session = await auth();
    if (!session?.user) return safeError("UNAUTHORIZED", 401);

    const role = session.user.role;
    const permissions =
      role === "ADMIN"
        ? getAllPermissionKeys()
        : ((session.user.permissions ?? []) as PermissionKey[]);

    const rate = checkRateLimit({
      key: `quick-search:${session.user.id}`,
      limit: RATE_LIMIT_MAX_REQUESTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });
    if (!rate.ok) {
      return NextResponse.json(
        { error: "RATE_LIMITED" },
        { status: 429, headers: { "Retry-After": String(Math.ceil((rate.resetAt - Date.now()) / 1000)) } },
      );
    }

    const url = new URL(request.url);
    const query = normalize(url.searchParams.get("q"));
    const docOnly = url.searchParams.get("scope") === "docs";

    if (query.length < 1) {
      return NextResponse.json({ groups: [] });
    }

    const can = (key: PermissionKey) => hasPermissionAccess(role, permissions, key);
    const queryContains = insensitiveContains(query);

    const [
      sales,
      purchases,
      purchaseReturns,
      creditNotes,
      receipts,
      supplierAdvances,
      supplierPayments,
      expenses,
      warrantyClaims,
      products,
      customers,
      suppliers,
    ] = await Promise.all([
      can("sales.view")
        ? db.sale.findMany({
            where: docOnly
              ? { saleNo: queryContains }
              : { OR: [{ saleNo: queryContains }, { customerName: queryContains }, { customerPhone: queryContains }] },
            select: { id: true, saleNo: true, customerName: true, status: true, saleDate: true },
            orderBy: { saleDate: "desc" },
            take: TAKE_PER_GROUP,
          })
        : Promise.resolve([]),
      can("purchases.view")
        ? db.purchase.findMany({
            where: docOnly
              ? { purchaseNo: queryContains }
              : {
                  OR: [
                    { purchaseNo: queryContains },
                    { referenceNo: queryContains },
                    { supplier: { name: queryContains } },
                  ],
                },
            select: {
              id: true,
              purchaseNo: true,
              referenceNo: true,
              supplier: { select: { name: true } },
              status: true,
              purchaseDate: true,
            },
            orderBy: { purchaseDate: "desc" },
            take: TAKE_PER_GROUP,
          })
        : Promise.resolve([]),
      can("purchase_returns.view")
        ? db.purchaseReturn.findMany({
            where: docOnly
              ? { returnNo: queryContains }
              : {
                  OR: [
                    { returnNo: queryContains },
                    { supplier: { name: queryContains } },
                  ],
                },
            select: {
              id: true,
              returnNo: true,
              supplier: { select: { name: true } },
              status: true,
              returnDate: true,
            },
            orderBy: { returnDate: "desc" },
            take: TAKE_PER_GROUP,
          })
        : Promise.resolve([]),
      can("credit_notes.view")
        ? db.creditNote.findMany({
            where: docOnly
              ? { cnNo: queryContains }
              : { OR: [{ cnNo: queryContains }, { customerName: queryContains }] },
            select: { id: true, cnNo: true, customerName: true, cnDate: true },
            orderBy: { cnDate: "desc" },
            take: TAKE_PER_GROUP,
          })
        : Promise.resolve([]),
      can("receipts.view")
        ? db.receipt.findMany({
            where: docOnly
              ? { receiptNo: queryContains }
              : { OR: [{ receiptNo: queryContains }, { customerName: queryContains }] },
            select: { id: true, receiptNo: true, customerName: true, status: true, receiptDate: true },
            orderBy: { receiptDate: "desc" },
            take: TAKE_PER_GROUP,
          })
        : Promise.resolve([]),
      can("supplier_advances.view")
        ? db.supplierAdvance.findMany({
            where: docOnly
              ? { advanceNo: queryContains }
              : {
                  OR: [
                    { advanceNo: queryContains },
                    { supplier: { name: queryContains } },
                  ],
                },
            select: {
              id: true,
              advanceNo: true,
              supplier: { select: { name: true } },
              status: true,
              advanceDate: true,
            },
            orderBy: { advanceDate: "desc" },
            take: TAKE_PER_GROUP,
          })
        : Promise.resolve([]),
      can("supplier_payments.view")
        ? db.supplierPayment.findMany({
            where: docOnly
              ? { paymentNo: queryContains }
              : {
                  OR: [
                    { paymentNo: queryContains },
                    { supplier: { name: queryContains } },
                  ],
                },
            select: {
              id: true,
              paymentNo: true,
              supplier: { select: { name: true } },
              status: true,
              paymentDate: true,
            },
            orderBy: { paymentDate: "desc" },
            take: TAKE_PER_GROUP,
          })
        : Promise.resolve([]),
      can("expenses.view")
        ? db.expense.findMany({
            where: docOnly
              ? { expenseNo: queryContains }
              : { OR: [{ expenseNo: queryContains }, { note: queryContains }] },
            select: { id: true, expenseNo: true, note: true, status: true, expenseDate: true },
            orderBy: { expenseDate: "desc" },
            take: TAKE_PER_GROUP,
          })
        : Promise.resolve([]),
      can("warranty_claims.view")
        ? db.warrantyClaim.findMany({
            where: docOnly
              ? { claimNo: queryContains }
              : { OR: [{ claimNo: queryContains }, { supplierName: queryContains }] },
            select: { id: true, claimNo: true, supplierName: true, status: true, claimDate: true },
            orderBy: { claimDate: "desc" },
            take: TAKE_PER_GROUP,
          })
        : Promise.resolve([]),
      !docOnly && can("products.view")
        ? db.product.findMany({
            where: {
              OR: [
                { code: queryContains },
                { name: queryContains },
                { aliases: { some: { alias: queryContains } } },
              ],
            },
            select: { id: true, code: true, name: true, isActive: true },
            orderBy: { createdAt: "desc" },
            take: TAKE_PER_GROUP,
          })
        : Promise.resolve([]),
      !docOnly && can("customers.view")
        ? db.customer.findMany({
            where: {
              OR: [
                { code: queryContains },
                { name: queryContains },
                { phone: queryContains },
              ],
            },
            select: { id: true, code: true, name: true, phone: true, isActive: true },
            orderBy: { name: "asc" },
            take: TAKE_PER_GROUP,
          })
        : Promise.resolve([]),
      !docOnly && can("master.view")
        ? db.supplier.findMany({
            where: {
              OR: [{ code: queryContains }, { name: queryContains }],
            },
            select: { id: true, code: true, name: true, isActive: true },
            orderBy: { name: "asc" },
            take: TAKE_PER_GROUP,
          })
        : Promise.resolve([]),
    ]);

    const groups: ResultGroup[] = [];

    if (sales.length > 0) {
      groups.push({
        key: "sales",
        label: "ใบขาย",
        items: sales.map((s) => ({
          id: `sale:${s.id}`,
          label: s.saleNo,
          sublabel: [s.customerName, s.status === "CANCELLED" ? "(ยกเลิก)" : null].filter(Boolean).join(" · "),
          href: `/admin/sales/${s.id}`,
        })),
      });
    }
    if (purchases.length > 0) {
      groups.push({
        key: "purchases",
        label: "ใบซื้อ",
        items: purchases.map((p) => ({
          id: `purchase:${p.id}`,
          label: p.purchaseNo,
          sublabel: [p.supplier?.name, p.referenceNo, p.status === "CANCELLED" ? "(ยกเลิก)" : null].filter(Boolean).join(" · "),
          href: `/admin/purchases/${p.id}`,
        })),
      });
    }
    if (purchaseReturns.length > 0) {
      groups.push({
        key: "purchase_returns",
        label: "ใบคืนซื้อ",
        items: purchaseReturns.map((r) => ({
          id: `purchase-return:${r.id}`,
          label: r.returnNo,
          sublabel: [r.supplier?.name, r.status === "CANCELLED" ? "(ยกเลิก)" : null].filter(Boolean).join(" · "),
          href: `/admin/purchase-returns/${r.id}`,
        })),
      });
    }
    if (creditNotes.length > 0) {
      groups.push({
        key: "credit_notes",
        label: "CN ขาย",
        items: creditNotes.map((c) => ({
          id: `cn:${c.id}`,
          label: c.cnNo,
          sublabel: c.customerName ?? undefined,
          href: `/admin/credit-notes/${c.id}`,
        })),
      });
    }
    if (receipts.length > 0) {
      groups.push({
        key: "receipts",
        label: "ใบเสร็จรับเงิน",
        items: receipts.map((r) => ({
          id: `receipt:${r.id}`,
          label: r.receiptNo,
          sublabel: [r.customerName, r.status === "CANCELLED" ? "(ยกเลิก)" : null].filter(Boolean).join(" · "),
          href: `/admin/receipts/${r.id}`,
        })),
      });
    }
    if (supplierAdvances.length > 0) {
      groups.push({
        key: "supplier_advances",
        label: "เงินมัดจำซัพพลายเออร์",
        items: supplierAdvances.map((a) => ({
          id: `advance:${a.id}`,
          label: a.advanceNo,
          sublabel: [a.supplier?.name, a.status === "CANCELLED" ? "(ยกเลิก)" : null].filter(Boolean).join(" · "),
          href: `/admin/supplier-advances/${a.id}`,
        })),
      });
    }
    if (supplierPayments.length > 0) {
      groups.push({
        key: "supplier_payments",
        label: "จ่ายชำระซัพพลายเออร์",
        items: supplierPayments.map((p) => ({
          id: `payment:${p.id}`,
          label: p.paymentNo,
          sublabel: [p.supplier?.name, p.status === "CANCELLED" ? "(ยกเลิก)" : null].filter(Boolean).join(" · "),
          href: `/admin/supplier-payments/${p.id}`,
        })),
      });
    }
    if (expenses.length > 0) {
      groups.push({
        key: "expenses",
        label: "ค่าใช้จ่าย",
        items: expenses.map((e) => ({
          id: `expense:${e.id}`,
          label: e.expenseNo,
          sublabel: [e.note, e.status === "CANCELLED" ? "(ยกเลิก)" : null].filter(Boolean).join(" · ") || undefined,
          href: `/admin/expenses/${e.id}`,
        })),
      });
    }
    if (warrantyClaims.length > 0) {
      groups.push({
        key: "warranty_claims",
        label: "ใบเคลม",
        items: warrantyClaims.map((c) => ({
          id: `claim:${c.id}`,
          label: c.claimNo,
          sublabel: c.supplierName ?? undefined,
          href: `/admin/warranty-claims/${c.id}`,
        })),
      });
    }
    if (products.length > 0) {
      groups.push({
        key: "products",
        label: "สินค้า",
        items: products.map((p) => ({
          id: `product:${p.id}`,
          label: `${p.code} — ${p.name}`,
          sublabel: p.isActive ? undefined : "(ปิดการใช้งาน)",
          href: `/admin/products/${p.id}`,
        })),
      });
    }
    if (customers.length > 0) {
      groups.push({
        key: "customers",
        label: "ลูกค้า",
        items: customers.map((c) => ({
          id: `customer:${c.id}`,
          label: c.name,
          sublabel: [c.code, c.phone, c.isActive ? null : "(ปิดการใช้งาน)"].filter(Boolean).join(" · ") || undefined,
          href: `/admin/customers/${c.id}`,
        })),
      });
    }
    if (suppliers.length > 0) {
      groups.push({
        key: "suppliers",
        label: "ซัพพลายเออร์",
        items: suppliers.map((s) => ({
          id: `supplier:${s.id}`,
          label: s.name,
          sublabel: [s.code, s.isActive ? null : "(ปิดการใช้งาน)"].filter(Boolean).join(" · ") || undefined,
          href: `/admin/master/suppliers`,
        })),
      });
    }

    return NextResponse.json(
      { groups },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[quick-search] failed", error);
    return safeError("INTERNAL_ERROR", 500);
  }
};
