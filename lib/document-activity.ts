import { AuditAction, type Prisma } from "@/lib/generated/prisma";

export type DocumentActivityKind =
  "CREATE"
  | "UPDATE"
  | "CANCEL"
  | "USED_BY"
  | "USES_SOURCE"
  | "SYSTEM";

export type DocumentActivityTone = "create" | "update" | "cancel" | "used" | "system";

export type DocumentActivityEvent = {
  id: string;
  kind: DocumentActivityKind;
  occurredAt: Date;
  title: string;
  description?: string;
  actorName?: string | null;
  href?: string;
  hrefLabel?: string;
  tone: DocumentActivityTone;
};

export type DocumentActivityEntityType =
  | "Sale"
  | "Purchase"
  | "Receipt"
  | "CreditNote"
  | "PurchaseReturn"
  | "SupplierPayment"
  | "SupplierAdvance"
  | "CustomerAdvance"
  | "SupplierAdvanceRefund"
  | "CustomerAdvanceRefund"
  | "Expense"
  | "WarrantyClaim";

export type AuditActivityInput = {
  id: string;
  action: AuditAction;
  createdAt: Date;
  userName: string | null;
  entityType: string;
  entityId: string | null;
  entityRef: string | null;
  meta: Prisma.JsonValue | null;
};

export type RelationActivityInput = {
  id: string;
  kind: DocumentActivityKind;
  occurredAt: Date;
  title: string;
  description?: string;
  actorName?: string | null;
  href?: string;
  hrefLabel?: string;
  tone: DocumentActivityTone;
};

function metaCancelNote(meta: Prisma.JsonValue | null): string | null {
  if (!meta || Array.isArray(meta) || typeof meta !== "object") return null;
  const value = meta.cancelNote;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function joinDescription(parts: Array<string | null | undefined>,
): string | undefined {
  const text = parts.filter((part): part is string => Boolean(part && part.trim())).join(" | ");
  return text || undefined;
}

export function formatMoneyActivity(value: number | string): string {
  return `${Number(value).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} บาท`;
}

export function buildAuditActivityEvent(row: AuditActivityInput,
): DocumentActivityEvent | null {
  if (row.action === AuditAction.CREATE) {
    return {
      id: `audit-${row.id}`,
      kind: "CREATE",
      occurredAt: row.createdAt,
      title: "สร้างเอกสาร",
      description: joinDescription([row.userName ? `โดย ${row.userName}` : "โดย ระบบ",
      ]),
      actorName: row.userName,
      tone: "create",
    };
  }

  if (row.action === AuditAction.UPDATE) {
    return {
      id: `audit-${row.id}`,
      kind: "UPDATE",
      occurredAt: row.createdAt,
      title: "แก้ไขเอกสาร",
      description: joinDescription([row.userName ? `โดย ${row.userName}` : "โดย ระบบ",
      ]),
      actorName: row.userName,
      tone: "update",
    };
  }

  if (row.action === AuditAction.CANCEL) {
    const cancelNote = metaCancelNote(row.meta);

    return {
      id: `audit-${row.id}`,
      kind: "CANCEL",
      occurredAt: row.createdAt,
      title: "ยกเลิกเอกสาร",
      description: joinDescription([
        row.userName ? `โดย ${row.userName}` : "โดย ระบบ",
        cancelNote ? `เหตุผล: ${cancelNote}` : null,
      ]),
      actorName: row.userName,
      tone: "cancel",
    };
  }

  if (row.action === AuditAction.RECALCULATE) {
    return {
      id: `audit-${row.id}`,
      kind: "SYSTEM",
      occurredAt: row.createdAt,
      title: "ประมวลผลเอกสารใหม่",
      description: joinDescription([row.userName ? `โดย ${row.userName}` : "โดย ระบบ",
      ]),
      actorName: row.userName,
      tone: "system",
    };
  }

  return null;
}

export function buildRelationActivityEvent(input: RelationActivityInput,
): DocumentActivityEvent {
  return { ...input };
}

export function sortDocumentActivityEvents(events: DocumentActivityEvent[],
): DocumentActivityEvent[] {
  return [...events].sort((left, right) => {
    const byTime = right.occurredAt.getTime() - left.occurredAt.getTime();
    if (byTime !== 0) return byTime;
    return left.id.localeCompare(right.id);
  });
}

async function getDb() {
  const mod = await import("@/lib/db");
  return mod.db;
}

async function getAuditEvents(
  entityType: DocumentActivityEntityType,
  entityId: string,
): Promise<DocumentActivityEvent[]> {
  const db = await getDb();
  const rows = await db.auditLog.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      action: true,
      createdAt: true,
      userName: true,
      entityType: true,
      entityId: true,
      entityRef: true,
      meta: true,
    },
  });

  return rows
    .map((row) => buildAuditActivityEvent(row))
    .filter((event): event is DocumentActivityEvent => event !== null);
}

