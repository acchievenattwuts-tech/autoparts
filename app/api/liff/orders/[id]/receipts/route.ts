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

  if (sale.paymentType !== "CREDIT_SALE") {
    return NextResponse.json([]);
  }

  const receipts = await db.receipt.findMany({
    where: {
      status: "ACTIVE",
      items: {
        some: {
          sale: {
            id,
            customerId: customer.id,
            status: "ACTIVE",
          },
        },
      },
    },
    select: {
      id: true,
      receiptNo: true,
      receiptDate: true,
      paymentMethod: true,
      status: true,
      cancelNote: true,
      items: {
        orderBy: { lineNo: "asc" },
        where: { saleId: id },
        select: {
          id: true,
          paidAmount: true,
        },
      },
    },
    orderBy: { receiptDate: "desc" },
    take: 10,
  });

  return NextResponse.json(
    receipts.flatMap((receipt) =>
      receipt.items.map((item) => ({
        id: item.id,
        paidAmount: Number(item.paidAmount),
        receipt: {
          id: receipt.id,
          receiptNo: receipt.receiptNo,
          receiptDate: receipt.receiptDate,
          paymentMethod: receipt.paymentMethod,
          status: receipt.status,
          cancelNote: receipt.cancelNote,
        },
      })),
    ),
  );
}
