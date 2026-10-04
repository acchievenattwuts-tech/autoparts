import { db } from "@/lib/db";
import { Prisma, StockCardSource } from "@/lib/generated/prisma";
import { getPurchaseBudgetRegisteredFromKey, getPurchaseBudgetSettings } from "@/lib/purchase-budget";
import { PURCHASE_BUDGET_AUDIT_ENTITY, roundBaht, type PurchaseBudgetSettings } from "@/lib/purchase-budget-core";
import {
  buildPurchaseBudgetLedgerDays,
  reconcilePurchaseBudgetEvents,
  resolvePurchaseBudgetRound,
  type PurchaseBudgetDocDay,
  type PurchaseBudgetEvent,
  type PurchaseBudgetLedgerDay,
} from "@/lib/purchase-budget-round";
import { purchaseRowsSql, saleRowsSql, stockOtherRowsSql, thaiDateKeySql } from "@/lib/purchase-budget-sql";
import { addThailandDays, formatDateThai, parseDateOnlyToStartOfDay } from "@/lib/th-date";

/**
 * The purchase budget ledger, loaded on demand by the dashboard tab: days first (budget entries and
 * counted documents with the balance at each day's end), then one day's documents with links.
 */

const LEDGER_DAY_PAGE_SIZE = 60;
const LEDGER_DOC_LIMIT = 300;
const HALF_SATANG = 0.005;
const CLAIM_RECEIVE_SUFFIX = /-R$/;

type SetSettings = PurchaseBudgetSettings & { budget: number; startedOn: string };

export type PurchaseBudgetLedgerDayRow = PurchaseBudgetLedgerDay & { label: string };

export type PurchaseBudgetLedgerPage = {
  startedOn: string;
  startedOnLabel: string;
  days: PurchaseBudgetLedgerDayRow[];
  hasMore: boolean;
  nextOffset: number;
};

export type PurchaseBudgetLedgerDoc = {
  key: string;
  /** "budget" = a budget entry (start, restart, top-up, cut): `partner` is who, `note` the reason. */
  kind: "budget" | "document";
  typeLabel: string;
  docNo: string;
  href: string | null;
  partner: string | null;
  amount: number;
  note: string | null;
};

const EVENT_LABEL: Record<PurchaseBudgetEvent["kind"], string> = {
  start: "ตั้งงบ",
  restart: "เริ่มรอบใหม่",
  add: "เพิ่มงบ",
  subtract: "ลดงบ",
};

const STOCK_SOURCE_LABEL: Partial<Record<StockCardSource, string>> = {
  [StockCardSource.RETURN_IN]: "ลูกค้าคืนสินค้า",
  [StockCardSource.RETURN_OUT]: "คืนสินค้าให้ซัพพลายเออร์",
  [StockCardSource.PURCHASE_ALLOWANCE]: "ลดราคาซื้อ",
  [StockCardSource.SUPPLIER_DEBIT]: "ใบเพิ่มหนี้ซัพพลายเออร์",
  [StockCardSource.ADJUST_IN]: "ปรับปรุงสต็อก",
  [StockCardSource.ADJUST_OUT]: "ปรับปรุงสต็อก",
  [StockCardSource.CLAIM_RETURN_IN]: "เคลมสินค้า",
  [StockCardSource.CLAIM_SEND_OUT]: "เคลมสินค้า",
  [StockCardSource.CLAIM_RECV_IN]: "เคลมสินค้า",
  [StockCardSource.CLAIM_REPLACE_OUT]: "เคลมสินค้า",
};

const dayLabel = (dateKey: string): string =>
  formatDateThai(parseDateOnlyToStartOfDay(dateKey), { day: "numeric", month: "short", year: "numeric" });

async function loadSetSettings(): Promise<SetSettings | null> {
  const settings = await getPurchaseBudgetSettings();
  if (settings.budget === null || settings.startedOn === null) return null;
  return { ...settings, budget: settings.budget, startedOn: settings.startedOn };
}

async function loadBudgetEvents(settings: SetSettings): Promise<PurchaseBudgetEvent[]> {
  const entries = await db.auditLog.findMany({
    where: { entityType: PURCHASE_BUDGET_AUDIT_ENTITY },
    orderBy: { createdAt: "asc" },
    select: { id: true, createdAt: true, userName: true, before: true, after: true, meta: true },
  });
  return reconcilePurchaseBudgetEvents(resolvePurchaseBudgetRound(entries), settings.budget, settings.startedOn);
}

