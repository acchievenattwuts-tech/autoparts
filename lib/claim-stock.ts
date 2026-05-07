import { ClaimStockMovementType, Prisma } from "@/lib/generated/prisma";
import { db } from "@/lib/db";

type TxClient = Parameters<Parameters<typeof db.$transaction>[0]>[0];

const DEFAULT_LOT_KEY = "";
const EPSILON = 0.0001;

export interface ClaimOriginalCostSnapshot {
  productId: string;
  lotNo: string;
  unitCost: number;
}

export interface ClaimStockMovementInput {
  claimId: string;
  productId: string;
  movementType: ClaimStockMovementType;
  docNo: string;
  docDate: Date;
  qtyIn?: number;
  qtyOut?: number;
  unitCost: number;
  lotNo?: string | null;
  detail?: string;
  stockCardId?: string;
  purchaseReturnId?: string;
  reversalOfId?: string;
}

const normalizeLotNo = (lotNo?: string | null): string => lotNo?.trim() ?? DEFAULT_LOT_KEY;

export async function getOriginalClaimUnitCost(
  tx: TxClient,
  warrantyId: string,
): Promise<ClaimOriginalCostSnapshot> {
  const warranty = await tx.warranty.findUnique({
    where: { id: warrantyId },
    select: {
      productId: true,
      lotNo: true,
      saleItem: {
        select: {
          costPrice: true,
          lotItems: {
            select: {
              lotNo: true,
              unitCost: true,
            },
          },
        },
      },
    },
  });

  if (!warranty) {
    throw new Error("ไม่พบข้อมูลประกัน");
  }

  const lotNo = normalizeLotNo(warranty.lotNo);
  const lotCost = lotNo
    ? warranty.saleItem.lotItems.find((lotItem) => lotItem.lotNo === lotNo)?.unitCost
    : null;

  return {
    productId: warranty.productId,
    lotNo,
    unitCost: Number(lotCost ?? warranty.saleItem.costPrice),
  };
}

export async function writeClaimStockMovement(
  tx: TxClient,
  input: ClaimStockMovementInput,
): Promise<string> {
  const qtyIn = input.qtyIn ?? 0;
  const qtyOut = input.qtyOut ?? 0;
  const lotNo = normalizeLotNo(input.lotNo);
  const hasQuantityEffect = qtyIn > 0 || qtyOut > 0;

  if (qtyIn < 0 || qtyOut < 0) {
    throw new Error("จำนวนสินค้าเคลมต้องไม่ติดลบ");
  }

  if (qtyOut > 0) {
    const balance = await tx.claimStockBalance.findUnique({
      where: {
        claimId_productId_lotNo: {
          claimId: input.claimId,
          productId: input.productId,
          lotNo,
        },
      },
      select: { qtyOnHand: true },
    });
    const qtyOnHand = balance ? Number(balance.qtyOnHand) : 0;

    if (qtyOut > qtyOnHand + EPSILON) {
      throw new Error("ยอดคงเหลือสินค้าเคลมไม่พอสำหรับรายการนี้");
    }
  }

  const movement = await tx.claimStockMovement.create({
    data: {
      claimId: input.claimId,
      productId: input.productId,
      movementType: input.movementType,
      docNo: input.docNo,
      docDate: input.docDate,
      lotNo,
      qtyIn: new Prisma.Decimal(qtyIn),
      qtyOut: new Prisma.Decimal(qtyOut),
      unitCost: new Prisma.Decimal(input.unitCost),
      detail: input.detail,
      stockCardId: input.stockCardId,
      purchaseReturnId: input.purchaseReturnId,
      reversalOfId: input.reversalOfId,
    },
    select: { id: true },
  });

  if (hasQuantityEffect) {
    await tx.claimStockBalance.upsert({
      where: {
        claimId_productId_lotNo: {
          claimId: input.claimId,
          productId: input.productId,
          lotNo,
        },
      },
      create: {
        claimId: input.claimId,
        productId: input.productId,
        lotNo,
        qtyOnHand: new Prisma.Decimal(qtyIn - qtyOut),
        unitCost: new Prisma.Decimal(input.unitCost),
      },
      update: {
        qtyOnHand: {
          increment: new Prisma.Decimal(qtyIn - qtyOut),
        },
        unitCost: new Prisma.Decimal(input.unitCost),
      },
    });
  }

  return movement.id;
}

export async function reverseClaimStockMovements(
  tx: TxClient,
  claimId: string,
  options?: { movementTypes?: ClaimStockMovementType[]; docNos?: string[] },
): Promise<void> {
  const movements = await tx.claimStockMovement.findMany({
    where: {
      claimId,
      reversedAt: null,
      reversalOfId: null,
      ...(options?.movementTypes?.length ? { movementType: { in: options.movementTypes } } : {}),
      ...(options?.docNos?.length ? { docNo: { in: options.docNos } } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  const now = new Date();

  for (const movement of movements) {
    await writeClaimStockMovement(tx, {
      claimId: movement.claimId,
      productId: movement.productId,
      movementType: ClaimStockMovementType.CANCEL_REVERSAL,
      docNo: `${movement.docNo}-REV`,
      docDate: now,
      lotNo: movement.lotNo,
      qtyIn: Number(movement.qtyOut),
      qtyOut: Number(movement.qtyIn),
      unitCost: Number(movement.unitCost),
      detail: `ย้อนกลับรายการ ${movement.movementType}`,
      stockCardId: movement.stockCardId ?? undefined,
      purchaseReturnId: movement.purchaseReturnId ?? undefined,
      reversalOfId: movement.id,
    });

    await tx.claimStockMovement.update({
      where: { id: movement.id },
      data: { reversedAt: now },
    });
  }
}
