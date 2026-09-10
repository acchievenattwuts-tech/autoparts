import type { Prisma } from "@/lib/generated/prisma";

type TxClient = Prisma.TransactionClient;

export type DocumentSignerSnapshot = {
  signerName: string | null;
  signerSignatureUrl: string | null;
  signedAt: Date | null;
};

/**
 * ตรึงชื่อ + ลายเซ็นของผู้ทำเอกสารไว้กับตัวเอกสาร แทนการอ่านสดจาก `User`
 * ตอนพิมพ์ — ถ้าผู้ใช้เปลี่ยนหรือลบลายเซ็นทีหลัง เอกสารเก่าต้องไม่เปลี่ยนตาม
 *
 * โครงเดียวกับ `getSaleSignerSnapshot` / `getReceiptSignerSnapshot` /
 * `getClaimSignerSnapshot` ที่ยังเป็นสำเนาแยกกันอยู่ในสาม module เดิม
 */
export async function getDocumentSignerSnapshot(
  tx: TxClient,
  userId: string,
  signedAt: Date,
): Promise<DocumentSignerSnapshot> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { name: true, signatureUrl: true },
  });

  return {
    signerName: user?.name ?? null,
    signerSignatureUrl: user?.signatureUrl ?? null,
    signedAt: user?.name ? signedAt : null,
  };
}