async function getSaleRelationEvents(id: string,
): Promise<DocumentActivityEvent[]> {
  const db = await getDb();
  // Sequential reads on the shared client — concurrent queries (Promise.all) on the
  // pg adapter emit the "client.query() while already executing" deprecation warning.
  const receipts = await db.receiptItem.findMany({
    where: { saleId: id, receipt: { status: "ACTIVE" } },
    select: {
      paidAmount: true,
      receipt: { select: { id: true, receiptNo: true, receiptDate: true, createdAt: true,
        },
      },
    },
  });
  const creditNotes = await db.creditNote.findMany({
    where: { saleId: id, status: "ACTIVE" },
    select: { id: true, cnNo: true, cnDate: true, createdAt: true, totalAmount: true,
    },
  });
  const claims = await db.warrantyClaim.findMany({
    where: { warranty: { saleId: id } },
    select: { id: true, claimNo: true, claimDate: true, createdAt: true },
  });

  return [
    ...receipts.map((item) => buildRelationActivityEvent({
      id: `sale-${id}-receipt-${item.receipt.id}`,
      kind: "USED_BY",
      occurredAt: item.receipt.createdAt ?? item.receipt.receiptDate,
      title: "ถูกนำไปใช้ที่ใบเสร็จ",
      description: `รับชำระ ${formatMoneyActivity(String(item.paidAmount))}`,
      href: `/admin/receipts/${item.receipt.id}`,
      hrefLabel: item.receipt.receiptNo,
      tone: "used",
    }),
    ),
    ...creditNotes.map((cn) => buildRelationActivityEvent({
      id: `sale-${id}-credit-note-${cn.id}`,
      kind: "USED_BY",
      occurredAt: cn.createdAt ?? cn.cnDate,
      title: "ถูกนำไปใช้ที่ใบลดหนี้",
      description: `มูลค่า ${formatMoneyActivity(String(cn.totalAmount))}`,
      href: `/admin/credit-notes/${cn.id}`,
      hrefLabel: cn.cnNo,
      tone: "used",
    }),
    ),
    ...claims.map((claim) => buildRelationActivityEvent({
      id: `sale-${id}-warranty-claim-${claim.id}`,
      kind: "USED_BY",
      occurredAt: claim.createdAt ?? claim.claimDate,
      title: "ถูกนำไปใช้ที่เคลมสินค้า",
      href: `/admin/warranty-claims/${claim.id}`,
      hrefLabel: claim.claimNo,
      tone: "used",
    }),
    ),
  ];
}

