import { db } from "@/lib/db";
import {
  CashBankAdjustmentStatus,
  CashBankDirection,
  CashBankSourceType,
  CashBankTransferStatus,
} from "@/lib/generated/prisma";
import { getCashBankSourceHref, getCashBankSourceLabel } from "@/lib/cash-bank-links";

type SourceFilter = CashBankSourceType | "ALL";
type DirectionFilter = CashBankDirection | "ALL";

export type CashBankReportFilters = {
  from: Date;
  to: Date;
  fromStr: string;
  toStr: string;
  hasFilter: boolean;
  accountId?: string;
  fromAccountId?: string;
  toAccountId?: string;
  sourceType: SourceFilter;
  direction: DirectionFilter;
  showCancelled: boolean;
};

export type CashBankLedgerRow = {
  rowNo: number;
  txnDate: Date;
  accountId: string;
  accountCode: string;
  accountName: string;
  referenceNo: string;
  sourceType: CashBankSourceType;
  sourceLabel: string;
  sourceId: string;
  sourceHref: string | null;
  note: string;
  inAmount: number;
  outAmount: number;
  balanceAfter: number;
};

export type CashBankLedgerData = {
  rows: CashBankLedgerRow[];
  openingBalance: number;
  totalIn: number;
  totalOut: number;
  endingBalance: number;
};

export type CashBankTransferHistoryRow = {
  rowNo: number;
  id: string;
  transferNo: string;
  transferDate: Date;
  fromAccountCode: string;
  fromAccountName: string;
  toAccountCode: string;
  toAccountName: string;
  amount: number;
  note: string;
  status: CashBankTransferStatus;
  cancelNote: string;
};

export type CashBankAdjustmentHistoryRow = {
  rowNo: number;
  id: string;
  adjustNo: string;
  adjustDate: Date;
  accountCode: string;
  accountName: string;
  direction: CashBankDirection;
  amount: number;
  reason: string;
  note: string;
  status: CashBankAdjustmentStatus;
  cancelNote: string;
};

function parseDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function endOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

export function formatCashBankDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseCashBankReportFilters(
  params: Record<string, string | undefined>,
): CashBankReportFilters {
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const from = parseDate(params.from, firstOfMonth);
  const to = parseDate(params.to, today);

  const sourceType =
    params.sourceType &&
    (Object.values(CashBankSourceType) as string[]).includes(params.sourceType)
      ? (params.sourceType as CashBankSourceType)
      : "ALL";

  const direction =
    params.direction === CashBankDirection.IN || params.direction === CashBankDirection.OUT
      ? (params.direction as CashBankDirection)
      : "ALL";

  return {
    from,
    to: endOfDay(to),
    fromStr: params.from ?? formatCashBankDateInput(from),
    toStr: params.to ?? formatCashBankDateInput(today),
    hasFilter: !!(params.from || params.to),
    accountId: params.accountId?.trim() || undefined,
    fromAccountId: params.fromAccountId?.trim() || undefined,
    toAccountId: params.toAccountId?.trim() || undefined,
    sourceType,
    direction,
    showCancelled: params.showCancelled === "1",
  };
}

