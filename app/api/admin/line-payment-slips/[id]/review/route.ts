import { NextRequest, NextResponse } from "next/server";

import { AuditAction, PaymentSlipVerificationStatus } from "@/lib/generated/prisma";
import { getAuditActorFromSession, getRequestContext, writeAuditLog } from "@/lib/audit-log";
import { lineAdminApiErrorResponse } from "@/lib/line-admin-api";
import {
  getPaymentSlipById,
  reviewPaymentSlip,
  setPaymentSlipImagePath,
} from "@/lib/line-payment-slip-repository";
import { deletePaymentSlipImage } from "@/lib/line-payment-slip-storage";
import { requirePermission } from "@/lib/require-auth";

const DECISION_TO_STATUS: Record<string, PaymentSlipVerificationStatus> = {
  confirm: PaymentSlipVerificationStatus.CONFIRMED_BY_ADMIN,
  reject: PaymentSlipVerificationStatus.REJECTED,
  needs_info: PaymentSlipVerificationStatus.NEEDS_MORE_INFO,
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requirePermission("line_payment_slips.manage");
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const decision = typeof body.decision === "string" ? body.decision : "";
    const nextStatus = DECISION_TO_STATUS[decision];

    if (!nextStatus) {
      return NextResponse.json({ error: "INVALID_DECISION" }, { status: 400 });
    }

    const existing = await getPaymentSlipById(id);
    if (!existing) {
      return NextResponse.json({ error: "PAYMENT_SLIP_NOT_FOUND" }, { status: 404 });
    }

    const updated = await reviewPaymentSlip({
      id,
      adminUserId: session.user.id,
      status: nextStatus,
    });

    // Free storage: a rejected slip's image is deleted and its path cleared.
    let imageDeleted = false;
    if (nextStatus === PaymentSlipVerificationStatus.REJECTED && existing.imageUrl) {
      await deletePaymentSlipImage(existing.imageUrl);
      await setPaymentSlipImagePath({ id, imageUrl: null });
      imageDeleted = true;
    }

    const requestContext = await getRequestContext();
    await writeAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: AuditAction.UPDATE,
      entityType: "PaymentSlip",
      entityId: id,
      before: { verificationStatus: existing.verificationStatus },
      after: { verificationStatus: nextStatus },
      meta: { operation: "REVIEW_PAYMENT_SLIP", decision, imageDeleted },
    });

    return NextResponse.json({ ok: true, verificationStatus: updated.verificationStatus });
  } catch (error) {
    return lineAdminApiErrorResponse(error);
  }
}