async function getPurchaseRelationEvents(id: string,
): Promise<DocumentActivityEvent[]> {
  const db = await getDb();
  // Sequential reads — see getSaleRelationEvents.
  const returns = await db.purchaseReturn.findMany({
    where: { purchaseId: id, status: "ACTIVE" },
    select: { id: true, returnNo: true, returnDate: true, createdAt: true, totalAmount: true,
    },
  });
  const payments = await db.supplierPaymentItem.findMany({
    where: { purchaseId: id, payment: { status: "ACTIVE" } },
    select: {
      paidAmount: true,
      payment: { select: { id: true, paymentNo: true, paymentDate: true, createdAt: true,
        },
      },
    },
  });

  return [
    ...returns.map((ret) => buildRelationActivityEvent({
      id: `purchase-${id}-return-${ret.id}`,
      kind: "USED_BY",
      occurredAt: ret.createdAt ?? ret.returnDate,
      title: "ถูกนำไปใช้ที่ใบคืนซื้อ",
      description: `มูลค่า ${formatMoneyActivity(String(ret.totalAmount))}`,
      href: `/admin/purchase-returns/${ret.id}`,
      hrefLabel: ret.returnNo,
      tone: "used",
    }),
    ),
    ...payments.map((item) => buildRelationActivityEvent({
      id: `purchase-${id}-supplier-payment-${item.payment.id}`,
      kind: "USED_BY",
      occurredAt: item.payment.createdAt ?? item.payment.paymentDate,
      title: "ถูกนำไปใช้ที่จ่ายชำระเจ้าหนี้",
      description: `จ่ายชำระ ${formatMoneyActivity(String(item.paidAmount))}`,
      href: `/admin/supplier-payments/${item.payment.id}`,
      hrefLabel: item.payment.paymentNo,
      tone: "used",
    }),
    ),
  ];
}

async function getReceiptRelationEvents(id: string,
): Promise<DocumentActivityEvent[]> {
  const db = await getDb();
  const items = await db.receiptItem.findMany({
    where: { receiptId: id },
    select: {
      paidAmount: true,
      sale: { select: { id: true, saleNo: true, saleDate: true, createdAt: true },
      },
      creditNote: { select: { id: true, cnNo: true, cnDate: true, createdAt: true },
      },
      customerAdvance: { select: { id: true, advanceNo: true, advanceDate: true, createdAt: true,
        },
      },
    },
  });

  return items.flatMap((item) => {
    const events: DocumentActivityEvent[] = [];
    if (item.sale) {
      events.push(buildRelationActivityEvent({
        id: `receipt-${id}-sale-${item.sale.id}`,
        kind: "USES_SOURCE",
        occurredAt: item.sale.createdAt ?? item.sale.saleDate,
        title: "รับชำระจากใบขาย",
        description: `ยอดรับ ${formatMoneyActivity(String(item.paidAmount))}`,
        href: `/admin/sales/${item.sale.id}`,
        hrefLabel: item.sale.saleNo,
        tone: "used",
      }),
      );
    }
    if (item.creditNote) {
      events.push(buildRelationActivityEvent({
        id: `receipt-${id}-credit-note-${item.creditNote.id}`,
        kind: "USES_SOURCE",
        occurredAt: item.creditNote.createdAt ?? item.creditNote.cnDate,
        title: "ใช้เครดิตจากใบลดหนี้",
        description: `เครดิต ${formatMoneyActivity(String(item.paidAmount))}`,
        href: `/admin/credit-notes/${item.creditNote.id}`,
        hrefLabel: item.creditNote.cnNo,
        tone: "used",
      }),
      );
    }
    if (item.customerAdvance) {
      events.push(buildRelationActivityEvent({
        id: `receipt-${id}-customer-advance-${item.customerAdvance.id}`,
        kind: "USES_SOURCE",
        occurredAt: item.customerAdvance.createdAt ?? item.customerAdvance.advanceDate,
        title: "ใช้เงินมัดจำลูกค้า",
        description: `ยอดใช้ ${formatMoneyActivity(String(item.paidAmount))}`,
        href: `/admin/customer-advances/${item.customerAdvance.id}`,
        hrefLabel: item.customerAdvance.advanceNo,
        tone: "used",
      }),
      );
    }
    return events;
  });
}

