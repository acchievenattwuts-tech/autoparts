import Link from "next/link";
import type { JSX } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { formatDateThai } from "@/lib/th-date";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import DebitForm, { type DebitPurchase } from "../DebitForm";
import { toDebitPurchase, debitPurchaseSelect } from "../debit-purchase";

export const dynamic = "force-dynamic";
export const metadata = { title: "บันทึกใบเพิ่มหนี้ซัพพลายเออร์" };
const PURCHASE_PICK_LIMIT = 100;

const loadNewDebit = async ({ searchParams }: { searchParams: Promise<{ q?: string; purchaseId?: string }> }) => {
  try {
    await requirePermission("supplier_debit_notes.create");
    const { q = "", purchaseId } = await searchParams;
    const purchases = await db.purchase.findMany({ where: { status: "ACTIVE", supplierId: { not: null },
      ...(q ? { OR: [{ purchaseNo: { contains: q, mode: "insensitive" } }, { referenceNo: { contains: q, mode: "insensitive" } },
        { supplier: { name: { contains: q, mode: "insensitive" } } }] } : {}),
    }, orderBy: { purchaseDate: "desc" }, take: PURCHASE_PICK_LIMIT,
      select: { id: true, purchaseNo: true, referenceNo: true, purchaseDate: true, netAmount: true, supplier: { select: { name: true } } } });
    const selected = purchaseId ? await db.purchase.findFirst({ where: { id: purchaseId, status: "ACTIVE", supplierId: { not: null } },
      select: debitPurchaseSelect }) : null;
    const purchase: DebitPurchase | null = selected ? toDebitPurchase(selected) : null;
    return { q, purchaseId, purchases, purchase };
  } catch (error) { console.error("[supplier-DN new]", error); throw error; }
};

const NewDebitPage = async ({ searchParams }: { searchParams: Promise<{ q?: string; purchaseId?: string }> }): Promise<JSX.Element> => {
  const { q, purchaseId, purchases, purchase } = await loadNewDebit({ searchParams });
  return (
    <div className="space-y-6">
      <Link href="/admin/supplier-debit-notes" className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f] dark:text-slate-400 dark:hover:text-sky-300">
        <ArrowLeft size={16} /> กลับไปรายการใบเพิ่มหนี้
      </Link>
      <div>
        <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">บันทึกใบเพิ่มหนี้ซัพพลายเออร์</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">เพิ่มเจ้าหนี้และปรับมูลค่าต้นทุนจากใบซื้อเดิมหนึ่งใบ โดยไม่เพิ่มจำนวนสินค้า</p>
      </div>

      <section className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
        <h2 className="mb-5 border-b border-gray-100 pb-3 font-kanit text-lg font-semibold text-[#1e3a5f] dark:border-white/10 dark:text-sky-300">1. เลือกใบซื้ออ้างอิง</h2>
        <AdminSearchForm className="flex flex-col gap-2 sm:flex-row">
          <input name="q" defaultValue={q} aria-label="ค้นหาใบซื้อ" placeholder="ค้นหาเลขใบซื้อ / เลขอ้างอิงซัพพลายเออร์ / ชื่อซัพพลายเออร์"
            className="h-10 w-full rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] dark:border-white/20 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500" />
          <AdminSearchSubmitButton>ค้นหาใบซื้อ</AdminSearchSubmitButton>
        </AdminSearchForm>
        <p className="mt-3 text-xs text-gray-500 dark:text-slate-400">รวมใบซื้อสดและใบที่จ่ายครบแล้ว · แสดงล่าสุด {PURCHASE_PICK_LIMIT} ใบ ใช้ค้นหาเพื่อเลือกใบเก่า</p>
        <div className="mt-3 max-h-72 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200 dark:divide-white/5 dark:border-white/10">
          {purchases.length === 0 ? <p className="px-4 py-8 text-center text-sm text-gray-400 dark:text-slate-500">ไม่พบใบซื้อ</p> : purchases.map((item) => {
            const active = item.id === purchaseId;
            return (
              <Link key={item.id} href={`/admin/supplier-debit-notes/new?${new URLSearchParams({ ...(q ? { q } : {}), purchaseId: item.id })}`} scroll={false}
                className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors ${active ? "bg-sky-50 dark:bg-sky-500/15" : "hover:bg-gray-50 dark:hover:bg-white/5"}`}>
                <div className="min-w-0">
                  <p className="font-mono font-medium text-[#1e3a5f] dark:text-sky-300">{item.purchaseNo}{item.referenceNo ? <span className="ml-2 font-sans text-xs font-normal text-gray-500 dark:text-slate-400">อ้างอิง {item.referenceNo}</span> : null}</p>
                  <p className="truncate text-gray-600 dark:text-slate-400">{item.supplier?.name} · {formatDateThai(item.purchaseDate)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="tabular-nums text-gray-700 dark:text-slate-300">{Number(item.netAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
                  <ChevronRight size={16} className={active ? "text-[#1e3a5f] dark:text-sky-300" : "text-gray-300 dark:text-slate-600"} />
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {purchase ? <DebitForm key={purchase.id} purchase={purchase} /> : (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center text-sm text-gray-500 dark:border-white/15 dark:bg-[#101b2e] dark:text-slate-400">
          {purchaseId ? "ไม่พบใบซื้อที่เลือก หรือใบซื้อถูกยกเลิกแล้ว" : "เลือกใบซื้อด้านบนเพื่อเริ่มกรอกใบเพิ่มหนี้"}
        </div>
      )}
    </div>
  );
};
export default NewDebitPage;