function fmtDate(date: Date): string {
  return date.toLocaleDateString("th-TH-u-ca-gregory", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function csvRow(values: Array<string | number>): string {
  return values
    .map((value) => {
      const cell = String(value);
      return cell.includes(",") || cell.includes('"') || cell.includes("\n")
        ? `"${cell.replace(/"/g, '""')}"`
        : cell;
    })
    .join(",");
}

function withBom(lines: string[]): string {
  return `\uFEFF${lines.join("\r\n")}`;
}

export async function queryCashBankLedgerData(
  filters: CashBankReportFilters,
): Promise<CashBankLedgerData> {
  const accounts = await db.cashBankAccount.findMany({
    where: filters.accountId ? { id: filters.accountId } : { isActive: true },
    orderBy: [{ type: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      openingBalance: true,
    },
  });

  if (accounts.length === 0) {
    return { rows: [], openingBalance: 0, totalIn: 0, totalOut: 0, endingBalance: 0 };
  }

  const movements = await db.cashBankMovement.findMany({
    where: {
      txnDate: { gte: filters.from, lte: filters.to },
      ...(filters.accountId ? { accountId: filters.accountId } : {}),
      ...(filters.sourceType !== "ALL" ? { sourceType: filters.sourceType } : {}),
      ...(filters.direction !== "ALL" ? { direction: filters.direction } : {}),
    },
    orderBy: [
      { txnDate: "asc" },
      { account: { code: "asc" } },
      { sorder: "asc" },
      { createdAt: "asc" },
      { id: "asc" },
    ],
    select: {
      id: true,
      txnDate: true,
      direction: true,
      amount: true,
      balanceAfter: true,
      sourceType: true,
      sourceId: true,
      referenceNo: true,
      note: true,
      account: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
    },
    take: 5000,
  });

  const [openingEntries, endingEntries] = await Promise.all([
    Promise.all(
      accounts.map(async (account) => {
        const previousMovement = await db.cashBankMovement.findFirst({
          where: {
            accountId: account.id,
            txnDate: { lt: filters.from },
          },
          orderBy: [
            { txnDate: "desc" },
            { sorder: "desc" },
            { createdAt: "desc" },
            { id: "desc" },
          ],
          select: { balanceAfter: true },
        });
        return [
          account.id,
          Number(previousMovement?.balanceAfter ?? account.openingBalance),
        ] as const;
      }),
    ),
    // Query ending balance separately (no direction/source filter) so the balance
    // card is always accurate regardless of which filter the user has applied.
    Promise.all(
      accounts.map(async (account) => {
        const lastMovement = await db.cashBankMovement.findFirst({
          where: {
            accountId: account.id,
            txnDate: { lte: filters.to },
          },
          orderBy: [
            { txnDate: "desc" },
            { sorder: "desc" },
            { createdAt: "desc" },
            { id: "desc" },
          ],
          select: { balanceAfter: true },
        });
        return [account.id, lastMovement ? Number(lastMovement.balanceAfter) : null] as const;
      }),
    ),
  ]);

  const openingByAccount = new Map(openingEntries);
  const rows: CashBankLedgerRow[] = movements.map((movement, index) => {
    const amount = Number(movement.amount);
    return {
      rowNo: index + 1,
      txnDate: movement.txnDate,
      accountId: movement.account.id,
      accountCode: movement.account.code,
      accountName: movement.account.name,
      referenceNo: movement.referenceNo,
      sourceType: movement.sourceType,
      sourceLabel: getCashBankSourceLabel(movement.sourceType),
      sourceId: movement.sourceId,
      sourceHref: getCashBankSourceHref(movement.sourceType, movement.sourceId),
      note: movement.note ?? "",
      inAmount: movement.direction === CashBankDirection.IN ? amount : 0,
      outAmount: movement.direction === CashBankDirection.OUT ? amount : 0,
      balanceAfter: Number(movement.balanceAfter),
    };
  });

  const openingBalance = [...openingByAccount.values()].reduce((sum, value) => sum + value, 0);
  const totalIn = rows.reduce((sum, row) => sum + row.inAmount, 0);
  const totalOut = rows.reduce((sum, row) => sum + row.outAmount, 0);
  // Use stored balanceAfter (accurate regardless of direction/source filters applied above)
  const endingBalance = endingEntries.reduce((sum, [accountId, ending]) => {
    const fallback = openingByAccount.get(accountId) ?? 0;
    return sum + (ending ?? fallback);
  }, 0);

  return {
    rows,
    openingBalance,
    totalIn,
    totalOut,
    endingBalance,
  };
}

export async function queryCashBankTransferHistoryRows(
  filters: CashBankReportFilters,
): Promise<CashBankTransferHistoryRow[]> {
  const rows = await db.cashBankTransfer.findMany({
    where: {
      transferDate: { gte: filters.from, lte: filters.to },
      ...(filters.fromAccountId ? { fromAccountId: filters.fromAccountId } : {}),
      ...(filters.toAccountId ? { toAccountId: filters.toAccountId } : {}),
      ...(filters.showCancelled ? {} : { status: CashBankTransferStatus.ACTIVE }),
    },
    orderBy: [{ transferDate: "asc" }, { transferNo: "asc" }],
    select: {
      id: true,
      transferNo: true,
      transferDate: true,
      amount: true,
      note: true,
      status: true,
      cancelNote: true,
      fromAccount: { select: { code: true, name: true } },
      toAccount: { select: { code: true, name: true } },
    },
    take: 5000,
  });

  return rows.map((row, index) => ({
    rowNo: index + 1,
    id: row.id,
    transferNo: row.transferNo,
    transferDate: row.transferDate,
    fromAccountCode: row.fromAccount.code,
    fromAccountName: row.fromAccount.name,
    toAccountCode: row.toAccount.code,
    toAccountName: row.toAccount.name,
    amount: Number(row.amount),
    note: row.note ?? "",
    status: row.status,
    cancelNote: row.cancelNote ?? "",
  }));
}

export async function queryCashBankAdjustmentHistoryRows(
  filters: CashBankReportFilters,
): Promise<CashBankAdjustmentHistoryRow[]> {
  const rows = await db.cashBankAdjustment.findMany({
    where: {
      adjustDate: { gte: filters.from, lte: filters.to },
      ...(filters.accountId ? { accountId: filters.accountId } : {}),
      ...(filters.direction !== "ALL" ? { direction: filters.direction } : {}),
      ...(filters.showCancelled ? {} : { status: CashBankAdjustmentStatus.ACTIVE }),
    },
    orderBy: [{ adjustDate: "asc" }, { adjustNo: "asc" }],
    select: {
      id: true,
      adjustNo: true,
      adjustDate: true,
      direction: true,
      amount: true,
      reason: true,
      note: true,
      status: true,
      cancelNote: true,
      account: { select: { code: true, name: true } },
    },
    take: 5000,
  });

  return rows.map((row, index) => ({
    rowNo: index + 1,
    id: row.id,
    adjustNo: row.adjustNo,
    adjustDate: row.adjustDate,
    accountCode: row.account.code,
    accountName: row.account.name,
    direction: row.direction,
    amount: Number(row.amount),
    reason: row.reason,
    note: row.note ?? "",
    status: row.status,
    cancelNote: row.cancelNote ?? "",
  }));
}

export function buildCashBankLedgerCsv(data: CashBankLedgerData): string {
  const lines: string[] = [];
  lines.push(csvRow(["ยอดยกมา", data.openingBalance.toFixed(2)]));
  lines.push(csvRow(["รวมรับ", data.totalIn.toFixed(2)]));
  lines.push(csvRow(["รวมจ่าย", data.totalOut.toFixed(2)]));
  lines.push(csvRow(["ยอดคงเหลือปลายงวด", data.endingBalance.toFixed(2)]));
  lines.push("");
  lines.push(
    csvRow([
      "ลำดับ",
      "วันที่",
      "บัญชี",
      "รหัสบัญชี",
      "เลขอ้างอิง",
      "Source",
      "หมายเหตุ",
      "รับเข้า",
      "จ่ายออก",
      "Balance",
      "ลิงก์เอกสาร",
    ]),
  );

  for (const row of data.rows) {
    lines.push(
      csvRow([
        row.rowNo,
        fmtDate(row.txnDate),
        row.accountName,
        row.accountCode,
        row.referenceNo,
        row.sourceLabel,
        row.note || "-",
        row.inAmount.toFixed(2),
        row.outAmount.toFixed(2),
        row.balanceAfter.toFixed(2),
        row.sourceHref ?? "",
      ]),
    );
  }

  return withBom(lines);
}

export function buildCashBankTransferHistoryCsv(rows: CashBankTransferHistoryRow[]): string {
  const lines = [
    csvRow([
      "ลำดับ",
      "เลขที่โอน",
      "วันที่",
      "รหัสบัญชีต้นทาง",
      "บัญชีต้นทาง",
      "รหัสบัญชีปลายทาง",
      "บัญชีปลายทาง",
      "จำนวนเงิน",
      "หมายเหตุ",
      "สถานะ",
      "เหตุผลยกเลิก",
    ]),
  ];

  for (const row of rows) {
    lines.push(
      csvRow([
        row.rowNo,
        row.transferNo,
        fmtDate(row.transferDate),
        row.fromAccountCode,
        row.fromAccountName,
        row.toAccountCode,
        row.toAccountName,
        row.amount.toFixed(2),
        row.note || "-",
        row.status,
        row.cancelNote || "-",
      ]),
    );
  }

  return withBom(lines);
}

export function buildCashBankAdjustmentHistoryCsv(rows: CashBankAdjustmentHistoryRow[]): string {
  const lines = [
    csvRow([
      "ลำดับ",
      "เลขที่ปรับยอด",
      "วันที่",
      "รหัสบัญชี",
      "บัญชี",
      "ทิศทาง",
      "จำนวนเงิน",
      "เหตุผล",
      "หมายเหตุ",
      "สถานะ",
      "เหตุผลยกเลิก",
    ]),
  ];

  for (const row of rows) {
    lines.push(
      csvRow([
        row.rowNo,
        row.adjustNo,
        fmtDate(row.adjustDate),
        row.accountCode,
        row.accountName,
        row.direction,
        row.amount.toFixed(2),
        row.reason,
        row.note || "-",
        row.status,
        row.cancelNote || "-",
      ]),
    );
  }

  return withBom(lines);
}