async function getCreditNoteRelationEvents(id: string,
): Promise<DocumentActivityEvent[]> {
  const db = await getDb();
  // Sequential reads — see getSaleRelationEvents.
  const cn = await db.creditNote.findUnique({
    where: { id },
    select: {
      sale: { select: { id: true, saleNo: true, saleDate: true, createdAt: true },
      },
    },
  });
  const receipts = await db.receiptItem.findMany({
    where: { cnId: id, receipt: { status: "ACTIVE" } },
    select: {
      paidAmount: true,
      receipt: { select: { id: true, receiptNo: true, receiptDate: true, createdAt: true,
        },
      },
    },
  });

  return [
    ...(cn?.sale ? [buildRelationActivityEvent({
      id: `credit-note-${id}-sale-${cn.sale.id}`,
      kind: "USES_SOURCE",
      occurredAt: cn.sale.createdAt ?? cn.sale.saleDate,
      title: "อ้างอิงจากใบขาย",
      href: `/admin/sales/${cn.sale.id}`,
      hrefLabel: cn.sale.saleNo,
      tone: "used",
    }),
        ] : []),
    ...receipts.map((item) => buildRelationActivityEvent({
      id: `credit-note-${id}-receipt-${item.receipt.id}`,
      kind: "USED_BY",
      occurredAt: item.receipt.createdAt ?? item.receipt.receiptDate,
      title: "ถูกนำไปใช้ที่ใบเสร็จ",
      description: `เครดิต ${formatMoneyActivity(String(item.paidAmount))}`,
      href: `/admin/receipts/${item.receipt.id}`,
      hrefLabel: item.receipt.receiptNo,
      tone: "used",
    }),
    ),
  ];
}

async function getPurchaseReturnRelationEvents(id: string,
): Promise<DocumentActivityEvent[]> {
  const db = await getDb();
  // Sequential reads — see getSaleRelationEvents.
  const ret = await db.purchaseReturn.findUnique({
    where: { id },
    select: {
      purchase: { select: { id: true, purchaseNo: true, purchaseDate: true, createdAt: true,
        },
      },
    },
  });
  const payments = await db.supplierPaymentItem.findMany({
    where: { purchaseReturnId: id, payment: { status: "ACTIVE" } },
    select: {
      paidAmount: true,
      payment: { select: { id: true, paymentNo: true, paymentDate: true, createdAt: true,
        },
      },
    },
  });

  return [
    ...(ret?.purchase ? [buildRelationActivityEvent({
      id: `purchase-return-${id}-purchase-${ret.purchase.id}`,
      kind: "USES_SOURCE",
      occurredAt: ret.purchase.createdAt ?? ret.purchase.purchaseDate,
      title: "อ้างอิงจากใบซื้อ",
      href: `/admin/purchases/${ret.purchase.id}`,
      hrefLabel: ret.purchase.purchaseNo,
      tone: "used",
    }),
        ] : []),
    ...payments.map((item) => buildRelationActivityEvent({
      id: `purchase-return-${id}-supplier-payment-${item.payment.id}`,
      kind: "USED_BY",
      occurredAt: item.payment.createdAt ?? item.payment.paymentDate,
      title: "ถูกนำไปใช้ที่จ่ายชำระเจ้าหนี้",
      description: `ใช้เครดิต ${formatMoneyActivity(String(item.paidAmount))}`,
      href: `/admin/supplier-payments/${item.payment.id}`,
      hrefLabel: item.payment.paymentNo,
      tone: "used",
    }),
    ),
  ];
}

