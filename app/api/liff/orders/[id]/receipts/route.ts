import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireLiffCustomer } from "@/lib/liff-data";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const customer = await requireLiffCustomer();

  const sale = await db.sale.findFirst({
    where: {
      id,
      customerId: customer.id,
      status: "ACTIVE",
    },
    select: {
      id: true,
      saleNo: true,
      saleDate: true,
      netAmount: true,
      paymentMethod: true,
      paymentType: true,
    },
  });

  if (!sale) {
    return NextResponse.json([], { status: 404 });
  }

  if (sale.paymentType === "CASH_SALE") {
    return NextResponse.json([
      {
        id: `cash-sale-${sale.id}`,
        paidAmount: Number(sale.netAmount),
        receipt: {
          id: sale.id,
          receiptNo: sale.saleNo,
          receiptDate: sale.saleDate,
          paymentMethod: sale.paymentMethod ?? "CASH",
          status: "ACTIVE",
          cancelNote: null,
        },
      },
    ]);
  }

  const receipts = await db.receiptItem.findMany({
    where: {
      sale: {
        id,
        customerId: customer.id,
        status: "ACTIVE",
      },
    },
    select: {
      id: true,
      paidAmount: true,
      receipt: {
        select: {
          id: true,
          receiptNo: true,
          receiptDate: true,
          paymentMethod: true,
          status: true,
          cancelNote: true,
        },
      },
    },
    orderBy: { receipt: { receiptDate: "desc" } },
    take: 10,
  });

  return NextResponse.json(receipts);
}