/** Per-day totals of every counted document from `startedAt` (documents with no budget effect skipped). */
async function loadDocDays(startedAt: Date, registeredFromKey: string | null): Promise<PurchaseBudgetDocDay[]> {
  const rows = await db.$queryRaw<PurchaseBudgetDocDay[]>`
    WITH docs AS (
      SELECT ${thaiDateKeySql(Prisma.sql`pr."docDate"`)} AS "dateKey", -pr."cost" AS "amount"
      FROM (${purchaseRowsSql(registeredFromKey, startedAt, null)}) pr
      UNION ALL
      SELECT ${thaiDateKeySql(Prisma.sql`sr."docDate"`)}, sr."cost"
      FROM (${saleRowsSql(startedAt, null)}) sr
      UNION ALL
      SELECT ${thaiDateKeySql(Prisma.sql`st."docDate"`)}, -SUM(st."stockValue")
      FROM (${stockOtherRowsSql(startedAt, null)}) st
      GROUP BY st."docNo", st."source", 1
    )
    SELECT "dateKey", COUNT(*)::int AS "docCount",
           COALESCE(SUM("amount") FILTER (WHERE "amount" > 0), 0)::float8 AS "plus",
           COALESCE(SUM("amount") FILTER (WHERE "amount" < 0), 0)::float8 AS "minus"
    FROM docs
    WHERE ROUND("amount"::numeric, 2) <> 0
    GROUP BY "dateKey"
    ORDER BY "dateKey"
  `;
  return rows.map((row) => ({ dateKey: row.dateKey, plus: Number(row.plus), minus: Number(row.minus), docCount: Number(row.docCount) }));
}

/** Newest-first page of ledger days, or null while no budget is set. */
export async function getPurchaseBudgetLedgerPage(offset: number): Promise<PurchaseBudgetLedgerPage | null> {
  const settings = await loadSetSettings();
  if (!settings) return null;
  const registeredFromKey = await getPurchaseBudgetRegisteredFromKey();
  const [docDays, events] = await Promise.all([
    loadDocDays(parseDateOnlyToStartOfDay(settings.startedOn), registeredFromKey),
    loadBudgetEvents(settings),
  ]);
  const newestFirst = buildPurchaseBudgetLedgerDays(docDays, events).reverse();
  const page = newestFirst.slice(offset, offset + LEDGER_DAY_PAGE_SIZE);
  return {
    startedOn: settings.startedOn,
    startedOnLabel: dayLabel(settings.startedOn),
    days: page.map((day) => ({ ...day, label: dayLabel(day.dateKey) })),
    hasMore: offset + LEDGER_DAY_PAGE_SIZE < newestFirst.length,
    nextOffset: offset + LEDGER_DAY_PAGE_SIZE,
  };
}

type StockDocRow = { docNo: string; source: StockCardSource; stockValue: number };

/** Links and party names for the stock-card documents of one day (ids looked up by document number). */
async function describeStockDocs(rows: StockDocRow[], dateKey: string): Promise<Map<string, { href: string | null; partner: string | null }>> {
  const numbers = (sources: StockCardSource[]) => rows.filter((row) => sources.includes(row.source)).map((row) => row.docNo);
  const claimNumbers = numbers([StockCardSource.CLAIM_RETURN_IN, StockCardSource.CLAIM_SEND_OUT, StockCardSource.CLAIM_RECV_IN, StockCardSource.CLAIM_REPLACE_OUT])
    .map((docNo) => docNo.replace(CLAIM_RECEIVE_SUFFIX, ""));
  const [creditNotes, purchaseReturns, debitNotes, claims] = await Promise.all([
    db.creditNote.findMany({ where: { cnNo: { in: numbers([StockCardSource.RETURN_IN]) } }, select: { id: true, cnNo: true, customerName: true } }),
    db.purchaseReturn.findMany({
      where: { returnNo: { in: numbers([StockCardSource.RETURN_OUT, StockCardSource.PURCHASE_ALLOWANCE]) } },
      select: { id: true, returnNo: true, supplier: { select: { name: true } } },
    }),
    db.supplierDebitNote.findMany({
      where: { debitNo: { in: numbers([StockCardSource.SUPPLIER_DEBIT]) } },
      select: { id: true, debitNo: true, supplier: { select: { name: true } } },
    }),
    db.warrantyClaim.findMany({ where: { claimNo: { in: claimNumbers } }, select: { id: true, claimNo: true } }),
  ]);
  const links = new Map<string, { href: string | null; partner: string | null }>();
  for (const note of creditNotes) links.set(note.cnNo, { href: `/admin/credit-notes/${note.id}`, partner: note.customerName });
  for (const ret of purchaseReturns) links.set(ret.returnNo, { href: `/admin/purchase-returns/${ret.id}`, partner: ret.supplier?.name ?? null });
  for (const debit of debitNotes) links.set(debit.debitNo, { href: `/admin/supplier-debit-notes/${debit.id}`, partner: debit.supplier.name });
  const claimHref = new Map(claims.map((claim) => [claim.claimNo, `/admin/warranty-claims/${claim.id}`]));
  for (const row of rows) {
    if (links.has(row.docNo)) continue;
    const claim = claimHref.get(row.docNo.replace(CLAIM_RECEIVE_SUFFIX, ""));
    const isAdjustment = row.source === StockCardSource.ADJUST_IN || row.source === StockCardSource.ADJUST_OUT;
    links.set(row.docNo, {
      href: claim ?? (isAdjustment ? `/admin/stock/adjustments?from=${dateKey}&to=${dateKey}` : null),
      partner: null,
    });
  }
  return links;
}