async function getSupplierPaymentRelationEvents(id: string,
): Promise<DocumentActivityEvent[]> {
  const db = await getDb();
  const items = await db.supplierPaymentItem.findMany({
    where: { paymentId: id },
    select: {
      paidAmount: true,
      purchase: { select: { id: true, purchaseNo: true, purchaseDate: true, createdAt: true,
        },
      },
      purchaseReturn: { select: { id: true, returnNo: true, returnDate: true, createdAt: true },
      },
      advance: { select: { id: true, advanceNo: true, advanceDate: true, createdAt: true,
        },
      },
    },
  });

  return items.flatMap((item) => {
    const events: DocumentActivityEvent[] = [];
    if (item.purchase) {
      events.push(buildRelationActivityEvent({
        id: `supplier-payment-${id}-purchase-${item.purchase.id}`,
        kind: "USES_SOURCE",
        occurredAt: item.purchase.createdAt ?? item.purchase.purchaseDate,
        title: "จ่ายชำระใบซื้อ",
        description: `ยอดจ่าย ${formatMoneyActivity(String(item.paidAmount))}`,
        href: `/admin/purchases/${item.purchase.id}`,
        hrefLabel: item.purchase.purchaseNo,
        tone: "used",
      }),
      );
    }
    if (item.purchaseReturn) {
      events.push(buildRelationActivityEvent({
        id: `supplier-payment-${id}-purchase-return-${item.purchaseReturn.id}`,
        kind: "USES_SOURCE",
        occurredAt: item.purchaseReturn.createdAt ?? item.purchaseReturn.returnDate,
        title: "ใช้เครดิตใบคืนซื้อ",
        description: `เครดิต ${formatMoneyActivity(String(item.paidAmount))}`,
        href: `/admin/purchase-returns/${item.purchaseReturn.id}`,
        hrefLabel: item.purchaseReturn.returnNo,
        tone: "used",
      }),
      );
    }
    if (item.advance) {
      events.push(buildRelationActivityEvent({
        id: `supplier-payment-${id}-advance-${item.advance.id}`,
        kind: "USES_SOURCE",
        occurredAt: item.advance.createdAt ?? item.advance.advanceDate,
        title: "ใช้เงินมัดจำเจ้าหนี้",
        description: `ยอดใช้ ${formatMoneyActivity(String(item.paidAmount))}`,
        href: `/admin/supplier-advances/${item.advance.id}`,
        hrefLabel: item.advance.advanceNo,
        tone: "used",
      }),
      );
    }
    return events;
  });
}

async function getSupplierAdvanceRelationEvents(id: string,
): Promise<DocumentActivityEvent[]> {
  const db = await getDb();
  const [payments, refunds] = await Promise.all([
    db.supplierPaymentItem.findMany({
    where: { advanceId: id, payment: { status: "ACTIVE" } },
    select: {
      paidAmount: true,
      payment: { select: { id: true, paymentNo: true, paymentDate: true, createdAt: true,
          },
        },
    },
  }),
    db.supplierAdvanceRefund.findMany({
      where: { supplierAdvanceId: id, status: "ACTIVE" },
      select: {
        id: true,
        refundNo: true,
        refundDate: true,
        createdAt: true,
        refundAmount: true,
      },
    }),
  ]);

  return [
    ...payments.map((item) => buildRelationActivityEvent({
    id: `supplier-advance-${id}-supplier-payment-${item.payment.id}`,
    kind: "USED_BY",
    occurredAt: item.payment.createdAt ?? item.payment.paymentDate,
    title: "ถูกนำไปใช้ที่จ่ายชำระเจ้าหนี้",
    description: `ใช้มัดจำ ${formatMoneyActivity(String(item.paidAmount))}`,
    href: `/admin/supplier-payments/${item.payment.id}`,
    hrefLabel: item.payment.paymentNo,
    tone: "used",
  }),
    ),
    ...refunds.map((refund) =>
      buildRelationActivityEvent({
        id: `supplier-advance-${id}-refund-${refund.id}`,
        kind: "USED_BY",
        occurredAt: refund.createdAt ?? refund.refundDate,
        title: "ถูกอ้างอิงใน CN รับคืนเงินมัดจำ",
        description: `รับคืน ${formatMoneyActivity(String(refund.refundAmount))}`,
        href: `/admin/supplier-advance-refunds/${refund.id}`,
        hrefLabel: refund.refundNo,
        tone: "used",
      }),
    ),
  ];
}

