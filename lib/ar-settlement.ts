import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma";

type TxClient = Prisma.TransactionClient;

type ReceiptDocumentClient = Pick<typeof db, "sale" | "creditNote"> &
  Pick<TxClient, "sale" | "creditNote">;

export type AvailableReceiptDocument = {
  id: string;
  docNo: string;
  docDate: Date;
  totalAmount: number;
  usedAmount: number;
  outstanding: number;
};

export type AvailableReceiptDocumentBundle = {
  sales: AvailableReceiptDocument[];
  creditNotes: AvailableReceiptDocument[];
};

export type ReceiptSettlementItem = {
  saleId?: string | null | undefined;
  cnId?: string | null | undefined;
  paidAmount: number;
};

function sumReceiptUsage(items: Array<{ paidAmount: Prisma.Decimal | number }>): number {
  return items.reduce((sum, item) => sum + Number(item.paidAmount), 0);
}

export async function getAvailableReceiptDocuments(
  tx: ReceiptDocumentClient,
  customerId: string,
  excludeReceiptId?: string,
): Promise<AvailableReceiptDocumentBundle> {
  const saleOr = [{ amountRemain: { gt: 0 } }] as Prisma.SaleWhereInput[];
  const cnOr = [{ amountRemain: { gt: 0 } }] as Prisma.CreditNoteWhereInput[];

  if (excludeReceiptId) {
    saleOr.push({ receipts: { some: { receiptId: excludeReceiptId } } });
    cnOr.push({ receiptItems: { some: { receiptId: excludeReceiptId } } });
  }

  const [sales, creditNotes] = await Promise.all([
    tx.sale.findMany({
      where: {
        customerId,
        paymentType: "CREDIT_SALE",
        status: "ACTIVE",
        OR: saleOr,
      },
      orderBy: [{ saleDate: "asc" }, { saleNo: "asc" }],
      select: {
        id: true,
        saleNo: true,
        saleDate: true,
        netAmount: true,
        amountRemain: true,
        receipts: {
          where: { receiptId: excludeReceiptId ?? "__never__" },
          select: { paidAmount: true },
        },
      },
    }),
    tx.creditNote.findMany({
      where: {
        customerId,
        settlementType: "CREDIT_DEBT",
        status: "ACTIVE",
        OR: cnOr,
      },
      orderBy: [{ cnDate: "asc" }, { cnNo: "asc" }],
      select: {
        id: true,
        cnNo: true,
        cnDate: true,
        totalAmount: true,
        amountRemain: true,
        receiptItems: {
          where: { receiptId: excludeReceiptId ?? "__never__" },
          select: { paidAmount: true },
        },
      },
    }),
  ]);

  return {
    sales: sales.map((sale) => {
      const currentUsage = sumReceiptUsage(sale.receipts);
      return {
        id: sale.id,
        docNo: sale.saleNo,
        docDate: sale.saleDate,
        totalAmount: Number(sale.netAmount),
        usedAmount: Number(sale.netAmount) - Number(sale.amountRemain) - currentUsage,
        outstanding: Number(sale.amountRemain) + currentUsage,
      };
    }),
    creditNotes: creditNotes.map((creditNote) => {
      const currentUsage = sumReceiptUsage(creditNote.receiptItems);
      return {
        id: creditNote.id,
        docNo: creditNote.cnNo,
        docDate: creditNote.cnDate,
        totalAmount: Number(creditNote.totalAmount),
        usedAmount: Number(creditNote.totalAmount) - Number(creditNote.amountRemain) - currentUsage,
        outstanding: Number(creditNote.amountRemain) + currentUsage,
      };
    }),
  };
}

export function validateReceiptItemsAgainstAvailable(
  customerId: string | undefined,
  items: ReceiptSettlementItem[],
  available: AvailableReceiptDocumentBundle,
): string | null {
  if (!customerId) {
    return "กรุณาเลือกลูกค้า";
  }

  const saleMap = new Map(available.sales.map((item) => [item.id, item]));
  const cnMap = new Map(available.creditNotes.map((item) => [item.id, item]));
  const usedMap = new Map<string, number>();

  const registerAmount = (key: string, amount: number): number => {
    const nextAmount = (usedMap.get(key) ?? 0) + amount;
    usedMap.set(key, nextAmount);
    return nextAmount;
  };

  for (const item of items) {
    if (item.saleId) {
      const sale = saleMap.get(item.saleId);
      if (!sale) {
        return "พบใบขายเชื่อที่เลือกไม่ถูกต้อง ถูกยกเลิก หรือไม่ใช่ของลูกค้ารายนี้";
      }
      if (registerAmount(`sale:${item.saleId}`, item.paidAmount) > sale.outstanding + 0.0001) {
        return `ยอดรับชำระของ ${sale.docNo} มากกว่ายอดคงเหลือที่รับได้`;
      }
      continue;
    }

    if (item.cnId) {
      const creditNote = cnMap.get(item.cnId);
      if (!creditNote) {
        return "พบใบลดหนี้เครดิตที่เลือกไม่ถูกต้อง ถูกยกเลิก หรือไม่ใช่ของลูกค้ารายนี้";
      }
      if (registerAmount(`cn:${item.cnId}`, item.paidAmount) > creditNote.outstanding + 0.0001) {
        return `ยอดที่นำเครดิต ${creditNote.docNo} มาใช้ มากกว่ายอดคงเหลือที่ใช้ได้`;
      }
    }
  }

  return null;
}
