import { PaymentSlipVerificationStatus } from "@/lib/generated/prisma";
import { fetchLineMessageContent, type LineMessageContent } from "@/lib/line-messaging";
import { runPaymentSlipOcr } from "@/lib/line-payment-slip-ocr";
import { createPaymentSlip, setPaymentSlipImagePath } from "@/lib/line-payment-slip-repository";
import type { PaymentSlipOcr } from "@/lib/line-payment-slip-service";
import { storePaymentSlipImage } from "@/lib/line-payment-slip-storage";

export type IngestPaymentSlipResult = {
  slipId: string;
  verificationStatus: PaymentSlipVerificationStatus;
  ocr: PaymentSlipOcr;
  imageStored: boolean;
};

/**
 * Ingests a payment-slip image at the moment it arrives: fetches the LINE image
 * ONCE, runs OCR, persists the slip row, then compresses + stores the image in a
 * private bucket (best-effort). Capturing at ingestion avoids LINE's short content
 * retention window. Image persistence failures never block the OCR/record flow.
 */
export async function ingestPaymentSlip(input: {
  channelAccessToken: string | null;
  conversationId: string;
  lineUserId: string;
  lineMessageId: string | null;
  content?: LineMessageContent | null;
  /** OCR already extracted during image classification — reuse it to avoid a 2nd vision call. */
  ocr?: PaymentSlipOcr | null;
}): Promise<IngestPaymentSlipResult> {
  let content = input.content ?? null;
  if (!content && input.channelAccessToken && input.lineMessageId) {
    try {
      content = await fetchLineMessageContent({
        channelAccessToken: input.channelAccessToken,
        messageId: input.lineMessageId,
      });
    } catch {
      content = null;
    }
  }

  // Reuse OCR captured in the single classify+OCR vision call; only fall back to a
  // dedicated OCR call when it wasn't provided.
  const ocr = input.ocr ?? (await runPaymentSlipOcr(content));

  const slip = await createPaymentSlip({
    conversationId: input.conversationId,
    lineUserId: input.lineUserId,
    lineMessageId: input.lineMessageId,
    ocr,
  });

  let imageStored = false;
  if (content) {
    const path = await storePaymentSlipImage({ slipId: slip.id, date: slip.createdAt, content });
    if (path) {
      await setPaymentSlipImagePath({ id: slip.id, imageUrl: path });
      imageStored = true;
    }
  }

  return {
    slipId: slip.id,
    verificationStatus: slip.verificationStatus,
    ocr,
    imageStored,
  };
}