async function getCustomerAdvanceRelationEvents(id: string,
): Promise<DocumentActivityEvent[]> {
  const db = await getDb();
  const [receipts, refunds] = await Promise.all([
    db.receiptItem.findMany({
    where: { customerAdvanceId: id, receipt: { status: "ACTIVE" } },
    select: {
      paidAmount: true,
      receipt: { select: { id: true, receiptNo: true, receiptDate: true, createdAt: true,
          },
        },
    },
  }),
    db.customerAdvanceRefund.findMany({
      where: { customerAdvanceId: id, status: "ACTIVE" },
      select: {
        id: true,
        refundNo: true,
        refundDate: true,
        createdAt: true,
        refundAmount: true,
      },
    }),
  ]);
  return [
    ...receipts.map((item) => buildRelationActivityEvent({
    id: `customer-advance-${id}-receipt-${item.receipt.id}`,
    kind: "USED_BY",
    occurredAt: item.receipt.createdAt ?? item.receipt.receiptDate,
    title: "ถูกนำไปใช้ที่ใบเสร็จรับเงิน",
    description: `ใช้มัดจำ ${formatMoneyActivity(String(item.paidAmount))}`,
    href: `/admin/receipts/${item.receipt.id}`,
    hrefLabel: item.receipt.receiptNo,
    tone: "used",
  }),
    ),
    ...refunds.map((refund) =>
      buildRelationActivityEvent({
        id: `customer-advance-${id}-refund-${refund.id}`,
        kind: "USED_BY",
        occurredAt: refund.createdAt ?? refund.refundDate,
        title: "ถูกอ้างอิงใน CN คืนเงินมัดจำ",
        description: `คืน ${formatMoneyActivity(String(refund.refundAmount))}`,
        href: `/admin/customer-advance-refunds/${refund.id}`,
        hrefLabel: refund.refundNo,
        tone: "used",
      }),
    ),
  ];
}

async function getAdvanceRefundRelationEvents(
  entityType: "CustomerAdvanceRefund" | "SupplierAdvanceRefund",
  id: string,
): Promise<DocumentActivityEvent[]> {
  const db = await getDb();
  if (entityType === "CustomerAdvanceRefund") {
    const refund = await db.customerAdvanceRefund.findUnique({
      where: { id },
      select: {
        refundAmount: true,
        customerAdvance: {
          select: {
            id: true,
            advanceNo: true,
            advanceDate: true,
            createdAt: true,
          },
        },
      },
    });
    return refund
      ? [
          buildRelationActivityEvent({
            id: `customer-refund-${id}-source-${refund.customerAdvance.id}`,
            kind: "USES_SOURCE",
            occurredAt:
              refund.customerAdvance.createdAt ??
              refund.customerAdvance.advanceDate,
            title: "อ้างอิงรับเงินมัดจำลูกค้า",
            description: `ยอดคืน ${formatMoneyActivity(String(refund.refundAmount))}`,
            href: `/admin/customer-advances/${refund.customerAdvance.id}`,
            hrefLabel: refund.customerAdvance.advanceNo,
            tone: "used",
          }),
        ]
      : [];
  }
  const refund = await db.supplierAdvanceRefund.findUnique({
    where: { id },
    select: {
      refundAmount: true,
      supplierAdvance: {
        select: {
          id: true,
          advanceNo: true,
          advanceDate: true,
          createdAt: true,
        },
      },
    },
  });
  return refund
    ? [
        buildRelationActivityEvent({
          id: `supplier-refund-${id}-source-${refund.supplierAdvance.id}`,
          kind: "USES_SOURCE",
          occurredAt:
            refund.supplierAdvance.createdAt ??
            refund.supplierAdvance.advanceDate,
          title: "อ้างอิงเงินมัดจำซัพพลายเออร์",
          description: `ยอดรับคืน ${formatMoneyActivity(String(refund.refundAmount))}`,
          href: `/admin/supplier-advances/${refund.supplierAdvance.id}`,
          hrefLabel: refund.supplierAdvance.advanceNo,
          tone: "used",
        }),
      ]
    : [];
}