async function loadDayDocuments(dateKey: string, registeredFromKey: string | null): Promise<PurchaseBudgetLedgerDoc[]> {
  const from = parseDateOnlyToStartOfDay(dateKey);
  const to = addThailandDays(from, 1);
  const [purchases, sales, stockDocs] = await Promise.all([
    db.$queryRaw<{ id: string; docNo: string; partner: string | null; cost: number }[]>`
      SELECT pr."id", pr."docNo", sup."name" AS "partner", pr."cost"::float8 AS "cost"
      FROM (${purchaseRowsSql(registeredFromKey, from, to)}) pr
      LEFT JOIN "Supplier" sup ON sup."id" = pr."supplierId"
      ORDER BY pr."docNo" LIMIT ${LEDGER_DOC_LIMIT}`,
    db.$queryRaw<{ id: string; docNo: string; partner: string | null; cost: number }[]>`
      SELECT sr."id", sr."docNo", COALESCE(NULLIF(sr."customerName", ''), c."name") AS "partner", sr."cost"::float8 AS "cost"
      FROM (${saleRowsSql(from, to)}) sr
      LEFT JOIN "Customer" c ON c."id" = sr."customerId"
      ORDER BY sr."docNo" LIMIT ${LEDGER_DOC_LIMIT}`,
    db.$queryRaw<StockDocRow[]>`
      SELECT st."docNo", st."source", SUM(st."stockValue")::float8 AS "stockValue"
      FROM (${stockOtherRowsSql(from, to)}) st
      GROUP BY st."docNo", st."source"
      ORDER BY st."docNo" LIMIT ${LEDGER_DOC_LIMIT}`,
  ]);
  const stockLinks = await describeStockDocs(stockDocs, dateKey);
  const documents: PurchaseBudgetLedgerDoc[] = [
    ...purchases.map((row): PurchaseBudgetLedgerDoc => ({ key: `purchase-${row.id}`, kind: "document", typeLabel: "ใบซื้อ", docNo: row.docNo, href: `/admin/purchases/${row.id}`, partner: row.partner, amount: roundBaht(-Number(row.cost)), note: null })),
    ...sales.map((row): PurchaseBudgetLedgerDoc => ({ key: `sale-${row.id}`, kind: "document", typeLabel: "บิลขาย", docNo: row.docNo, href: `/admin/sales/${row.id}`, partner: row.partner, amount: roundBaht(Number(row.cost)), note: null })),
    ...stockDocs.map((row): PurchaseBudgetLedgerDoc => ({
      key: `stock-${row.source}-${row.docNo}`,
      kind: "document",
      typeLabel: STOCK_SOURCE_LABEL[row.source] ?? row.source,
      docNo: row.docNo,
      href: stockLinks.get(row.docNo)?.href ?? null,
      partner: stockLinks.get(row.docNo)?.partner ?? null,
      amount: roundBaht(-Number(row.stockValue)),
      note: null,
    })),
  ];
  return documents.filter((document) => Math.abs(document.amount) >= HALF_SATANG);
}

/** One day's entries — budget changes first, then documents — or null while no budget is set. */
export async function getPurchaseBudgetLedgerDay(dateKey: string): Promise<PurchaseBudgetLedgerDoc[] | null> {
  const settings = await loadSetSettings();
  if (!settings) return null;
  if (dateKey < settings.startedOn) return [];
  const registeredFromKey = await getPurchaseBudgetRegisteredFromKey();
  const [documents, events] = await Promise.all([loadDayDocuments(dateKey, registeredFromKey), loadBudgetEvents(settings)]);
  const budgetEntries = events
    .filter((event) => event.dateKey === dateKey)
    .map((event): PurchaseBudgetLedgerDoc => ({
      key: `budget-${event.id}`,
      kind: "budget",
      typeLabel: EVENT_LABEL[event.kind],
      docNo: EVENT_LABEL[event.kind],
      href: null,
      partner: event.who,
      amount: event.amount,
      note: event.reason,
    }));
  return [...budgetEntries, ...documents];
}
