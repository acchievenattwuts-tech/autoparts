import { PaymentSlipVerificationStatus } from "@/lib/generated/prisma";
import { classifyImageContent, type LineImageClassification } from "@/lib/line-image-service";
import { createPaymentSlip, setPaymentSlipImagePath } from "@/lib/line-payment-slip-repository";
import { runPaymentSlipOcr } from "@/lib/line-payment-slip-ocr";
import type { PaymentSlipOcr } from "@/lib/line-payment-slip-service";
import { storePaymentSlipImage } from "@/lib/line-payment-slip-storage";
import {
  fetchMessengerAttachment,
  type MessengerAttachmentContent,
} from "@/lib/messenger/messenger-messaging";

/**
 * Messenger image pipeline. Reuses the shared vision classifier + payment-slip
 * OCR/storage (lib/line-image-service, lib/line-payment-slip-*) so a photo sent
 * on Messenger is understood exactly like on LINE — only the fetch (Facebook CDN
 * instead of the LINE content API) and the slip's owning FK differ.
 */

export type MessengerImageResult = {
  classification: LineImageClassification;
  /** Downloaded bytes (image/*) — null when the CDN url was gone or oversized. */
  content: MessengerAttachmentContent | null;
};

/** Fetches the attachment from the Facebook CDN and classifies it (part vs slip). */
export async function classifyMessengerImage(cdnUrl: string): Promise<MessengerImageResult> {
  let content: MessengerAttachmentContent | null = null;
  try {
    content = await fetchMessengerAttachment(cdnUrl);
  } catch {
    content = null;
  }

  if (!content) {
    return {
      classification: {
        kind: "unknown_image",
        intent: (await import("@/lib/generated/prisma")).LineIntent.UNKNOWN,
        searchHints: [],
        confidence: "LOW",
        reason: "NO_IMAGE_CONTENT",
        ocr: null,
      },
      content: null,
    };
  }

  const classification = await classifyImageContent(content);
  return { classification, content };
}

export type IngestMessengerSlipResult = {
  slipId: string;
  verificationStatus: PaymentSlipVerificationStatus;
  ocr: PaymentSlipOcr;
  imageStored: boolean;
};

/**
 * Persists a Messenger payment slip: reuses the OCR from the single classify call
 * when present, stores the row against `messengerConversationId`, then compresses
 * + stores the image (best-effort). Mirrors ingestPaymentSlip for LINE.
 */
export async function ingestMessengerPaymentSlip(input: {
  messengerConversationId: string;
  content: MessengerAttachmentContent | null;
  ocr?: PaymentSlipOcr | null;
}): Promise<IngestMessengerSlipResult> {
  const ocr = input.ocr ?? (await runPaymentSlipOcr(input.content));

  const slip = await createPaymentSlip({
    messengerConversationId: input.messengerConversationId,
    ocr,
  });

  let imageStored = false;
  if (input.content) {
    const path = await storePaymentSlipImage({
      slipId: slip.id,
      date: slip.createdAt,
      content: input.content,
    });
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