async function getWarrantyClaimRelationEvents(id: string,
): Promise<DocumentActivityEvent[]> {
  const db = await getDb();
  const claim = await db.warrantyClaim.findUnique({
    where: { id },
    select: {
      warranty: {
        select: {
          id: true,
          sale: { select: { id: true, saleNo: true, saleDate: true, createdAt: true },
          },
        },
      },
      purchaseReturns: {
        where: { status: "ACTIVE" },
        select: { id: true, returnNo: true, returnDate: true, createdAt: true, totalAmount: true,
        },
      },
    },
  });

  if (!claim) return [];

  return [
    ...(claim.warranty.sale ? [buildRelationActivityEvent({
      id: `warranty-claim-${id}-sale-${claim.warranty.sale.id}`,
      kind: "USES_SOURCE",
      occurredAt: claim.warranty.sale.createdAt ?? claim.warranty.sale.saleDate,
      title: "อ้างอิงจากใบขาย",
      href: `/admin/sales/${claim.warranty.sale.id}`,
      hrefLabel: claim.warranty.sale.saleNo,
      tone: "used",
    }),
        ] : []),
    ...claim.purchaseReturns.map((ret) => buildRelationActivityEvent({
      id: `warranty-claim-${id}-purchase-return-${ret.id}`,
      kind: "USED_BY",
      occurredAt: ret.createdAt ?? ret.returnDate,
      title: "ถูกนำไปใช้ที่ใบคืนซื้อ",
      description: `มูลค่า ${formatMoneyActivity(String(ret.totalAmount))}`,
      href: `/admin/purchase-returns/${ret.id}`,
      hrefLabel: ret.returnNo,
      tone: "used",
    }),
    ),
  ];
}

async function getRelationEvents(
  entityType: DocumentActivityEntityType,
  id: string,
): Promise<DocumentActivityEvent[]> {
  if (entityType === "Sale") return getSaleRelationEvents(id);
  if (entityType === "Purchase") return getPurchaseRelationEvents(id);
  if (entityType === "Receipt") return getReceiptRelationEvents(id);
  if (entityType === "CreditNote") return getCreditNoteRelationEvents(id);
  if (entityType === "PurchaseReturn") return getPurchaseReturnRelationEvents(id);
  if (entityType === "SupplierPayment") return getSupplierPaymentRelationEvents(id);
  if (entityType === "SupplierAdvance") return getSupplierAdvanceRelationEvents(id);
  if (entityType === "CustomerAdvance") return getCustomerAdvanceRelationEvents(id);
  if (entityType === "CustomerAdvanceRefund" ||
    entityType === "SupplierAdvanceRefund"
  )
    return getAdvanceRefundRelationEvents(entityType, id);
  if (entityType === "WarrantyClaim") return getWarrantyClaimRelationEvents(id);
  return [];
}

export async function getDocumentActivityTimeline(
  entityType: DocumentActivityEntityType,
  entityId: string,
): Promise<DocumentActivityEvent[]> {
  // Sequential — each helper issues its own DB reads on the shared pg client;
  // running them concurrently triggers the "client.query() while already executing"
  // deprecation warning.
  const auditEvents = await getAuditEvents(entityType, entityId);
  const relationEvents = await getRelationEvents(entityType, entityId);

  return sortDocumentActivityEvents([...auditEvents, ...relationEvents]);
}
